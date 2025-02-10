use anchor_lang::prelude::*;
use crate::state::Vault;

#[derive(Accounts)]
pub struct SetVaultProperty<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub signer: Signer<'info>,
}

pub fn handle_set_deposit_limit(ctx: Context<SetVaultProperty>, amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.deposit_limit = amount;
    Ok(())
}

pub fn handle_set_min_deposit(ctx: Context<SetVaultProperty>, value: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.min_deposit = value;
    Ok(())
}

// pub fn handle_set_min_deposit(ctx: Context<SetVaultProperty>, value: u64) -> Result<()> {
//     let vault = &mut ctx.accounts.vault;
//     vault.min_deposit = value;
//     Ok(())
// } 