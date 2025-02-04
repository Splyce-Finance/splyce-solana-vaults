use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;
pub mod error;

pub use instructions::*;

declare_id!("C3dz2V23uqX5br1rdA2xmahNVMPribqCLPU9NYxrA71t");

#[program]
pub mod faucet {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::init(ctx)
    }

    pub fn send_tokens(ctx: Context<SendTokens>) -> Result<()> {
        instructions::send_tokens(ctx)
    }

    pub fn set_distribution_amount(ctx: Context<SetDistributionAmount>, amount: u64) -> Result<()> {
        instructions::set_distribution_amount(ctx, amount)
    }
}