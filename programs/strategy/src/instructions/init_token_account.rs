use anchor_lang::prelude::*;
use anchor_spl::{
    token::{ Token, TokenAccount},
    token_interface::Mint,
};
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::{UserRole, Role}
};

use crate::constants::TOKEN_ACCOUNT_SEED;

use crate::ID;

//This instruction initializes a token account for the strategy
//AMM-strategies may have multiple token accounts, one for each asset
#[derive(Accounts)]
pub struct InitTokenAccount<'info> {
    #[account(
        init, 
        seeds = [
            TOKEN_ACCOUNT_SEED.as_bytes(),
            &asset_mint.key().to_bytes(),
            strategy.key().as_ref(),
        ], 
        bump, 
        payer = signer, 
        token::mint = asset_mint, 
        token::authority = strategy,
    )]
    pub token_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: can be any strategy
    #[account(owner = ID)]
    pub strategy: UncheckedAccount<'info>,

    #[account(mut)]
    pub asset_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
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

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub access_control: Program<'info, AccessControl>,
}

pub fn handle_init_token_account(_ctx: Context<InitTokenAccount>) -> Result<()> {
    msg!("Token account initialized");
    Ok(())
}