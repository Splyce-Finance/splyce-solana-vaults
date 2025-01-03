use anchor_lang::prelude::*;

use crate::errors::ErrorCode;

pub trait AccountInfoExt {
    fn deserialize<T>(&self) -> Result<T> where T: AnchorDeserialize;
    fn serialize<T>(&self, account: T) -> Result<()> where T: AnchorSerialize;
}

impl<'a> AccountInfoExt for AccountInfo<'a> {
    fn deserialize<T>(&self) -> Result<T> 
        where T: AnchorDeserialize 
    {
        let data = self.try_borrow_data()?;
        Ok(T::try_from_slice(&data[8..]).unwrap())
    }

    fn serialize<T>(&self, account: T) -> Result<()> 
        where T: AnchorSerialize 
    {
        let writer: &mut dyn std::io::Write = &mut &mut self.try_borrow_mut_data()?[8..];
        account.try_to_vec().map_err(|_| ErrorCode::SerializationError.into()).and_then(|vec| {
            writer.write_all(&vec).map_err(|_| ErrorCode::SerializationError.into())
        })
    }
}