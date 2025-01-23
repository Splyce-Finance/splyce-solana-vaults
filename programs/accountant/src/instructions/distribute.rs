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

use crate::utils::unchecked_accountant::UncheckedAccountant;

#[derive(Accounts)]
pub struct Distribute<'info> {
    /// CHECK: can be any accountant
    #[account(mut)]
    pub accountant: UncheckedAccount<'info>,

    #[account(
        mut,
        token::mint = underlying_mint,
    )]
    pub recipient: Box<InterfaceAccount<'info, TokenAccount>>,

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

    #[account(
        mut,
        associated_token::mint = underlying_mint, 
        associated_token::authority = accountant,
    )]
    pub token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,

    pub access_control: Program<'info, AccessControl>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handle_distribute(ctx: Context<Distribute>) -> Result<()> {
    let accountant = &mut ctx.accounts.accountant.from_unchecked()?;
    accountant.distribute(&ctx.accounts)?;
    accountant.save_changes(&mut &mut ctx.accounts.accountant.try_borrow_mut_data()?[8..])
}