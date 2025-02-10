use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

use crate::instructions::*;

declare_id!("4WFmCTD3NhUhzWpuLFNNyL6jAW3fBB9uu1PXz6SpKVdL");

#[program]
pub mod access_control {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        handle_initialize(ctx)
    }

    pub fn set_role(ctx: Context<SetRole>, role_id: u64, user: Pubkey) -> Result<()> {
        handle_set_role(ctx, role_id, user)
    }

    pub fn set_role_manager(ctx: Context<SetRoleManager>, role_id: u64, manager_role_id: u64) -> Result<()> {
        handle_set_role_manager(ctx, role_id, manager_role_id)
    }

    pub fn revoke_role(ctx: Context<RevokeRole>, role_id: u64, user: Pubkey) -> Result<()> {
        handle_revoke_role(ctx, role_id, user)
    }
}