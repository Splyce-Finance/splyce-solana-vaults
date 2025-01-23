use anchor_lang::prelude::*;

use crate::constants::DISCRIMINATOR_LEN;

#[account]
#[derive(Default, Debug, InitSpace)]
pub struct WithdrawRequest {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub recipient: Pubkey,
    pub shares_account: Pubkey,
    pub requested_amount: u64,
    pub locked_shares: u64,
    pub max_loss: u64,
    pub fee_shares: u64,
    pub index: u64,
}

impl WithdrawRequest {
    pub const LEN: usize = DISCRIMINATOR_LEN + WithdrawRequest::INIT_SPACE;

    pub fn init(
        &mut self, 
        requested_amount: u64, 
        vault: Pubkey, 
        user: Pubkey,
        recipient: Pubkey, 
        shares_account: Pubkey,
        locked_shares: u64, 
        max_loss: u64,
        fee_shares: u64,
        index: u64,
    ) -> Result<()> {
        self.vault = vault;
        self.user = user;
        self.shares_account = shares_account;
        self.requested_amount = requested_amount;
        self.locked_shares = locked_shares;
        self.recipient = recipient;
        self.max_loss = max_loss;
        self.fee_shares = fee_shares;
        self.index = index;
        Ok(())
    }
}