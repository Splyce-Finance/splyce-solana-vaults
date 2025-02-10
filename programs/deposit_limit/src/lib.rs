use anchor_lang::prelude::*;

declare_id!("3j1qXDMnVHBGKo5ZfaSJk6HYatPC6qWiRzcDd4B5iRwH");

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
