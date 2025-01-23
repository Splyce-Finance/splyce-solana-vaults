pub const VAULT_SEED: &str = "vault";
pub const SHARES_SEED: &str = "shares";
pub const UNDERLYING_SEED: &str = "underlying";
pub const CONFIG_SEED: &str = "config";
pub const TOKEN_ACCOUNT_SEED: &str = "token_account";
pub const INVEST_TRACKER_SEED: &str = "invest_tracker";

pub const REMAINING_ACCOUNTS_MIN: usize = 9;
pub const AMOUNT_SPECIFIED_IS_INPUT: bool = true;
pub const MAX_SQRT_PRICE_X64: u128 = 79226673515401279992447579055;
pub const MIN_SQRT_PRICE_X64: u128 = 4295048016;
pub const FEE_BPS: u64 = 10_000;
pub const DISCRIMINATOR_LEN: usize = 8;
pub const NO_EXPLICIT_SQRT_PRICE_LIMIT: u128 = 0;
pub const NUM_REWARDS: usize = 3;
pub const MAX_ASSIGNED_WEIGHT: u16 = 10000; // 100% in bps

// Asset value discount constant
pub const ASSET_VALUE_DISCOUNT_BPS: u16 = 60; // 0.6% discount 60 bps

// Orca strategy specific constants
pub const ORCA_ACCOUNTS_PER_SWAP: usize = 10;