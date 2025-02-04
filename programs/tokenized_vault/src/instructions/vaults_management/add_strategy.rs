use anchor_lang::prelude::*;
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
   state::{UserRole, Role}
};
use strategy::program::Strategy;

use crate::errors::ErrorCode;
use crate::constants::STRATEGY_DATA_SEED;
use crate::state::{ StrategyData, Vault};
use crate::utils::strategy as strategy_utils;
use crate::events::VaultAddStrategyEvent;

#[derive(Accounts)]
pub struct AddStrategy<'info> {
    #[account(
        init,
        seeds = [
            STRATEGY_DATA_SEED.as_bytes(),
            vault.key().as_ref(),
            strategy.key().as_ref()
        ],
        bump,
        payer = signer,
        space = StrategyData::LEN
    )]
    pub strategy_data: Account<'info, StrategyData>,

    #[account(mut)]
    pub vault: AccountLoader<'info, Vault>,

    /// CHECK: can be any strategy
    #[account(constraint = strategy.owner == strategy_program.key)]
    pub strategy: UncheckedAccount<'info>,

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

    pub access_control: Program<'info, AccessControl>,
    pub system_program: Program<'info, System>,
    pub strategy_program: Program<'info, Strategy>,
}

pub fn handle_add_strategy(ctx: Context<AddStrategy>, max_debt: u64) -> Result<()> {
    let strategy_vault = strategy_utils::get_vault(&ctx.accounts.strategy.to_account_info())?;

    if strategy_vault != ctx.accounts.vault.key() {
        return Err(ErrorCode::InvalidStrategyToAdd.into());
    }

    let strategy_data = &mut ctx.accounts.strategy_data;
    strategy_data.init(ctx.accounts.vault.key(), ctx.accounts.strategy.key(), max_debt)?;

    let vault = &mut ctx.accounts.vault.load_mut()?;
    vault.strategies_amount += 1;
    

    emit!(VaultAddStrategyEvent {
        vault_key: ctx.accounts.vault.key(),
        strategy_key: ctx.accounts.strategy.key(),
        current_debt: 0, 
        max_debt,
        last_update: Clock::get()?.unix_timestamp,
        is_active: true,
    });

    Ok(())
}