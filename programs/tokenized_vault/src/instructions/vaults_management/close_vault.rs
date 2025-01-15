use anchor_lang::prelude::*;
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::{UserRole, Role}
};

use crate::errors::ErrorCode;
use crate::state::Vault;

// TODO: close token accounts
#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(mut, close = recipient)]
    pub vault: AccountLoader<'info, Vault>,
    
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

    /// CHECK:
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    pub access_control: Program<'info, AccessControl>
}

pub fn handle_close_vault(ctx: Context<CloseVault>) -> Result<()> {
    let vault = &mut ctx.accounts.vault.load_mut()?;

    if !vault.is_shutdown {
        return Err(ErrorCode::VaultActive.into());
    }

    if vault.total_debt > 0 {
        return Err(ErrorCode::VaultHasDebt.into());
    }

    if vault.strategies_amount > 0 {
        return Err(ErrorCode::VaultHasStrategies.into());
    }

    Ok(())
}
