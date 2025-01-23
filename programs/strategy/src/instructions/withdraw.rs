use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::error::ErrorCode;
use crate::utils::unchecked_strategy::UncheckedStrategy;
use crate::utils::token;
use crate::instructions::FreeFunds;
use crate::constants::UNDERLYING_SEED;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// CHECK: can by any strategy
    #[account(mut)]
    pub strategy: UncheckedAccount<'info>,

    #[account(mut, seeds = [UNDERLYING_SEED.as_bytes(), strategy.key().as_ref()], bump)]
    pub underlying_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, constraint = underlying_mint.key() == strategy.underlying_mint())]
    pub underlying_mint: InterfaceAccount<'info, Mint>,
    
    #[account(constraint = signer.key() == strategy.vault() @ErrorCode::AccessDenied)]
    pub signer: Signer<'info>,

    #[account(mut)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_withdraw<'info>(
    ctx:  Context<'_, '_, '_, 'info, Withdraw<'info>>,
    amount: u64,
) -> Result<()> {
    let mut strategy = ctx.accounts.strategy.from_unchecked()?;

    if amount > strategy.available_withdraw() {
        return Err(ErrorCode::InsufficientFunds.into());
    }

    let balance = ctx.accounts.underlying_token_account.amount;
    if amount > balance {
        let free_funds = &mut FreeFunds {
            strategy: ctx.accounts.strategy.clone(),
            underlying_token_account: ctx.accounts.underlying_token_account.clone(),
            underlying_mint: ctx.accounts.underlying_mint.clone(),
            signer: ctx.accounts.signer.clone(),
            token_program: ctx.accounts.token_program.clone(),
        };
        strategy.free_funds(free_funds, &ctx.remaining_accounts, amount - balance)?;
    }

    strategy.withdraw(amount)?;
    strategy.save_changes(&mut &mut ctx.accounts.strategy.try_borrow_mut_data()?[8..])?;
    
    token::transfer_with_signer(
        ctx.accounts.token_program.to_account_info(), 
        ctx.accounts.underlying_token_account.to_account_info(), 
        ctx.accounts.vault_token_account.to_account_info(), 
        ctx.accounts.strategy.to_account_info(), 
        &ctx.accounts.underlying_mint,
        amount, 
        &strategy.seeds()
    )?;
    Ok(())
}
