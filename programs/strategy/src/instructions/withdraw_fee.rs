use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::error::ErrorCode;
use crate::utils::unchecked_strategy::UncheckedStrategy;
use crate::utils::token;
use crate::constants::UNDERLYING_SEED;

use super::FreeFunds;

#[derive(Accounts)]
pub struct WithdrawFee<'info> {
    /// CHECK: can by any strategy
    #[account(mut)]
    pub strategy: UncheckedAccount<'info>,

    #[account(mut, seeds = [UNDERLYING_SEED.as_bytes(), strategy.key().as_ref()], bump)]
    pub underlying_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, constraint = underlying_mint.key() == strategy.underlying_mint())]
    pub underlying_mint: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(mut)]
    pub recipient: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_withdraw_fee<'info>(
    ctx: Context<'_, '_, '_, 'info, WithdrawFee<'info>>,
    amount: u64,
) -> Result<()> {
    let mut strategy = ctx.accounts.strategy.from_unchecked()?;

    let fee_data = strategy.fee_data();

    if *ctx.accounts.signer.key != fee_data.fee_manager() {
        return Err(ErrorCode::AccessDenied.into());
    }

    if amount > fee_data.fee_balance {
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

    strategy.withdraw_fees(amount)?;
    strategy.save_changes(&mut &mut ctx.accounts.strategy.try_borrow_mut_data()?[8..])?;

    token::transfer_with_signer(
        ctx.accounts.token_program.to_account_info(), 
        ctx.accounts.underlying_token_account.to_account_info(), 
        ctx.accounts.recipient.to_account_info(), 
        ctx.accounts.strategy.to_account_info(), 
        &ctx.accounts.underlying_mint,
        amount, 
        &strategy.seeds()
    )
}