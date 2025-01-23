use anchor_lang::prelude::*;

use crate::instructions::Distribute;
use crate::state::GenericAccountant;

const DISCRIMINATOR_LEN: usize = 8;

pub trait Accountant {
    fn init(&mut self, index: u64, bump: u8) -> Result<()>;

    fn report(&self, profit: u64, loss: u64) -> Result<(u64,u64)>;
    fn enter(&self, amount: u64) -> Result<u64>;
    fn redeem(&self, amount: u64) -> Result<u64>;
    
    fn distribute(&mut self, accounts: &Distribute) -> Result<()>;

    fn set_performance_fee(&mut self, fee: u64) -> Result<()>;
    fn set_redemption_fee(&mut self, fee: u64) -> Result<()>;
    fn set_entry_fee(&mut self, fee: u64) -> Result<()>;

    fn entry_fee(&self) -> u64;
    fn redemption_fee(&self) -> u64;
    fn performance_fee(&self) -> u64;

    fn seeds(&self) -> [&[u8]; 2];
    fn save_changes(&self, writer: &mut dyn std::io::Write) -> Result<()>;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum AccountantType {
    Generic,
}

impl AccountantType {
    pub fn space(&self) -> usize {
        match self {
            AccountantType::Generic => DISCRIMINATOR_LEN + GenericAccountant::INIT_SPACE,
        }
    }
}