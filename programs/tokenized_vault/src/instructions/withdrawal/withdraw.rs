use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_interface::{Mint, TokenAccount, TokenInterface}
};

use strategy::program::Strategy;

use crate::events::VaultWithdrawlEvent;
use crate::state::{StrategyData, UserData, Vault};
use crate::utils::{accountant, strategy as strategy_utils, token, unchecked::*};
use crate::errors::ErrorCode;
use crate::constants::{
    UNDERLYING_SEED, 
    USER_DATA_SEED,
    SHARES_SEED,
    MAX_BPS,
};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: AccountLoader<'info, Vault>,

    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [UNDERLYING_SEED.as_bytes(), vault.key().as_ref()], bump)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK:
    #[account(mut, address = vault.load()?.accountant)]
    pub accountant: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = shares_mint, 
        associated_token::authority = accountant,
    )]
    pub accountant_recipient: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, seeds = [SHARES_SEED.as_bytes(), vault.key().as_ref()], bump)]
    pub shares_mint: InterfaceAccount<'info, Mint>,

    #[account(mut, address = vault.load()?.underlying_mint)]
    pub underlying_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub user_shares_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: can be missing
    #[account(
        mut,
        seeds = [
            USER_DATA_SEED.as_bytes(), 
            vault.key().as_ref(), 
            user.key().as_ref()
        ], 
        bump
        )]
    pub user_data: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub shares_token_program: Program<'info, Token>,
    pub token_program: Interface<'info, TokenInterface>,
    pub strategy_program: Program<'info, Strategy>,
}

#[derive(Default, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct AccountsIndexes {
    pub strategy_acc: u64,
    pub strategy_token_account: u64,
    pub strategy_data: u64,
    pub remaining_accounts: Vec<u64>,
}

#[derive(Default, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct AccountsMap {
    pub accounts_map: Vec<AccountsIndexes>,
}

struct StrategyAccounts<'info> {
    strategy_acc: AccountInfo<'info>,
    strategy_token_account: AccountInfo<'info>,
    strategy_data: AccountInfo<'info>,
    remaining_accounts: Vec<AccountInfo<'info>>,
}

pub fn handle_withdraw<'info>(
    ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>, 
    amount: u64, 
    max_loss: u64,
    remaining_accounts_map: AccountsMap
) -> Result<()> {
    let redemtion_fee = accountant::redeem(&ctx.accounts.accountant, amount)?;
    let assets_to_withdraw = amount - redemtion_fee;

    let fee_shares = ctx.accounts.vault.load()?.convert_to_shares(redemtion_fee);
    let shares_to_burn = ctx.accounts.vault.load()?.convert_to_shares(assets_to_withdraw);
    handle_internal(ctx, assets_to_withdraw, shares_to_burn, fee_shares, max_loss, remaining_accounts_map)
}

pub fn handle_redeem<'info>(
    ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>, 
    shares: u64, 
    max_loss: u64,
    remaining_accounts_map: AccountsMap
) -> Result<()> {
    let redemtion_fee_shares = accountant::redeem(&ctx.accounts.accountant, shares)?;
    let amount = ctx.accounts.vault.load()?.convert_to_underlying(shares-redemtion_fee_shares);
    handle_internal(ctx, amount, shares-redemtion_fee_shares, redemtion_fee_shares, max_loss, remaining_accounts_map)
}

fn handle_internal<'info>(
    ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>,
    assets: u64,
    shares_to_burn: u64,
    fee_shares: u64,
    max_loss: u64,
    remaining_accounts_map: AccountsMap
) -> Result<()> {
    if !ctx.accounts.vault.load()?.direct_withdraw_enabled {
        return Err(ErrorCode::DirectWithdrawDisabled.into());
    }
    if assets == 0 || shares_to_burn == 0 {
        return Err(ErrorCode::ZeroValue.into());
    }

    let vault_token_account = &mut ctx.accounts.vault_token_account;
    let user_shares_balance = ctx.accounts.user_shares_account.amount;
    let remaining_accounts = ctx.remaining_accounts;
    let strategies_with_accounts= parse_remaining(remaining_accounts, remaining_accounts_map)?;

    if user_shares_balance < shares_to_burn {
        return Err(ErrorCode::InsufficientShares.into());
    }

    validate_max_withdraw(
        &ctx.accounts.vault,
        user_shares_balance, 
        &strategies_with_accounts, 
        max_loss,
        assets
    )?;

    // todo: hadle min user deposit
    let assets_to_transfer = withdraw_assets(
        vault_token_account,
        &ctx.accounts.underlying_mint.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.strategy_program.to_account_info(),
        &ctx.accounts.vault,
        assets,
        &strategies_with_accounts,
    )?;

    if assets > assets_to_transfer && max_loss < MAX_BPS {
        if assets - assets_to_transfer > (assets * max_loss) / MAX_BPS {
            return Err(ErrorCode::TooMuchLoss.into());
        }
    }

    ctx.accounts.vault.load_mut()?.handle_withdraw(assets_to_transfer, shares_to_burn);

    token::burn(
        ctx.accounts.shares_token_program.to_account_info(),
        ctx.accounts.shares_mint.to_account_info(),
        ctx.accounts.user_shares_account.to_account_info(),
        ctx.accounts.user.to_account_info(),
        shares_to_burn
    )?;

    if fee_shares > 0 {
        token::transfer(
            ctx.accounts.shares_token_program.to_account_info(),
            ctx.accounts.user_shares_account.to_account_info(),
            ctx.accounts.accountant_recipient.to_account_info(),
            ctx.accounts.user.to_account_info(),
            &ctx.accounts.shares_mint,
            fee_shares,
        )?;
    }

    token::transfer_with_signer(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.vault_token_account.to_account_info(),
        ctx.accounts.user_token_account.to_account_info(),
        ctx.accounts.vault.to_account_info(),
        &ctx.accounts.underlying_mint,
        assets_to_transfer,
        &ctx.accounts.vault.load()?.seeds()
    )?;

    if !ctx.accounts.user_data.data_is_empty() {
        let mut user_data: UserData = ctx.accounts.user_data.deserialize()?;
        user_data.handle_withdraw(assets_to_transfer)?;
        ctx.accounts.user_data.serialize(&user_data)?;
    }

    let vault = ctx.accounts.vault.load()?;
    let share_price = vault.get_share_price();

    emit!(VaultWithdrawlEvent {
        vault_key: vault.key,
        total_idle: vault.total_idle,
        total_share: vault.total_shares(),
        assets_to_transfer,
        shares_to_burn,
        token_account: ctx.accounts.user_token_account.to_account_info().key(),
        share_account: ctx.accounts.user_shares_account.to_account_info().key(),
        token_mint: ctx.accounts.vault_token_account.mint,
        share_mint: ctx.accounts.shares_mint.to_account_info().key(),
        authority: ctx.accounts.user.to_account_info().key(),
        share_price,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

fn parse_remaining<'info>(
    remaining_accounts: &[AccountInfo<'info>], 
    remaining_accounts_map: AccountsMap
) -> Result<Box<Vec<StrategyAccounts<'info>>>> {
    let accounts_map = &remaining_accounts_map.accounts_map;
    let mut strategy_accounts: Vec<StrategyAccounts> = Vec::new();

    for i in 0..accounts_map.len() {
        let strategy_acc = &remaining_accounts[accounts_map[i].strategy_acc as usize];
        let strategy_token_account = &remaining_accounts[accounts_map[i].strategy_token_account as usize];
        let strategy_data = &remaining_accounts[accounts_map[i].strategy_data as usize];

        let mut strategy_remaining_accounts: Vec<AccountInfo<'info>> = Vec::new();
        if !accounts_map[i].remaining_accounts.is_empty() && accounts_map[i].remaining_accounts.len() > 0 {
            for remaining_i in accounts_map[i].remaining_accounts.iter() {
                // let acc = &remaining_accounts[remaining_i];
                strategy_remaining_accounts.push(remaining_accounts[*remaining_i as usize].clone());
            }
        }

        strategy_accounts.push(StrategyAccounts {
            strategy_acc: strategy_acc.clone(),
            strategy_token_account: strategy_token_account.clone(),
            strategy_data: strategy_data.clone(),
            remaining_accounts: strategy_remaining_accounts,
        });
    }

    Ok(Box::new(strategy_accounts))
}

fn validate_max_withdraw<'info>(
    vault_acc: &AccountLoader<'info, Vault>,
    shares: u64, 
    strategies: &Vec<StrategyAccounts<'info>>,
    max_loss: u64,
    assets: u64
) -> Result<()> {
    let vault = vault_acc.load()?;
    let mut max_assets = vault.convert_to_underlying(shares);

    if max_assets > vault.total_idle {
        let mut have = vault.total_idle;
        let mut loss = 0;

        for strategy_accounts in strategies {
            let current_debt = strategy_accounts.strategy_data.deserialize::<StrategyData>()?.current_debt;

            let mut to_withdraw = std::cmp::min(max_assets - have, current_debt);
            let mut unrealised_loss = strategy_utils::assess_share_of_unrealised_losses(
                &strategy_accounts.strategy_acc, 
                to_withdraw, 
                current_debt
            )?;
            let strategy_limit = strategy_utils::get_max_withdraw(&strategy_accounts.strategy_acc)?;

            if strategy_limit < to_withdraw - unrealised_loss {
                let new_unrealised_loss = (unrealised_loss * strategy_limit) / to_withdraw;
                unrealised_loss = new_unrealised_loss;
                to_withdraw = strategy_limit + unrealised_loss;
            }

            if to_withdraw == 0 {
                continue;
            }

            if unrealised_loss > 0 && max_loss < MAX_BPS {
                if loss + unrealised_loss > ((have + to_withdraw) * max_loss) / MAX_BPS {
                    break;
                }
            }

            have += to_withdraw;
            if have >= max_assets {
                break;
            }

            loss += unrealised_loss;
        }
        max_assets = have;
    }

    if assets > max_assets {
        return Err(ErrorCode::ExceedWithdrawLimit.into());
    }

    Ok(())
}

fn withdraw_assets<'info>(
    vault_token_account: &mut InterfaceAccount<'info, TokenAccount>,
    underlying_mint: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    strategy_program: &AccountInfo<'info>,
    vault_acc: &AccountLoader<'info, Vault>,
    assets: u64,
    strategies: &Vec<StrategyAccounts<'info>>, 
) -> Result<u64> {
    let vault = vault_acc.load()?.clone();
    let mut requested_assets = assets;
    let mut total_idle = vault.total_idle;
    let mut total_debt = vault.total_debt;

    if requested_assets > total_idle {
        let mut assets_needed = requested_assets - total_idle;

        for i in 0..strategies.len() {
            let strategy_acc = &strategies[i].strategy_acc;
            let mut current_debt = strategies[i].strategy_data.deserialize::<StrategyData>()?.current_debt;

            let mut to_withdraw = std::cmp::min(assets_needed as u64, current_debt);
            let strategy_limit = strategy_utils::get_max_withdraw(&strategy_acc)?;
            let mut unrealised_loss_share = strategy_utils::assess_share_of_unrealised_losses(
                &strategy_acc,
                to_withdraw, 
                current_debt
            )?;

            if unrealised_loss_share > 0 {
                if strategy_limit < to_withdraw - unrealised_loss_share {
                    let wanted = to_withdraw - unrealised_loss_share;
                    unrealised_loss_share = (unrealised_loss_share * strategy_limit) / wanted;
                    to_withdraw = strategy_limit;
                } else {
                    to_withdraw -= unrealised_loss_share;
                }

                requested_assets -= unrealised_loss_share;
                assets_needed -= unrealised_loss_share;
                total_debt -= unrealised_loss_share;

                if strategy_limit == 0 && unrealised_loss_share > 0 {
                    current_debt = current_debt - unrealised_loss_share;
                }
            }

            to_withdraw = std::cmp::min(to_withdraw, strategy_limit);

            if to_withdraw == 0 {
                continue;
            }

            let withdrawn = strategy_utils::withdraw(
                strategy_acc.to_account_info(),
                vault_acc.to_account_info(),
                strategies[i].strategy_token_account.to_account_info(),
                underlying_mint.to_account_info(),
                vault_token_account,
                token_program.to_account_info(),
                strategy_program.to_account_info(),
                to_withdraw,
                &[&vault.seeds()],
                strategies[i].remaining_accounts.clone()
            )?;

            let mut loss = 0;

            if withdrawn > to_withdraw {
                if withdrawn > current_debt {
                    to_withdraw = current_debt;
                } else {
                    to_withdraw = withdrawn;
                }
            } else if withdrawn < to_withdraw {
                loss = to_withdraw - withdrawn;
            }

            total_idle += to_withdraw - loss;
            requested_assets -= loss;
            total_debt -= to_withdraw;

            let new_debt: u64 = current_debt - (to_withdraw + unrealised_loss_share);

            let vault_mut = &mut vault_acc.load_mut()?;

            let mut strategy_data: StrategyData = strategies[i].strategy_data.deserialize()?;
            strategy_data.update_current_debt(new_debt)?;
            strategies[i].strategy_data.serialize(strategy_data)?;

            vault_mut.total_debt = total_debt;
            vault_mut.total_idle = total_idle;

            if requested_assets <= total_idle {
                break;
            }

            assets_needed -= to_withdraw;
        }

        if total_idle < requested_assets {
            return Err(ErrorCode::InsufficientFunds.into());
        }
    }

    Ok(requested_assets)
}
