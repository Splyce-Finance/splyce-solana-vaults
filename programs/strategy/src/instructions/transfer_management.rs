use anchor_lang::prelude::*;

use crate::utils::unchecked_strategy::UncheckedStrategy;
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct TransferManagement<'info> {
    /// CHECK: can by any strategy
    #[account(mut)]
    pub strategy: UncheckedAccount<'info>,
    
    #[account(mut, constraint = signer.key() == strategy.manager() @ErrorCode::AccessDenied)]
    pub signer: Signer<'info>,
}

pub fn handle_transfer_management<'info>(ctx: Context<TransferManagement<'info>>, new_manager: Pubkey) -> Result<()> {
    let mut strategy = ctx.accounts.strategy.from_unchecked()?;

    strategy.set_manager(new_manager)?;
    strategy.save_changes(&mut &mut ctx.accounts.strategy.try_borrow_mut_data()?[8..])
}