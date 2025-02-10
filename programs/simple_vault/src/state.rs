use anchor_lang::prelude::*;

#[account]
pub struct Vault {
    pub key: Pubkey,
    pub bump: u8,
    pub deposit_limit: u64,
    pub min_deposit: u64,
    pub total_deposits: u64,
}

impl Vault {
    pub const LEN: usize = 8 + // discriminator
        32 + // key
        1 + // bump
        8 + // deposit_limit
        8 + // min_deposit
        8; // total_deposits

    pub fn seeds(&self) -> [&[u8]; 2] {
        [b"vault", self.key.as_ref()]
    }

    pub fn init(&mut self, bump: u8, key: Pubkey) -> Result<()> {
        self.bump = bump;
        self.key = key;
        self.deposit_limit = 0;
        self.min_deposit = 0;
        self.total_deposits = 0;
        Ok(())
    }
} 