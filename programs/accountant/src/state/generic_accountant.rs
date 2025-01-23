use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

use crate::state::base_accountant::Accountant;
use crate::instructions::Distribute;
use crate::error::ErrorCode;
use crate::constants::FEE_BPS;

#[account]
#[derive(Default, Debug, InitSpace)]
pub struct GenericAccountant {
    pub index_buffer: [u8; 8],
    pub bump: [u8; 1],

    pub entry_fee: u64,
    pub redemption_fee: u64,
    pub performance_fee: u64,
}

impl Accountant for GenericAccountant {
    fn init(&mut self, index: u64, bump: u8) -> Result<()> {
        self.index_buffer = index.to_le_bytes();
        self.bump[0] = bump;
        Ok(())
    }

    fn seeds(&self) -> [&[u8]; 2] {
        [
            self.index_buffer.as_ref(),
            self.bump.as_ref(),
        ]
    }

    fn report(&self, profit: u64, _loss: u64) -> Result<(u64, u64)> {
        let total_fees = self.performance_fee * profit / FEE_BPS;
        let total_refunds = 0;
        Ok((total_fees, total_refunds))
    }

    fn enter(&self, amount: u64) -> Result<u64> {
        let fee = self.entry_fee * amount / FEE_BPS;
        Ok(fee)
    }

    fn redeem(&self, amount: u64) -> Result<u64> {
        let fee = self.redemption_fee * amount / FEE_BPS;
        Ok(fee)
    }

    fn distribute(&mut self, accounts: &Distribute) -> Result<()> {
        let total = accounts.token_account.amount;

        token::transfer(
            CpiContext::new_with_signer(
                accounts.token_program.to_account_info(),
                Transfer {
                    from: accounts.token_account.to_account_info(),
                    to: accounts.recipient.to_account_info(),
                    authority: accounts.accountant.to_account_info(),
                },
                &[&self.seeds()],
            ),
            total,
        )
    }

    fn set_performance_fee(&mut self, fee: u64) -> Result<()> {
        if fee > FEE_BPS {
            return Err(ErrorCode::InvalidFee.into());
        }

        self.performance_fee = fee;
        Ok(())
    }

    fn set_redemption_fee(&mut self, fee: u64) -> Result<()> {
        if fee > FEE_BPS {
            return Err(ErrorCode::InvalidFee.into());
        }

        self.redemption_fee = fee;
        Ok(())
    }

    fn set_entry_fee(&mut self, fee: u64) -> Result<()> {
        if fee > FEE_BPS {
            return Err(ErrorCode::InvalidFee.into());
        }
        
        self.entry_fee = fee;
        Ok(())
    }

    fn performance_fee(&self) -> u64 {
        self.performance_fee
    }

    fn entry_fee(&self) -> u64 {
        self.entry_fee
    }

    fn redemption_fee(&self) -> u64 {
        self.redemption_fee
    }

    fn save_changes(&self, writer: &mut dyn std::io::Write) -> Result<()> {
        self.try_to_vec().map_err(|_| ErrorCode::SerializationError.into()).and_then(|vec| {
            writer.write_all(&vec).map_err(|_| ErrorCode::SerializationError.into())
        })
    }
    
}
