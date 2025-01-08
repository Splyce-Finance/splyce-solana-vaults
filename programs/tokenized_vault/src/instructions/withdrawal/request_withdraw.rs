use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_interface::{Mint, TokenAccount}
};

use crate::events::WithdrawalRequestedEvent;
use crate::state::{Config, Vault, WithdrawRequest};
use crate::utils::{accountant, token};
use crate::errors::ErrorCode;
use crate::constants::{
    CONFIG_SEED,
    SHARES_SEED,
    WITHDRAW_SHARES_ACCOUNT_SEED,
    WITHDRAW_REQUEST_SEED
};

#[derive(Accounts)]
pub struct RequestWithdraw<'info> {
    #[account(mut)]
    pub vault: AccountLoader<'info, Vault>,

    #[account(mut, seeds = [SHARES_SEED.as_bytes(), vault.key().as_ref()], bump)]
    pub shares_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub user_shares_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = vault.load()?.underlying_mint)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        space = WithdrawRequest::LEN,
        payer = user,
        seeds = [
            WITHDRAW_REQUEST_SEED.as_bytes(), 
            vault.key().as_ref(), 
            user.key().as_ref(),
            config.next_withdraw_request_index.to_le_bytes().as_ref()
        ], 
        bump
        )]
    pub withdraw_request: Account<'info, WithdrawRequest>,

    #[account(mut, seeds = [WITHDRAW_SHARES_ACCOUNT_SEED.as_bytes(), vault.key().as_ref()], bump)]
    pub withdraw_pool_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
        
    #[account(seeds = [CONFIG_SEED.as_bytes()], bump)]
    pub config: Box<Account<'info, Config>>,

    /// CHECK:
    #[account(mut, address = vault.load()?.accountant)]
    pub accountant: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub user: Signer<'info>,

    pub shares_token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_request_withdraw<'info>(
    ctx: Context<'_, '_, '_, 'info, RequestWithdraw<'info>>, 
    amount: u64, 
    max_loss: u64,
) -> Result<()> {
    let redemtion_fee = accountant::redeem(&ctx.accounts.accountant, amount)?;
    let assets_to_withdraw = amount - redemtion_fee;

    let fee_shares = ctx.accounts.vault.load()?.convert_to_shares(redemtion_fee);
    let shares_to_burn = ctx.accounts.vault.load()?.convert_to_shares(assets_to_withdraw);
    handle_internal(ctx, assets_to_withdraw, shares_to_burn, fee_shares, max_loss)
}

pub fn handle_request_redeem<'info>(
    ctx: Context<'_, '_, '_, 'info, RequestWithdraw<'info>>, 
    shares: u64, 
    max_loss: u64,
) -> Result<()> {
    let redemtion_fee_shares = accountant::redeem(&ctx.accounts.accountant, shares)?;
    let amount = ctx.accounts.vault.load()?.convert_to_underlying(shares-redemtion_fee_shares);
    handle_internal(ctx, amount, shares-redemtion_fee_shares, redemtion_fee_shares, max_loss)
}

fn handle_internal<'info>(
    ctx: Context<'_, '_, '_, 'info, RequestWithdraw<'info>>,
    assets: u64,
    shares_to_burn: u64,
    fee_shares: u64,
    max_loss: u64,
) -> Result<()> {

    let vault = ctx.accounts.vault.load()?;
    if vault.is_shutdown {
        return Err(ErrorCode::VaultShutdown.into());
    }

    if vault.direct_withdraw_enabled {
        return Err(ErrorCode::WithdrawRequestsDisabled.into());
    }

    if assets == 0 || shares_to_burn == 0 {
        return Err(ErrorCode::ZeroValue.into());
    }

    ctx.accounts.withdraw_request.init(
        assets, 
        ctx.accounts.vault.key(),
        ctx.accounts.user.key(),
        ctx.accounts.user_token_account.key(),
        ctx.accounts.user_shares_account.key(),
        shares_to_burn, 
        max_loss,
        fee_shares,
        ctx.accounts.config.next_withdraw_request_index
    )?;

    ctx.accounts.config.next_withdraw_request_index += 1;

    token::transfer(
        ctx.accounts.shares_token_program.to_account_info(),
        ctx.accounts.user_shares_account.to_account_info(),
        ctx.accounts.withdraw_pool_token_account.to_account_info(),
        ctx.accounts.user.to_account_info(),
        &ctx.accounts.shares_mint,
        shares_to_burn,
    )?;

    emit!(WithdrawalRequestedEvent {
        vault: ctx.accounts.withdraw_request.vault,
        user: ctx.accounts.withdraw_request.user,
        amount: assets,
        shares: shares_to_burn,
        recipient: ctx.accounts.withdraw_request.recipient,
        max_loss,
        fee_shares,
        index: ctx.accounts.withdraw_request.index,
    });

    Ok(())
}