use anchor_lang::prelude::*;
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::{UserRole, Role}
};

use crate::events::StrategyReportedEvent;
use crate::state::{StrategyData, Vault};
use crate::errors::ErrorCode;
use crate::constants::ONE_SHARE_TOKEN;
#[derive(Accounts)]
pub struct RemoveStrategy<'info> {
    #[account(mut)]
    pub vault: AccountLoader<'info, Vault>,
    
    #[account(mut, close = recipient)]
    pub strategy_data: Account<'info, StrategyData>,
    
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

    /// CHECK:
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    pub access_control: Program<'info, AccessControl>
}

pub fn handle_remove_strategy(ctx: Context<RemoveStrategy>, strategy: Pubkey, force: bool) -> Result<()> {
    let vault = &mut ctx.accounts.vault.load_mut()?;
    let strategy_data = &mut ctx.accounts.strategy_data;

    let mut loss: u64 = 0;

    if strategy_data.current_debt > 0 {
        if !force {
            return Err(ErrorCode::StrategyHasDebt.into());
        }
        loss = strategy_data.current_debt;
        vault.total_debt -= loss;
    }

    let share_price = vault.get_share_price();

    emit!(StrategyReportedEvent {
        strategy_key: strategy,
        gain: 0,
        loss,
        current_debt: 0,
        protocol_fees: 0,
        total_fees: 0,
        total_shares: vault.total_shares(),
        share_price,
        timestamp: Clock::get()?.unix_timestamp,
    });


    vault.strategies_amount -= 1;

    Ok(())
}