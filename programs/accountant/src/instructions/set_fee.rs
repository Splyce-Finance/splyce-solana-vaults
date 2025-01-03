use anchor_lang::prelude::*;
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::{UserRole, Role}
};

use crate::events::{EntryFeeUpdatedEvent, PerformanceFeeUpdatedEvent, RedemptionFeeUpdatedEvent};
use crate::utils::unchecked_accountant::UncheckedAccountant;

#[derive(Accounts)]
pub struct SetFee<'info> {
    /// CHECK: can be any accountant
    #[account(mut)]
    pub accountant: UncheckedAccount<'info>,

    #[account(
        seeds = [
            USER_ROLE_SEED.as_bytes(), 
            signer.key().as_ref(),
            Role::AccountantAdmin.to_seed().as_ref()
        ], 
        bump,
        seeds::program = access_control.key()
    )]
    pub roles: Account<'info, UserRole>,

    #[account(mut, constraint = roles.check_role()?)]
    pub signer: Signer<'info>,

    pub access_control: Program<'info, AccessControl>
}

pub fn handle_set_performance_fee(
    ctx: Context<SetFee>, 
    fee: u64,
) -> Result<()> {
    let accountant = &mut ctx.accounts.accountant.from_unchecked()?;

    accountant.set_performance_fee(fee)?;
    accountant.save_changes(&mut &mut ctx.accounts.accountant.try_borrow_mut_data()?[8..])?;

    emit!(PerformanceFeeUpdatedEvent {
        accountant_key: ctx.accounts.accountant.key(),
        performance_fee: fee,
    });

    Ok(())
}


pub fn handle_set_entry_fee(
    ctx: Context<SetFee>, 
    fee: u64,
) -> Result<()> {
    let accountant = &mut ctx.accounts.accountant.from_unchecked()?;

    accountant.set_entry_fee(fee)?;
    accountant.save_changes(&mut &mut ctx.accounts.accountant.try_borrow_mut_data()?[8..])?;

    emit!(EntryFeeUpdatedEvent {
        accountant_key: ctx.accounts.accountant.key(),
        entry_fee: fee,
    });

    Ok(())
}

pub fn handle_set_redemption_fee(
    ctx: Context<SetFee>, 
    fee: u64,
) -> Result<()> {
    let accountant = &mut ctx.accounts.accountant.from_unchecked()?;

    accountant.set_redemption_fee(fee)?;
    accountant.save_changes(&mut &mut ctx.accounts.accountant.try_borrow_mut_data()?[8..])?;

    emit!(RedemptionFeeUpdatedEvent {
        accountant_key: ctx.accounts.accountant.key(),
        redemption_fee: fee,
    });

    Ok(())
}

