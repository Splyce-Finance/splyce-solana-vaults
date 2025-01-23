use anchor_lang::prelude::*;
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::{UserRole, Role}
};

use crate::events::VaultUpdateDepositLimitEvent;
use crate::errors::ErrorCode;
use crate::state::Vault;

#[derive(Accounts)]
pub struct SetVaultProperty<'info> {
    #[account(mut)]
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

    pub access_control: Program<'info, AccessControl>
}

pub fn handle_set_deposit_limit(ctx: Context<SetVaultProperty>, amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault.load_mut()?;

    if vault.is_shutdown {
        return Err(ErrorCode::VaultShutdown.into());
    }

    vault.deposit_limit = amount;

    emit!(VaultUpdateDepositLimitEvent {
        vault_key: vault.key,
        new_limit: amount,
    });

    Ok(())
}

pub fn handle_set_min_user_deposit(ctx: Context<SetVaultProperty>, value: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault.load_mut()?;

    if vault.is_shutdown {
        return Err(ErrorCode::VaultShutdown.into());
    }

    vault.min_user_deposit = value;

    Ok(())
}

pub fn handle_set_profit_max_unlock_time(ctx: Context<SetVaultProperty>, value: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault.load_mut()?;

    if vault.is_shutdown {
        return Err(ErrorCode::VaultShutdown.into());
    }

    vault.profit_max_unlock_time = value;

    Ok(())
}

pub fn handle_set_min_total_idle(ctx: Context<SetVaultProperty>, value: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault.load_mut()?;

    if vault.is_shutdown {
        return Err(ErrorCode::VaultShutdown.into());
    }

    vault.minimum_total_idle = value;

    Ok(())
}

pub fn handle_set_direct_withdraw_enabled(ctx: Context<SetVaultProperty>, value: bool) -> Result<()> {
    let vault = &mut ctx.accounts.vault.load_mut()?;

    vault.direct_withdraw_enabled = value;

    Ok(())
}

pub fn handle_set_user_deposit_limit(ctx: Context<SetVaultProperty>, value: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault.load_mut()?;

    if vault.is_shutdown {
        return Err(ErrorCode::VaultShutdown.into());
    }

    vault.user_deposit_limit = value;

    Ok(())
}

pub fn handle_set_accountant(ctx: Context<SetVaultProperty>, value: Pubkey) -> Result<()> {
    let vault = &mut ctx.accounts.vault.load_mut()?;

    if vault.is_shutdown {
        return Err(ErrorCode::VaultShutdown.into());
    }

    vault.accountant = value;

    Ok(())
}

pub fn handle_set_whitelisted_only(ctx: Context<SetVaultProperty>, value: bool) -> Result<()> {
    let vault = &mut ctx.accounts.vault.load_mut()?;

    if vault.is_shutdown {
        return Err(ErrorCode::VaultShutdown.into());
    }

    vault.whitelisted_only = value;

    Ok(())
}