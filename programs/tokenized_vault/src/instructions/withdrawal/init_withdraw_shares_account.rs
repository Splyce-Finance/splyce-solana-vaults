use anchor_lang::prelude::*;
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::{UserRole, Role}
};
use anchor_spl::{
    token_interface::{Mint, TokenAccount},
    token::Token,
};

use crate::constants::{SHARES_SEED, WITHDRAW_SHARES_ACCOUNT_SEED};
use crate::state::Vault;

#[derive(Accounts)]
pub struct InitWithdrawSharesAccount<'info> {
    #[account(mut)]
    pub vault: AccountLoader<'info, Vault>,

    #[account(mut, seeds = [SHARES_SEED.as_bytes(), vault.key().as_ref()], bump)]
    pub shares_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init, 
        seeds = [WITHDRAW_SHARES_ACCOUNT_SEED.as_bytes(), vault.key().as_ref()], 
        bump, 
        payer = signer, 
        token::mint = shares_mint,
        token::authority = vault,
    )]
    pub shares_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [
            USER_ROLE_SEED.as_bytes(), 
            signer.key().as_ref(),
            Role::VaultsAdmin.to_seed().as_ref()
        ], 
        bump,
        seeds::program = access_control.key()
    )]
    pub roles: Account<'info, UserRole>,

    #[account(mut, constraint = roles.check_role()?)]
    pub signer: Signer<'info>,
    
    pub access_control: Program<'info, AccessControl>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_init_withdraw_pool(_ctx: Context<InitWithdrawSharesAccount>) -> Result<()> {
    Ok(())
}


