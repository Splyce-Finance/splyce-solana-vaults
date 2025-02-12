use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::{UserRole, Role}
};

use crate::utils::unchecked_strategy::UncheckedStrategy;
use crate::constants::UNDERLYING_SEED;

#[derive(Accounts)]
pub struct Report<'info> {
    /// CHECK: can be any strategy
    #[account(mut)]
    pub strategy: UncheckedAccount<'info>,
    
    #[account(mut, seeds = [UNDERLYING_SEED.as_bytes(), strategy.key().as_ref()], bump)]
    pub underlying_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, constraint = underlying_mint.key() == strategy.underlying_mint() )]
    pub underlying_mint: InterfaceAccount<'info, Mint>,
    
    #[account(
        mut,
        seeds = [
            USER_ROLE_SEED.as_bytes(),
            signer.key().as_ref(),
            Role::StrategiesManager.to_seed().as_ref()
        ],
        bump,
        seeds::program = access_control.key()
    )]
    pub roles: Account<'info, UserRole>,
    
    #[account(mut, constraint = roles.check_role()?)]
    pub signer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub access_control: Program<'info, AccessControl>,
}

pub fn handle_report<'info>(ctx: Context<'_, '_, '_, 'info, Report<'info>>) -> Result<()> {
    let mut strategy = ctx.accounts.strategy.from_unchecked()?;

    strategy.report(&ctx.accounts, &ctx.remaining_accounts)?;
    strategy.save_changes(&mut &mut ctx.accounts.strategy.try_borrow_mut_data()?[8..])
}