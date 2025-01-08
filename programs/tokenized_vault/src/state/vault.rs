use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::constants::{DISCRIMINATOR_LEN, ONE_SHARE_TOKEN, VAULT_SEED, SHARES_SEED, MAX_BPS_EXTENDED};

#[account(zero_copy(unsafe))]
#[repr(packed)]
#[derive(Default, Debug, InitSpace)]
pub struct Vault {
    pub bump: [u8; 1],
    pub index_buffer: [u8; 8],
    pub shares_bump: [u8; 1],

    pub key: Pubkey,

    pub underlying_mint: Pubkey,
    pub underlying_token_acc: Pubkey,
    pub underlying_decimals: u8,

    pub accountant: Pubkey,

    pub total_debt: u64,
    pub total_shares: u64,
    pub minimum_total_idle: u64,
    pub total_idle: u64,
    pub deposit_limit: u64,
    pub user_deposit_limit: u64,
    pub min_user_deposit: u64,
    pub strategies_amount: u64,

    pub is_shutdown: bool,

    // only kyc verified users can deposit
    pub kyc_verified_only: bool,
    pub direct_deposit_enabled: bool,
    pub whitelisted_only: bool,
    pub direct_withdraw_enabled: bool,

    pub profit_max_unlock_time: u64,
    pub full_profit_unlock_date: u64,
    pub profit_unlocking_rate: u64,
    pub last_profit_update: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct VaultConfig {
    pub deposit_limit: u64,
    pub user_deposit_limit: u64,
    pub min_user_deposit: u64,
    pub accountant: Pubkey,
    pub profit_max_unlock_time: u64,
    pub kyc_verified_only: bool,
    pub direct_deposit_enabled: bool,
    pub whitelisted_only: bool,
    pub direct_withdraw_enabled: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SharesConfig {
    pub name: String,
    pub symbol: String,
    pub uri: String,
}

impl Vault {
    pub const LEN: usize = DISCRIMINATOR_LEN + Self::INIT_SPACE;

    pub fn seeds(&self) -> [&[u8]; 3] {
    [
        &VAULT_SEED.as_bytes(),
        self.index_buffer.as_ref(),
        self.bump.as_ref(),
    ]}

    pub fn seeds_shares(&self) -> [&[u8]; 3] {
        [
            &SHARES_SEED.as_bytes(),
            self.key.as_ref(),
            self.shares_bump.as_ref(),
        ]
    }

    pub fn init(
        &mut self,
        index: u64,
        bump: u8,
        pubkey: Pubkey,
        underlying_mint: &InterfaceAccount<Mint>,
        underlying_token_acc: Pubkey,
        config: &VaultConfig
    ) -> Result<()> {
        self.index_buffer = index.to_le_bytes();
        self.bump = [bump];
        self.key = pubkey;

        self.underlying_mint = underlying_mint.key();
        self.underlying_token_acc = underlying_token_acc;
        self.underlying_decimals = underlying_mint.decimals;

        self.accountant = config.accountant;
        self.deposit_limit = config.deposit_limit;
        self.user_deposit_limit = config.user_deposit_limit;
        self.min_user_deposit = config.min_user_deposit;
        self.profit_max_unlock_time = config.profit_max_unlock_time;
        self.kyc_verified_only = config.kyc_verified_only;
        self.direct_deposit_enabled = config.direct_deposit_enabled;
        self.whitelisted_only = config.whitelisted_only;
        self.direct_withdraw_enabled = config.direct_withdraw_enabled;

        self.is_shutdown = false;
        self.total_debt = 0;
        self.total_shares = 0;
        self.total_idle = 0;

        Ok(())
    }
    pub fn shutdown(&mut self) {
        self.is_shutdown = true;
        self.deposit_limit = 0;
    }

    pub fn handle_deposit(&mut self, amount: u64, shares: u64) {
        self.total_idle += amount;
        self.total_shares += shares;
    }

    pub fn handle_direct_deposit(&mut self, amount: u64, shares: u64) {
        self.total_debt += amount;
        self.total_shares += shares;
    }

    pub fn handle_withdraw(&mut self, amount: u64, shares: u64) {
        self.total_idle -= amount;
        self.total_shares -= shares;
    }

    pub fn max_deposit(&self) -> u64 {
        self.deposit_limit - self.total_funds()
    }

    pub fn convert_to_shares(&self, amount: u64) -> u64 {
        if self.total_shares() == 0 {
            amount
        } else {
            (amount as u128 * self.total_shares() as u128 / self.total_funds() as u128) as u64
        }
    } 

    pub fn convert_to_underlying(&self, shares: u64) -> u64 {
        if self.total_shares() == 0 {
            shares
        } else {
            (shares as u128 * self.total_funds() as u128 / self.total_shares() as u128) as u64
        }
    }

    pub fn total_funds(&self) -> u64 {
        self.total_debt + self.total_idle
    }

    pub fn unlocked_shares(&self) -> Result<u64> {
        let curr_timestamp = Clock::get()?.unix_timestamp as u64;
        let mut curr_unlocked_shares = 0;

        if self.full_profit_unlock_date > curr_timestamp {
            curr_unlocked_shares = (self.profit_unlocking_rate * (curr_timestamp - self.last_profit_update)) / MAX_BPS_EXTENDED;
        } else if self.full_profit_unlock_date != 0 {
            curr_unlocked_shares = (self.profit_unlocking_rate * (self.full_profit_unlock_date - self.last_profit_update)) / MAX_BPS_EXTENDED;
        }

        Ok(curr_unlocked_shares)
    }

    pub fn total_shares(&self) -> u64 {
        self.total_shares - self.unlocked_shares().unwrap()
    }

    /// Calculates the price of one share token with scaling to avoid overflow/underflow
    /// Returns the scaled share price (actual price = returned value / SCALING_FACTOR)
    pub fn get_share_price(&self) -> u64 {
        const SCALING_FACTOR: u128 = 1_000_000; // 10^6 for 6 decimal places of precision
        let scaled_one_share_token = ONE_SHARE_TOKEN * SCALING_FACTOR;

        if self.total_shares() == 0 {
            // If there are no shares, return the scaling factor (representing 1.0)
            scaled_one_share_token as u64
        } else {
            // Scale up total funds before division to maintain precision|
            (scaled_one_share_token * self.total_funds() as u128 / self.total_shares() as u128) as u64
        }
    }
}