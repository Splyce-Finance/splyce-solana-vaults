use anchor_lang::prelude::*;
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::{UserRole, Role}
};

use crate::constants::USER_DATA_SEED;
use crate::state::{Vault, UserData};
use crate::events::WhitelistUpdatedEvent;

#[derive(Accounts)]
#[instruction(user: Pubkey)]
pub struct RevokeWhitelisting<'info> {
    #[account(
        mut,
        seeds = [
            USER_DATA_SEED.as_bytes(), 
            vault.key().as_ref(), 
            user.as_ref()
        ], 
        bump,  
    )]
    pub user_data: Account<'info, UserData>,

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

    pub access_control: Program<'info, AccessControl>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_revoke_whitelisting(ctx: Context<RevokeWhitelisting>, _user: Pubkey) -> Result<()> {
    ctx.accounts.user_data.whitelisted = false;

    emit!(WhitelistUpdatedEvent {
        user: _user,
        whitelisted: false,
    });

    Ok(())
}
