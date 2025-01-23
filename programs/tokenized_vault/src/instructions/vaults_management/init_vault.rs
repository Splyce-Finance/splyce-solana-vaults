use anchor_lang::prelude::*;
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::{UserRole, Role}
};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{CONFIG_SEED, VAULT_SEED, UNDERLYING_SEED};
use crate::state::{Vault, Config, VaultConfig};

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(
        init, 
        seeds = [
            VAULT_SEED.as_bytes(), 
            config.next_vault_index.to_le_bytes().as_ref()
        ], 
        bump,  
        payer = signer, 
        space = Vault::LEN,
    )]
    pub vault: AccountLoader<'info, Vault>,
    
    #[account(
        init, 
        seeds = [UNDERLYING_SEED.as_bytes(), vault.key().as_ref()], 
        bump, 
        payer = signer, 
        token::mint = underlying_mint,
        token::authority = vault,
    )]
    pub underlying_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    
    #[account(mut)]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,
    
    #[account(seeds = [CONFIG_SEED.as_bytes()], bump)]
    pub config: Box<Account<'info, Config>>,

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
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_init_vault(ctx: Context<InitVault>, config: Box<VaultConfig>) -> Result<()> {
    ctx.accounts.vault.load_init()?.init(
        ctx.accounts.config.next_vault_index,
        ctx.bumps.vault,
        ctx.accounts.vault.key(),
        ctx.accounts.underlying_mint.as_ref(),
        ctx.accounts.underlying_token_account.key(),
        config.as_ref()
    )
}


