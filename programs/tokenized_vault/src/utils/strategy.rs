use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;
 
use strategy::utils::deserialize;
use strategy::cpi::accounts::{
    Deposit,
    Withdraw
};
use strategy::StrategyType;

pub fn deposit<'a>(
    strategy: AccountInfo<'a>,
    vault: AccountInfo<'a>,
    underlying_token_account: AccountInfo<'a>,
    underlying_mint: AccountInfo<'a>,
    vault_token_account: AccountInfo<'a>,
    token_program: AccountInfo<'a>,
    strategy_program: AccountInfo<'a>,
    assets_to_deposit: u64,
    seeds: &[&[&[u8]]],
    remaining_accounts: Vec<AccountInfo<'a>>,
) -> Result<()> {
    let mut ctx = CpiContext::new_with_signer(
        strategy_program,
        Deposit {
            strategy,
            signer: vault,
            underlying_token_account,
            underlying_mint,
            vault_token_account,
            token_program,
        },
        seeds,  // Pass in the seeds from the previously loaded vault
    );
    ctx.remaining_accounts = remaining_accounts;

    // Perform the CPI deposit with pre-extracted data
    strategy::cpi::deposit(ctx, assets_to_deposit)
}

pub fn withdraw<'a>(
    strategy: AccountInfo<'a>,
    vault: AccountInfo<'a>,
    underlying_token_account: AccountInfo<'a>,
    underlying_mint: AccountInfo<'a>,
    vault_token_account: &mut InterfaceAccount<'a, TokenAccount>,
    token_program: AccountInfo<'a>,
    strategy_program: AccountInfo<'a>,
    assets_to_withdraw: u64,
    seeds: &[&[&[u8]]],
    remaining_accounts: Vec<AccountInfo<'a>>,
) -> Result<u64> {
    let pre_balance = vault_token_account.amount;

    let mut ctx = CpiContext::new_with_signer(
        strategy_program, 
        Withdraw {
            strategy,
            underlying_token_account,
            underlying_mint,
            signer: vault,
            vault_token_account: vault_token_account.to_account_info(),
            token_program,
        },
        seeds,
    );
    
    ctx.remaining_accounts = remaining_accounts;

    strategy::cpi::withdraw(ctx, assets_to_withdraw)?;

    vault_token_account.reload()?;
    let post_balance = vault_token_account.amount;

    Ok(post_balance - pre_balance)
}

pub fn get_vault(strategy_acc: &AccountInfo) -> Result<Pubkey> {
    let strategy = deserialize(strategy_acc)?;
    Ok(strategy.vault())
}

pub fn get_max_withdraw(strategy_acc: &AccountInfo) -> Result<u64> {
    let strategy = deserialize(strategy_acc)?;
    Ok(strategy.available_withdraw())
}

pub fn get_max_deposit(strategy_acc: &AccountInfo) -> Result<u64> {
    let strategy = deserialize(strategy_acc)?;
    Ok(strategy.available_deposit())
}

pub fn get_total_assets(strategy_acc: &AccountInfo) -> Result<u64> {
    let strategy = deserialize(strategy_acc)?;
    Ok(strategy.total_assets())
}

pub fn get_total_invested(strategy_acc: &AccountInfo) -> Result<u64> {
    let strategy = deserialize(strategy_acc)?;
    Ok(strategy.total_invested())
}

pub fn get_token_account_key(strategy_acc: &AccountInfo) -> Result<Pubkey> {
    let strategy = deserialize(strategy_acc)?;
    Ok(strategy.token_account())
}

pub fn get_strategy_type(strategy_acc: &AccountInfo) -> Result<StrategyType> {
    let strategy = deserialize(strategy_acc)?;
    Ok(strategy.strategy_type())
}

pub fn assess_share_of_unrealised_losses(
    strategy_acc: &AccountInfo,
    assets_needed: u64,
    strategy_current_debt: u64,
) -> Result<u64> {
    let strategy_assets = get_total_assets(strategy_acc)?;
    if strategy_assets >= strategy_current_debt || strategy_current_debt == 0 {
        return Ok(0);
    }

    let numerator: u128 = assets_needed as u128 * strategy_assets as u128;
    let losses_user_share = assets_needed as u128 - numerator / strategy_current_debt as u128;

    Ok(losses_user_share as u64)
}