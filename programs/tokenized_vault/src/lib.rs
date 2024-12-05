pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;
pub mod events;

use anchor_lang::prelude::*;

pub use state::{SharesConfig, VaultConfig};
pub use instructions::*;

declare_id!("HdQsT53sANBQmPb6xWRaZXUzAXydLteNsJW1Y6kJDbMm");

#[program]
pub mod tokenized_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        handle_initialize(ctx)
    }

    pub fn init_vault(ctx: Context<InitVault>, config: Box<VaultConfig>) -> Result<()> {
        handle_init_vault(ctx, config)
    }

    pub fn init_vault_shares(ctx: Context<InitVaultShares>, index: u64, config: Box<SharesConfig>) -> Result<()> {
        handle_init_vault_shares(ctx, index, config)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        handle_deposit(ctx, amount)
    }

    pub fn direct_deposit<'info>(ctx: Context<'_, '_, '_, 'info, DirectDeposit<'info>>, amount: u64) -> Result<()> {
        handle_direct_deposit(ctx, amount)
    }

    pub fn withdraw<'info>(
        ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>, 
        amount: u64, 
        max_loss: u64,
        remaining_accounts_map: AccountsMap
    ) -> Result<()> {
        let shares = ctx.accounts.vault.load()?.convert_to_shares(amount);
        handle_withdraw(ctx, amount, shares, max_loss, remaining_accounts_map)
    }
    
    pub fn redeem<'info>(
        ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>, 
        shares: u64, 
        max_loss: u64,
        remaining_accounts_map: AccountsMap
    ) -> Result<()> {
        let amount = ctx.accounts.vault.load()?.convert_to_underlying(shares);
        handle_withdraw(ctx, amount, shares, max_loss, remaining_accounts_map)
    }

    pub fn add_strategy(ctx: Context<AddStrategy>, max_debt: u64) -> Result<()> {
        handle_add_strategy(ctx, max_debt)
    }

    pub fn remove_strategy(ctx: Context<RemoveStrategy>, strategy: Pubkey, force: bool) -> Result<()> {
        handle_remove_strategy(ctx, strategy, force)
    }

    pub fn update_debt<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, UpdateStrategyDebt<'info>>, 
        amount: u64
    ) -> Result<()> {
        handle_update_debt(ctx, amount)
    }

    pub fn set_deposit_limit(ctx: Context<SetVaultProperty>, limit: u64) -> Result<()> {
        handle_set_deposit_limit(ctx, limit)
    }

    pub fn set_min_user_deposit(ctx: Context<SetVaultProperty>, value: u64) -> Result<()> {
        handle_set_min_user_deposit(ctx, value)
    }

    pub fn set_profit_max_unlock_time(ctx: Context<SetVaultProperty>, value: u64) -> Result<()> {
        handle_set_profit_max_unlock_time(ctx, value)
    }

    pub fn set_min_total_idle(ctx: Context<SetVaultProperty>, value: u64) -> Result<()> {
        handle_set_min_total_idle(ctx, value)
    }

    pub fn process_report(ctx: Context<ProcessReport>) -> Result<()> {
        handle_process_report(ctx)
    }

    pub fn shutdown_vault(ctx: Context<ShutdownVault>) -> Result<()> {
        handle_shutdown_vault(ctx)
    }

    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        handle_close_vault(ctx)
    }
}