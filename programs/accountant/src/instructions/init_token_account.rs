use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::Token,
    token_interface::{Mint, TokenAccount},
};
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::{Role, UserRole}
};

use crate::state::*;
use crate::constants::CONFIG_SEED;

#[derive(Accounts)]
pub struct InitTokenAccount<'info> {
    #[account(
        init_if_needed, 
        payer = signer, 
        associated_token::mint = mint, 
        associated_token::authority = accountant,
    )]
    pub token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: We want to hadle all accountant types here
    #[account(mut)]
    pub accountant: UncheckedAccount<'info>,

    #[account(mut, seeds = [CONFIG_SEED.as_bytes()], bump)]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [
            USER_ROLE_SEED.as_bytes(), 
            signer.key().as_ref(),
            Role::AccountantAdmin.to_seed().as_ref()
        ], 
        bump,
        seeds::program = access_control.key()
    )]
    pub roles: Account<'info, UserRole>,

    #[account(mut, constraint = roles.check_role()?)]
    pub signer: Signer<'info>,

    pub access_control: Program<'info, AccessControl>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_init_token_account(_ctx: Context<InitTokenAccount>) -> Result<()> {
    Ok(())
}
