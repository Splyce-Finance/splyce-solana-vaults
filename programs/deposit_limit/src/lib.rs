use anchor_lang::prelude::*;

declare_id!("5ftd8XcvMXHFquqBFKP7BgdzLnxPodtnoowB3GKn5528");

#[program]
pub mod deposit_limit {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
