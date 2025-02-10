use anchor_lang::prelude::*;
use crate::state::Vault;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        seeds = [b"vault"],
        bump,
        payer = signer,
        space = Vault::LEN
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub signer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>) -> Result<()> {
    // Get the key first before mutable borrow
    let vault_key = ctx.accounts.vault.key();
    let vault = &mut ctx.accounts.vault;
    
    vault.init(
        ctx.bumps.vault,
        vault_key,  // Use the stored key here
    )
} 