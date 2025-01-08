use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::Role
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_interface::{Mint, TokenAccount},
};
use strategy::program::Strategy;

use crate::constants::{SHARES_SEED, STRATEGY_DATA_SEED, UNDERLYING_SEED, USER_DATA_SEED, ONE_SHARE_TOKEN};

use crate::events::{VaultDepositEvent, UpdatedCurrentDebtForStrategyEvent};
use crate::state::{StrategyData, UserData, Vault};
use crate::utils::{token, vault};
use crate::utils::strategy as strategy_utils;

#[derive(Accounts)]
pub struct DirectDeposit<'info> {
    #[account(mut)]
    pub vault: AccountLoader<'info, Vault>,

    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [UNDERLYING_SEED.as_bytes(), vault.key().as_ref()], bump)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SHARES_SEED.as_bytes(), vault.key().as_ref()], bump)]
    pub shares_mint: InterfaceAccount<'info, Mint>,

    #[account(mut, address = vault.load()?.underlying_mint)]
    pub underlying_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub user_shares_account: InterfaceAccount <'info, TokenAccount>,

    /// CHECK: Should this be mut?
    #[account(mut)]
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

    #[account(
        mut, 
        seeds = [UNDERLYING_SEED.as_bytes(), strategy.key().as_ref()],
        bump,
        seeds::program = strategy_program.key(),
    )]
    pub strategy_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: this account may not exist
    #[account(
        seeds = [
            USER_ROLE_SEED.as_bytes(), 
            user.key().as_ref(),
            Role::KYCVerified.to_seed().as_ref()
        ], 
        bump,
        seeds::program = access_control.key()
    )]
    pub kyc_verified: UncheckedAccount<'info>,

    #[account(
        init_if_needed, 
        payer = user,
        space = UserData::LEN,
        seeds = [
            USER_DATA_SEED.as_bytes(), 
            vault.key().as_ref(), 
            user.key().as_ref()
        ], 
        bump
        )]
    pub user_data: Account<'info, UserData>,  

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub access_control: Program<'info, AccessControl>,
    pub strategy_program: Program<'info, Strategy>,
}

pub fn handle_direct_deposit<'info>(ctx: Context<'_, '_, '_, 'info, DirectDeposit<'info>>, amount: u64) -> Result<()> {
    vault::validate_deposit(
        &ctx.accounts.vault, 
        &ctx.accounts.kyc_verified.to_account_info(),
        &ctx.accounts.user_data,
        true,
        amount
    )?;

    let shares = ctx.accounts.vault.load()?.convert_to_shares(amount);

    token::transfer(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.user_token_account.to_account_info(),
        ctx.accounts.vault_token_account.to_account_info(),
        ctx.accounts.user.to_account_info(),
        &ctx.accounts.underlying_mint,
        amount,
    )?;

    ctx.accounts.vault_token_account.reload()?;

    strategy_utils::deposit(
        ctx.accounts.strategy.to_account_info(),
        ctx.accounts.vault.to_account_info(),
        ctx.accounts.strategy_token_account.to_account_info(),
        ctx.accounts.underlying_mint.to_account_info(),
        ctx.accounts.vault_token_account.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.strategy_program.to_account_info(),
        amount,
        &[&ctx.accounts.vault.load()?.seeds()],
        ctx.remaining_accounts.to_vec(),
    )?;

    token::mint_to(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.shares_mint.to_account_info(),
        ctx.accounts.user_shares_account.to_account_info(),
        ctx.accounts.shares_mint.to_account_info(),
        shares,
        &ctx.accounts.vault.load()?.seeds_shares(),
    )?;

    let mut vault = ctx.accounts.vault.load_mut()?;

    ctx.accounts.strategy_data.increase_current_debt(amount)?;

    vault.handle_direct_deposit(amount, shares);

    let share_price = vault.get_share_price();

    emit!(VaultDepositEvent {
        vault_key: vault.key,
        total_debt: vault.total_debt,
        total_idle: vault.total_idle,
        total_share: vault.total_shares(),
        amount,
        share: shares,
        token_account: ctx.accounts.user_token_account.to_account_info().key(),
        share_account: ctx.accounts.user_shares_account.to_account_info().key(),
        token_mint: ctx.accounts.vault_token_account.mint,
        share_mint: ctx.accounts.shares_mint.to_account_info().key(),
        authority: ctx.accounts.user.to_account_info().key(),
        share_price,
        timestamp: Clock::get()?.unix_timestamp,
    });

    emit!(UpdatedCurrentDebtForStrategyEvent {
        vault_key: vault.key,
        strategy_key: ctx.accounts.strategy.key(),
        total_idle: vault.total_idle,
        total_debt: vault.total_debt,
        new_debt: ctx.accounts.strategy_data.current_debt,
    });

    Ok(())
}