use access_control::state::UserRole;
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::Role
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_interface::{Mint, TokenAccount, TokenInterface}
};

use crate::constants::{SHARES_SEED, UNDERLYING_SEED, USER_DATA_SEED};

use crate::events::VaultDepositEvent;
use crate::state::{UserData, Vault};
use crate::utils::{accountant, token, vault};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: AccountLoader<'info, Vault>,

    /// CHECK:
    #[account(mut, address = vault.load()?.accountant)]
    pub accountant: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = shares_mint, 
        associated_token::authority = accountant,
    )]
    pub accountant_recipient: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [UNDERLYING_SEED.as_bytes(), vault.key().as_ref()], bump)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [SHARES_SEED.as_bytes(), vault.key().as_ref()], bump)]
    pub shares_mint: InterfaceAccount<'info, Mint>,

    #[account(mut, address = vault.load()?.underlying_mint)]
    pub underlying_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub user_shares_account: InterfaceAccount<'info, TokenAccount>,

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

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub shares_token_program: Program<'info, Token>,
    pub token_program: Interface<'info, TokenInterface>,
    pub access_control: Program<'info, AccessControl>,
}

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let enter_fee = accountant::enter(&ctx.accounts.accountant, amount)?;
    let amount_to_deposit = amount - enter_fee;

    vault::validate_deposit(
        &ctx.accounts.vault, 
        &ctx.accounts.kyc_verified,
        &ctx.accounts.user_data,
        false,
        amount_to_deposit
    )?;

    let mut shares = ctx.accounts.vault.load()?.convert_to_shares(amount_to_deposit);

    token::transfer(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.user_token_account.to_account_info(),
        ctx.accounts.vault_token_account.to_account_info(),
        ctx.accounts.user.to_account_info(),
        &ctx.accounts.underlying_mint,
        amount,
    )?;

    token::mint_to(
        ctx.accounts.shares_token_program.to_account_info(),
        ctx.accounts.shares_mint.to_account_info(),
        ctx.accounts.user_shares_account.to_account_info(),
        ctx.accounts.shares_mint.to_account_info(),
        shares,
        &ctx.accounts.vault.load()?.seeds_shares(),
    )?;

    if enter_fee > 0 {
        let fee_shares = ctx.accounts.vault.load()?.convert_to_shares(enter_fee);
        shares += fee_shares;
        token::mint_to(
            ctx.accounts.shares_token_program.to_account_info(),
            ctx.accounts.shares_mint.to_account_info(),
            ctx.accounts.accountant_recipient.to_account_info(),
            ctx.accounts.shares_mint.to_account_info(),
            fee_shares,
            &ctx.accounts.vault.load()?.seeds_shares(),
        )?;
    }

    ctx.accounts.user_data.deposited += amount;

    let mut vault = ctx.accounts.vault.load_mut()?;
    vault.handle_deposit(amount, shares);

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

    Ok(())
}