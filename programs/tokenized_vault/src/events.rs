use anchor_lang::prelude::*;

#[derive(Debug, AnchorDeserialize, AnchorSerialize)]
pub struct TokenMetaData {
    pub name: String,
    pub symbol: String,
}

#[derive(Debug, AnchorDeserialize, AnchorSerialize)]
pub struct TokenData {
    pub mint: Pubkey,
    pub account: Pubkey,
    pub decimals: u8,
    pub metadata: TokenMetaData,
}

#[event]
pub struct VaultInitEvent {
    pub vault_key: Pubkey, 
    pub underlying_token: TokenData,
    pub accountant: Pubkey,
    pub share_token: TokenData,
    pub deposit_limit: u64,
    pub user_deposit_limit: u64,
    pub min_user_deposit: u64,
    pub kyc_verified_only: bool,
    pub direct_deposit_enabled: bool,
    pub direct_withdraw_enabled: bool,
    pub minimum_total_idle: u64,
    pub whitelisted_only: bool,
    pub profit_max_unlock_time: u64,
}

#[event]
pub struct VaultAddStrategyEvent {
    pub vault_key: Pubkey, 
    pub strategy_key: Pubkey,
    pub current_debt: u64,
    pub max_debt: u64,
    pub last_update: i64,
    pub is_active: bool,    
}

#[event]
pub struct VaultDepositEvent {
    pub vault_key: Pubkey, 
    pub total_debt: u64,
    pub total_idle: u64,
    pub total_share: u64,
    pub amount: u64,
    pub share: u64,
    pub token_account: Pubkey,
    pub share_account: Pubkey,
    pub token_mint: Pubkey,
    pub share_mint: Pubkey,
    pub authority: Pubkey,
    pub share_price: u64,
    pub timestamp: i64,
}


#[event]
pub struct VaultWithdrawlEvent {
    pub vault_key: Pubkey, 
    pub total_idle: u64,
    pub total_share: u64,
    pub assets_to_transfer: u64,
    pub shares_to_burn: u64,
    pub token_account: Pubkey,
    pub share_account: Pubkey,
    pub token_mint: Pubkey,
    pub share_mint: Pubkey,
    pub authority: Pubkey,
    pub share_price: u64,
    pub timestamp: i64,
}

#[event]
pub struct VaultUpdateDepositLimitEvent {
    pub vault_key: Pubkey, 
    pub new_limit: u64,
    pub timestamp: i64,
}

#[event]
pub struct VaultShutDownEvent {
    pub vault_key: Pubkey, 
    pub shutdown: bool,
}

#[event]
pub struct UpdatedCurrentDebtForStrategyEvent {
    pub vault_key: Pubkey, 
    pub strategy_key: Pubkey,
    pub total_idle: u64,
    pub total_debt: u64,
    pub new_debt: u64,
}

#[event]
pub struct StrategyReportedEvent {
    pub vault_key: Pubkey,
    pub strategy_key: Pubkey,
    pub gain: u64,
    pub loss: u64,
    pub current_debt: u64,
    pub protocol_fees: u64,
    pub total_fees: u64,
    pub total_shares: u64,
    pub share_price: u64,
    pub timestamp: i64,
}

#[event]
pub struct WhitelistUpdatedEvent {
    pub user: Pubkey,
    pub whitelisted: bool,
}

#[event]
pub struct WithdrawalRequestedEvent {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub recipient: Pubkey,
    pub shares: u64,
    pub amount: u64,
    pub max_loss: u64,
    pub fee_shares: u64,
    pub priority_fee: u64,
    pub index: u64,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawalRequestCanceledEvent {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub index: u64,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawalRequestFulfilledEvent {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub amount: u64,
    pub index: u64,
    pub timestamp: i64,
}

#[event]
pub struct VaultUpdateMinUserDepositEvent {
    pub vault_key: Pubkey,
    pub new_min_user_deposit: u64,
    pub timestamp: i64,
}

#[event]
pub struct VaultUpdateProfitMaxUnlockTimeEvent {
    pub vault_key: Pubkey,
    pub new_profit_max_unlock_time: u64,
    pub timestamp: i64,
}

#[event]
pub struct VaultUpdateMinTotalIdleEvent {
    pub vault_key: Pubkey,
    pub new_min_total_idle: u64,
    pub timestamp: i64,
}

#[event]
pub struct VaultUpdateDirectWithdrawEnabledEvent {
    pub vault_key: Pubkey,
    pub new_direct_withdraw_enabled: bool,
    pub timestamp: i64,
}

#[event]
pub struct VaultUpdateUserDepositLimitEvent {
    pub vault_key: Pubkey,
    pub new_user_deposit_limit: u64,
    pub timestamp: i64,
}

#[event]
pub struct VaultUpdateAccountantEvent {
    pub vault_key: Pubkey,
    pub new_accountant: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct VaultUpdateWhitelistedOnlyEvent {
    pub vault_key: Pubkey,
    pub new_whitelisted_only: bool,
    pub timestamp: i64,
}

#[event]
pub struct VaultRemoveStrategyEvent {
    pub vault_key: Pubkey,
    pub strategy_key: Pubkey,
    pub removed_at: i64,
}
