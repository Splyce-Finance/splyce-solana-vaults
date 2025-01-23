use anchor_lang::{
    prelude::*, 
    Discriminator
};

use crate::state::*;
use crate::error::ErrorCode;

pub trait UncheckedStrategy {
    fn get_discriminator(&self) -> Result<[u8; 8]>;
    fn underlying_mint(&self) -> Pubkey;
    fn manager(&self) -> Pubkey;
    fn vault(&self) -> Pubkey;
    fn from_unchecked(&self) -> Result<Box<dyn Strategy>>;
    fn save_changes<T>(&self, strategy: Box<T>) -> Result<()> 
        where T: Strategy + AnchorSerialize;
}

impl<'a> UncheckedStrategy for UncheckedAccount<'a> {
    fn get_discriminator(&self) -> Result<[u8; 8]> {
        let data = self.try_borrow_data()?;
        let discriminator = data[0..8].try_into().map_err(|_| ErrorCode::InvalidStrategyData)?;
        Ok(discriminator)
    }
    fn underlying_mint(&self) -> Pubkey {
        let strategy = self.from_unchecked().unwrap();
        strategy.underlying_mint()
    }

    fn manager(&self) -> Pubkey {
        let strategy = self.from_unchecked().unwrap();
        strategy.manager()
    }

    fn vault(&self) -> Pubkey {
        let strategy = self.from_unchecked().unwrap();
        strategy.vault()
    }

    fn from_unchecked(&self) -> Result<Box<dyn Strategy>> {
        deserialize(&self.to_account_info())
    }

    fn save_changes<T>(&self, strategy: Box<T>) -> Result<()> 
    where
        T: Strategy + AnchorSerialize
    {
        let mut strategy_data = self.try_borrow_mut_data()?;
        strategy.serialize(&mut &mut strategy_data[8..])?;
        Ok(())
    }
}

pub fn deserialize(strategy: &AccountInfo) -> Result<Box<dyn Strategy>> {
    let strategy_data = strategy.try_borrow_data()?;
    let discriminator = strategy_data[0..8].try_into().map_err(|_| ErrorCode::InvalidStrategyData)?;

    match discriminator {
        SimpleStrategy::DISCRIMINATOR => {
            let strategy = SimpleStrategy::try_from_slice(&strategy_data[8..])
                .map_err(|_| ErrorCode::InvalidStrategyData)?;
            Ok(Box::new(strategy))
        }
        TradeFintechStrategy::DISCRIMINATOR => {
            let strategy = TradeFintechStrategy::try_from_slice(&strategy_data[8..])
                .map_err(|_| ErrorCode::InvalidStrategyData)?;
            Ok(Box::new(strategy))
        }
        OrcaStrategy::DISCRIMINATOR => {
            let strategy = OrcaStrategy::try_from_slice(&strategy_data[8..])
                .map_err(|_| ErrorCode::InvalidStrategyData)?;
            Ok(Box::new(strategy))
        }
        _ => {
            msg!("Invalid discriminator");
            Err(ErrorCode::InvalidStrategyData.into())
        }
    }
}