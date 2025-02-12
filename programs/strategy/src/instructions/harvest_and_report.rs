use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use crate::constants::UNDERLYING_SEED;
use crate::utils::unchecked_strategy::UncheckedStrategy;
#[derive(Accounts)]
pub struct HarvestAndReport<'info> {
    /// CHECK: can be any strategy
    #[account(mut)]
    pub strategy: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [UNDERLYING_SEED.as_bytes(), strategy.key().as_ref()],
        bump
    )]
    pub underlying_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = underlying_mint.key() == strategy.underlying_mint()
    )]
    pub underlying_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
} 