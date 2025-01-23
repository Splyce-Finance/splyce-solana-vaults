use anchor_lang::prelude::*;

use crate::constants::DISCRIMINATOR_LEN;
use crate::events::VaultAddStrategyEvent;


#[account]
#[derive(Default, Debug, InitSpace)]
pub struct StrategyData {
    pub current_debt: u64,
    pub max_debt: u64,
    pub last_update: i64,
}

impl StrategyData {
    pub const LEN: usize = DISCRIMINATOR_LEN + StrategyData::INIT_SPACE;

    pub fn init(&mut self, vault_key: Pubkey, strategy_key: Pubkey, max_debt: u64) -> Result<()> {
        self.max_debt = max_debt;
        self.last_update = 0;

        emit!(VaultAddStrategyEvent {
            vault_key: vault_key,
            strategy_key: strategy_key,
            current_debt: 0,
            max_debt,
            last_update: 0,
            is_active: true,
        });

        Ok(())
    }

    pub fn update_current_debt(&mut self,  amount: u64) -> Result<()> {
        self.current_debt = amount;
        self.last_update = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn increase_current_debt(&mut self, amount: u64) -> Result<()> {
        self.current_debt += amount;
        self.last_update = Clock::get()?.unix_timestamp;
        Ok(())
    }
}