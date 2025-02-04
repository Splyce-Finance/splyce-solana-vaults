use anchor_lang::prelude::*;

declare_id!("Dj9DcwRzLK9yXz5xdAeRFmp2EjpFYZ3En5N8ApfxpCfU");

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
