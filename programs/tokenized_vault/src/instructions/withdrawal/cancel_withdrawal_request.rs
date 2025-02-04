use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_interface::{Mint, TokenAccount}
};

use crate::events::WithdrawalRequestCanceledEvent;
use crate::state::{Vault, WithdrawRequest};
use crate::utils::token;
use crate::constants::{SHARES_SEED,WITHDRAW_SHARES_ACCOUNT_SEED};

#[derive(Accounts)]
pub struct CancelWithdrawalRequest<'info> {
    #[account(mut, address = withdraw_request.vault)]
    pub vault: AccountLoader<'info, Vault>,

    #[account(mut, close = user)]
    pub withdraw_request: Account<'info, WithdrawRequest>,

    #[account(mut, token::mint = shares_mint)]
    pub user_shares_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SHARES_SEED.as_bytes(), vault.key().as_ref()], bump)]
    pub shares_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut, 
        seeds = [
            WITHDRAW_SHARES_ACCOUNT_SEED.as_bytes(), 
            vault.key().as_ref()
        ], 
        bump
    )]
    pub withdraw_pool_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
        
    #[account(mut, address = withdraw_request.user)]
    pub user: Signer<'info>,

    pub shares_token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_cancel_withdrawal_request(
    ctx: Context<CancelWithdrawalRequest>, 
) -> Result<()> {

    token::transfer_with_signer(
        ctx.accounts.shares_token_program.to_account_info(),
        ctx.accounts.withdraw_pool_token_account.to_account_info(),
        ctx.accounts.user_shares_account.to_account_info(),
        ctx.accounts.vault.to_account_info(),
        &ctx.accounts.shares_mint,
        ctx.accounts.withdraw_request.locked_shares,
        &ctx.accounts.vault.load()?.seeds()
    )?;

    emit!(WithdrawalRequestCanceledEvent {
        vault: ctx.accounts.withdraw_request.vault,
        user: ctx.accounts.withdraw_request.user,
        index: ctx.accounts.withdraw_request.index,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}