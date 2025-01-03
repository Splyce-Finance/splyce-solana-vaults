use anchor_lang::prelude::*;

use crate::constants::DISCRIMINATOR_LEN;

#[account]
#[derive(Default, Debug, InitSpace)]
pub struct UserData {
    pub deposited: u64,
    pub whitelisted: bool,
}

impl UserData {
    pub const LEN: usize = DISCRIMINATOR_LEN + UserData::INIT_SPACE;

    pub fn handle_withdraw(&mut self, amount: u64) -> Result<()> {
        if self.deposited < amount {
            self.deposited = 0;
        } else {
            self.deposited -= amount;
        }

        Ok(())
    }
}