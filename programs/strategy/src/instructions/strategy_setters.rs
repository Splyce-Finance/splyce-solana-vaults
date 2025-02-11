use anchor_lang::prelude::*;

use crate::events::SetPerformanceFeeEvent;
use crate::utils::unchecked_strategy::UncheckedStrategy;
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct SetStrategyValue<'info> {
    /// CHECK: can by any strategy
    #[account(mut)]
    pub strategy: UncheckedAccount<'info>,

    #[account(mut, constraint = signer.key() == strategy.manager() @ErrorCode::AccessDenied)]
    pub signer: Signer<'info>,
}

pub fn handle_set_performance_fee<'info>(ctx: Context<SetStrategyValue<'info>>, new_fee: u64) -> Result<()> {
    let mut strategy = ctx.accounts.strategy.from_unchecked()?;

    let fee_data = &mut strategy.fee_data();
    fee_data.set_performance_fee(new_fee)?;

    emit!(SetPerformanceFeeEvent {
        account_key: strategy.key(),
        fee: new_fee,
    });

    strategy.save_changes(&mut &mut ctx.accounts.strategy.try_borrow_mut_data()?[8..])
}

pub fn handle_set_fee_manager<'info>(ctx: Context<SetStrategyValue<'info>>, recipient: Pubkey) -> Result<()> {
    let mut strategy = ctx.accounts.strategy.from_unchecked()?;

    let fee_data = &mut strategy.fee_data();
    fee_data.set_fee_manager(recipient)?;
    strategy.save_changes(&mut &mut ctx.accounts.strategy.try_borrow_mut_data()?[8..])
}

pub fn handle_set_total_assets<'info>(ctx: Context<SetStrategyValue<'info>>, total_assets: u64) -> Result<()> {
    let mut strategy = ctx.accounts.strategy.from_unchecked()?;
    
    strategy.set_total_assets(total_assets);
    
    strategy.save_changes(&mut &mut ctx.accounts.strategy.try_borrow_mut_data()?[8..])
}