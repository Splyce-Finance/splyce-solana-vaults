use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_interface::{ Mint, TokenAccount},
};
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::{UserRole, Role}
};

use crate::constants::{ MAX_BPS_EXTENDED, SHARES_ACCOUNT_SEED, SHARES_SEED, STRATEGY_DATA_SEED, ONE_SHARE_TOKEN};
use crate::events::StrategyReportedEvent;
use crate::state::{Vault, StrategyData};
use crate::utils::{accountant, strategy, token};

#[derive(Accounts)]
pub struct ProcessReport<'info> {
    #[account(mut)]
    pub vault: AccountLoader<'info, Vault>,

    /// CHECK: can by any strategy
    #[account()]
    pub strategy: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [
            STRATEGY_DATA_SEED.as_bytes(),
            vault.key().as_ref(),
            strategy.key().as_ref()
        ],
        bump,
    )]
    pub strategy_data: Account<'info, StrategyData>,

    #[account(mut, seeds = [SHARES_SEED.as_bytes(), vault.key().as_ref()], bump)]
    pub shares_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, seeds = [SHARES_ACCOUNT_SEED.as_bytes(), vault.key().as_ref()], bump)]
    pub vault_shares_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK:
    #[account(mut, address = vault.load()?.accountant)]
    pub accountant: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = shares_mint, 
        associated_token::authority = accountant,
    )]
    pub accountant_recipient: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [
            USER_ROLE_SEED.as_bytes(), 
            signer.key().as_ref(),
            Role::ReportingManager.to_seed().as_ref()
        ], 
        bump,
        seeds::program = access_control.key()
    )]
    pub roles: Account<'info, UserRole>,

    #[account(mut, constraint = roles.check_role()?)]
    pub signer: Signer<'info>,

    pub access_control: Program<'info, AccessControl>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_process_report(ctx: Context<ProcessReport>) -> Result<()> {
    let strategy_assets = strategy::get_total_assets(&ctx.accounts.strategy)?;
    let strategy = &ctx.accounts.strategy;

    let mut profit: u64 = 0;
    let mut loss: u64 = 0;
    let mut fee_shares: u64 = 0;

    burn_unlocked_shares(&ctx)?;
    ctx.accounts.vault_shares_token_account.reload()?;
    let current_debt = ctx.accounts.strategy_data.current_debt;
    
    if strategy_assets > current_debt {
        profit = strategy_assets - current_debt;
        let (total_fees, _) = accountant::report(&ctx.accounts.accountant, profit, 0)?;
        fee_shares = ctx.accounts.vault.load()?.convert_to_shares(total_fees);
        handle_profit(&ctx, profit, total_fees)?;

        if fee_shares > 0 {
            issue_fee_shares(&ctx, fee_shares)?;
        }
    } else {
        loss = current_debt - strategy_assets;
        handle_loss(&ctx, loss)?;
    }
    msg!("after handling profit/loss");

    ctx.accounts.strategy_data.update_current_debt(strategy_assets)?;

    let share_price = ctx.accounts.vault.load()?.get_share_price();

    msg!("share_price: {}", share_price);

    emit!(StrategyReportedEvent {
        vault_key: ctx.accounts.vault.key(),
        strategy_key: strategy.key(),
        gain: profit,
        loss,
        current_debt: strategy_assets,
        protocol_fees: 0, //TODO: this is set as 0
        total_fees: fee_shares,
        total_shares: ctx.accounts.vault.load()?.total_shares(),
        share_price,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

fn issue_fee_shares(ctx: &Context<ProcessReport>, fee_shares: u64) -> Result<u64> {
    let vault = &mut ctx.accounts.vault.load_mut()?;

    token::mint_to(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.shares_mint.to_account_info(),
        ctx.accounts.accountant_recipient.to_account_info(),
        ctx.accounts.shares_mint.to_account_info(),
        fee_shares,
        &vault.seeds_shares()
    )?;

    vault.total_shares += fee_shares;
    Ok(fee_shares)
}

fn handle_profit(ctx: &Context<ProcessReport>, profit: u64, fees: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault.load_mut()?;
  
    let mut shares_to_lock = 0;
    if vault.profit_max_unlock_time != 0 {
        // we don't lock fee shares
        let amount_to_lock = profit - fees;
        shares_to_lock = vault.convert_to_shares(amount_to_lock);

        let curr_locked_shares = ctx.accounts.vault_shares_token_account.amount;
        let newly_locked_shares = curr_locked_shares + shares_to_lock;
    
        let curr_timestamp = get_timestamp()?;

        let total_locked_shares = curr_locked_shares + newly_locked_shares;

        if total_locked_shares > 0 {
            let mut previously_locked_time: u128 = 0;
                
            if vault.full_profit_unlock_date > curr_timestamp {
                previously_locked_time =
                    (curr_locked_shares as u128) * ((vault.full_profit_unlock_date - curr_timestamp) as u128);
            }

            let new_profit_locking_period = (previously_locked_time
                + (newly_locked_shares as u128) * (vault.profit_max_unlock_time as u128))
                / (total_locked_shares as u128);

            vault.profit_unlocking_rate =
                ((total_locked_shares as u128) * (MAX_BPS_EXTENDED as u128) / new_profit_locking_period) as u64;
            vault.full_profit_unlock_date = curr_timestamp + (new_profit_locking_period as u64);
            vault.last_profit_update = curr_timestamp;
        } else {
            // NOTE: only setting this to 0 will turn in the desired effect, no need
            // to update lastProfitUpdate or fullProfitUnlockDate
            vault.profit_unlocking_rate = 0;
        }

        // mint shares to lock
        token::mint_to(
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.shares_mint.to_account_info(),
            ctx.accounts.vault_shares_token_account.to_account_info(),
            ctx.accounts.shares_mint.to_account_info(),
            shares_to_lock,
            &vault.seeds_shares()
        )?;
    }

    vault.total_debt += profit;
    vault.total_shares += shares_to_lock;

    Ok(())
}

fn handle_loss(ctx: &Context<ProcessReport>, loss: u64) -> Result<()> {
    let loss_shares = ctx.accounts.vault.load()?.convert_to_shares(loss);
    let shares_to_burn = std::cmp::min(ctx.accounts.vault_shares_token_account.amount, loss_shares);

    token::burn_with_signer(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.shares_mint.to_account_info(),
        ctx.accounts.vault_shares_token_account.to_account_info(),
        ctx.accounts.vault.to_account_info(),
        shares_to_burn,
        &ctx.accounts.vault.load()?.seeds(),
    )?;

    let vault = &mut ctx.accounts.vault.load_mut()?;
    vault.total_debt -= loss;
    vault.last_profit_update = get_timestamp()?;
    vault.total_shares -= shares_to_burn;

    Ok(())
}

fn burn_unlocked_shares(ctx: &Context<ProcessReport>) -> Result<()> {
    let shares_to_burn: u64 = get_shares_to_burn(
        &ctx.accounts.vault, 
        ctx.accounts.vault_shares_token_account.amount
    )?;
   
    if shares_to_burn == 0 {
        return Ok(());
    }

    // Burn the shares unlocked.
    token::burn_with_signer(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.shares_mint.to_account_info(),
        ctx.accounts.vault_shares_token_account.to_account_info(),
        ctx.accounts.vault.to_account_info(),
        shares_to_burn,
        &ctx.accounts.vault.load()?.seeds(),
    )?;


    let mut vault = ctx.accounts.vault.load_mut()?;
    vault.total_shares -= shares_to_burn;

    Ok(())
}

fn get_shares_to_burn(vault_loader: &AccountLoader<Vault>, total_locked: u64) -> Result<u64> {
    let vault = vault_loader.load()?;
    let curr_timestamp = Clock::get()?.unix_timestamp as u64;
    let mut shares_to_burn: u64 = 0;

    if vault.full_profit_unlock_date > curr_timestamp {
        // Convert to u128 for the multiplication, then back to u64 for the result
        shares_to_burn = ((vault.profit_unlocking_rate as u128) * 
            ((curr_timestamp - vault.last_profit_update) as u128) / 
            (MAX_BPS_EXTENDED as u128)) as u64;
    } else if vault.full_profit_unlock_date != 0 {
        shares_to_burn = total_locked;
    }

    if shares_to_burn > total_locked {
        shares_to_burn = total_locked;
    }

    Ok(shares_to_burn)
}

fn get_timestamp() -> Result<u64> {
    Ok(Clock::get()?.unix_timestamp as u64)
}