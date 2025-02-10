use anchor_lang::prelude::*;

mod state;
mod instructions;

use instructions::*;

declare_id!("GH92HnTFVhTDSkFgnRmz2PuNbzL5oqkgJ46vdBfbxju8");

#[program]
pub mod simple_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handle_initialize(ctx)
    }

    pub fn set_deposit_limit(ctx: Context<SetVaultProperty>, amount: u64) -> Result<()> {
        instructions::vault_setters::handle_set_deposit_limit(ctx, amount)
    }

    pub fn set_min_deposit(ctx: Context<SetVaultProperty>, value: u64) -> Result<()> {
        instructions::vault_setters::handle_set_min_deposit(ctx, value)
    }
}
