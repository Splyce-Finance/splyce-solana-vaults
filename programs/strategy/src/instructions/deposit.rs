use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::error::ErrorCode;
use crate::utils::token::transfer;
use crate::utils::unchecked_strategy::UncheckedStrategy;
use crate::constants::UNDERLYING_SEED;
use crate::StrategyType;
use crate::instructions::deploy_funds::DeployFunds;

#[derive(Accounts)]
pub struct Deposit<'info> {
    /// CHECK: can by any strategy
    #[account(mut)]
    pub strategy: UncheckedAccount<'info>,

    #[account(mut, seeds = [UNDERLYING_SEED.as_bytes(), strategy.key().as_ref()], bump)]
    pub underlying_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, constraint = underlying_mint.key() == strategy.underlying_mint())]
    pub underlying_mint: InterfaceAccount<'info, Mint>,

    #[account(constraint = signer.key() == strategy.vault() @ErrorCode::AccessDenied)]
    pub signer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_deposit<'info>(
    ctx: Context<'_, '_, '_, 'info, Deposit<'info>>,
    amount: u64,
) -> Result<()> {
    let mut strategy = ctx.accounts.strategy.from_unchecked()?;

    let max_deposit = strategy.available_deposit();

    if amount > max_deposit {
        return Err(ErrorCode::MaxDepositReached.into());
    }

    transfer(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.vault_token_account.to_account_info(), 
        ctx.accounts.underlying_token_account.to_account_info(), 
        ctx.accounts.signer.to_account_info(), 
        &ctx.accounts.underlying_mint,
        amount
    )?;

    strategy.deposit(amount)?;

    //if strategy type is orca, we need to call deploy_funds
    if strategy.strategy_type() == StrategyType::Orca {
        // Create DeployFunds accounts struct from existing Deposit accounts
        let deploy_funds = DeployFunds {
            strategy: ctx.accounts.strategy.clone(),
            underlying_token_account: ctx.accounts.underlying_token_account.clone(),
            underlying_mint: ctx.accounts.underlying_mint.clone(),
            signer: ctx.accounts.signer.clone(),
            token_program: ctx.accounts.token_program.clone(),
        };
        strategy.deploy_funds(&deploy_funds, &ctx.remaining_accounts, amount)?;
    }

    strategy.save_changes(&mut &mut ctx.accounts.strategy.try_borrow_mut_data()?[8..])?;
    
    Ok(())
}