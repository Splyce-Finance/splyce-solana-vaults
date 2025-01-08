use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_interface::{Mint, TokenAccount, TokenInterface}
};

use crate::errors::ErrorCode;
use crate::events::{VaultWithdrawlEvent, WithdrawalRequestFulfilledEvent};
use crate::state::{UserData, Vault, WithdrawRequest};
use crate::utils::{token, unchecked::*};
use crate::constants::{
    SHARES_SEED,
    UNDERLYING_SEED,
    WITHDRAW_SHARES_ACCOUNT_SEED,
    MAX_BPS,
    USER_DATA_SEED
};

#[derive(Accounts)]
pub struct FulfillWithdrawalRequest<'info> {
    #[account(mut, close = user)]
    pub withdraw_request: Account<'info, WithdrawRequest>,

    #[account(mut, address = withdraw_request.vault)]
    pub vault: AccountLoader<'info, Vault>,

    #[account(mut, seeds = [UNDERLYING_SEED.as_bytes(), vault.key().as_ref()], bump)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK:
    #[account(mut, address = withdraw_request.user)]
    pub user: AccountInfo<'info>,

    #[account(mut, address = withdraw_request.recipient)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SHARES_SEED.as_bytes(), vault.key().as_ref()], bump)]
    pub shares_mint: InterfaceAccount<'info, Mint>,

    #[account(mut, address = vault.load()?.underlying_mint)]
    pub underlying_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut, 
        seeds = [
            WITHDRAW_SHARES_ACCOUNT_SEED.as_bytes(), 
            vault.key().as_ref()
        ], 
        bump
    )]
    pub withdraw_pool_shares_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK:
    #[account(mut, address = vault.load()?.accountant)]
    pub accountant: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = shares_mint, 
        associated_token::authority = accountant,
    )]
    pub accountant_recipient: Box<InterfaceAccount<'info, TokenAccount>>,

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
    pub signer: Signer<'info>,

    pub shares_token_program: Program<'info, Token>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_fulfill_withdrawal_request<'info>(ctx: Context<'_, '_, '_, 'info, FulfillWithdrawalRequest<'info>>
) -> Result<()> {

    let fee_shares = ctx.accounts.withdraw_request.fee_shares;
    let shares_to_burn = ctx.accounts.withdraw_request.locked_shares - fee_shares;
    let assets_to_transfer = ctx.accounts.vault.load()?.convert_to_underlying(shares_to_burn);

    // 0. check if amount >= requestded amount - max_loss
    let min_amount = (ctx.accounts.withdraw_request.requested_amount as u128 * ctx.accounts.withdraw_request.max_loss as u128) / MAX_BPS as u128;
    if assets_to_transfer < min_amount as u64 {
        return Err(ErrorCode::TooMuchLoss.into());
    }

    if assets_to_transfer > ctx.accounts.vault_token_account.amount {
        return Err(ErrorCode::InsufficientFunds.into());
    }

    // 1. burn shares
    token::burn_with_signer(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.shares_mint.to_account_info(),
        ctx.accounts.withdraw_pool_shares_account.to_account_info(),
        ctx.accounts.vault.to_account_info(),
        shares_to_burn,
        &ctx.accounts.vault.load()?.seeds(),
    )?;

    // 2. trasfer fee shares to accountant
    if fee_shares > 0 {
        token::transfer(
            ctx.accounts.shares_token_program.to_account_info(),
            ctx.accounts.withdraw_pool_shares_account.to_account_info(),
            ctx.accounts.accountant_recipient.to_account_info(),
            ctx.accounts.user.to_account_info(),
            &ctx.accounts.shares_mint,
            fee_shares,
        )?;
    }

    // 3. transfer underlying from vault to user
    token::transfer_with_signer(
        ctx.accounts.shares_token_program.to_account_info(),
        ctx.accounts.vault_token_account.to_account_info(),
        ctx.accounts.user_token_account.to_account_info(),
        ctx.accounts.vault.to_account_info(),
        &ctx.accounts.underlying_mint,
        assets_to_transfer,
        &ctx.accounts.vault.load()?.seeds()
    )?;

    ctx.accounts.vault.load_mut()?.handle_withdraw(assets_to_transfer, shares_to_burn);

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
        token_account: ctx.accounts.withdraw_request.recipient,
        share_account: ctx.accounts.withdraw_request.shares_account,
        token_mint: ctx.accounts.vault_token_account.mint,
        share_mint: ctx.accounts.shares_mint.to_account_info().key(),
        authority: ctx.accounts.withdraw_request.user,
        share_price,
        timestamp: Clock::get()?.unix_timestamp,
    });

    emit!(WithdrawalRequestFulfilledEvent {
        vault: ctx.accounts.withdraw_request.vault,
        user: ctx.accounts.withdraw_request.user,
        amount: assets_to_transfer,
        index: ctx.accounts.withdraw_request.index,
    });

    Ok(())
}