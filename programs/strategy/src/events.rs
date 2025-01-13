use anchor_lang::prelude::*;

#[event]
pub struct StrategyInitEvent {
    pub account_key: Pubkey,
    pub strategy_type: String,
    pub vault: Pubkey,
    pub underlying_mint: Pubkey,
    pub underlying_token_acc: Pubkey,
    pub underlying_decimals: u8,
    pub deposit_limit: u64,
    pub deposit_period_ends: i64,
    pub lock_period_ends: i64,
}

#[event]
pub struct StrategyDepositEvent {
    pub account_key: Pubkey,
    pub amount: u64,
    pub total_assets: u64,
}

#[event]
pub struct StrategyWithdrawEvent {
    pub account_key: Pubkey,
    pub amount: u64,
    pub total_assets: u64,
}

#[event]
pub struct SetPerformanceFeeEvent {
    pub account_key: Pubkey,
    pub fee: u64,
}

#[event]
pub struct HarvestAndReportDTFEvent {
    pub account_key: Pubkey,
    pub total_assets: u64,
    pub timestamp: i64,
}

#[event]
pub struct StrategyDeployFundsEvent {
    pub account_key: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct StrategyFreeFundsEvent {
    pub account_key: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}