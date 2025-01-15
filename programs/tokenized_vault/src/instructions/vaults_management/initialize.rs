use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, DISCRIMINATOR_LEN};
use crate::state::Config;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init, 
        seeds = [CONFIG_SEED.as_bytes()], 
        bump,  
        payer = admin, 
        space = DISCRIMINATOR_LEN + Config::INIT_SPACE,
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_initialize(_ctx: Context<Initialize>) -> Result<()> {
    Ok(())
}
