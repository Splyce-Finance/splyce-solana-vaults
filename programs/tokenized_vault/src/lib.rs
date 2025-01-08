pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;
pub mod events;

use anchor_lang::prelude::*;

pub use state::{SharesConfig, VaultConfig};
pub use instructions::*;

declare_id!("8Y5ZEEnhiNdvGHbfiZVj2eSawrNrQTKd9jPEFqnnKizC");

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

    pub fn init_withdraw_shares_account(ctx: Context<InitWithdrawSharesAccount>) -> Result<()> {
        handle_init_withdraw_pool(ctx)
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
        handle_withdraw(ctx, amount, max_loss, remaining_accounts_map)
    }
    
    pub fn redeem<'info>(
        ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>, 
        shares: u64, 
        max_loss: u64,
        remaining_accounts_map: AccountsMap
    ) -> Result<()> {
        handle_redeem(ctx, shares, max_loss, remaining_accounts_map)
    }

    pub fn request_withdraw<'info>(
        ctx: Context<'_, '_, '_, 'info, RequestWithdraw<'info>>, 
        amount: u64, 
        max_loss: u64
    ) -> Result<()> {
        handle_request_withdraw(ctx, amount, max_loss)
    }

    pub fn request_redeem<'info>(
        ctx: Context<'_, '_, '_, 'info, RequestWithdraw<'info>>, 
        shares: u64, 
        max_loss: u64
    ) -> Result<()> {
        handle_request_redeem(ctx, shares, max_loss)
    }

    pub fn cancel_withdrawal_request(ctx: Context<CancelWithdrawalRequest>) -> Result<()> {
        handle_cancel_withdrawal_request(ctx)
    }

    pub fn fulfill_withdrawal_request<'info>(ctx: Context<'_, '_, '_, 'info, FulfillWithdrawalRequest<'info>>, 
    ) -> Result<()> {
        handle_fulfill_withdrawal_request(ctx)
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

    pub fn whitelist(ctx: Context<Whitelist>, user: Pubkey) -> Result<()> {
        handle_whitelist(ctx, user)
    }

    pub fn revoke_whitelisting(ctx: Context<RevokeWhitelisting>, user: Pubkey) -> Result<()> {
        handle_revoke_whitelisting(ctx, user)
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