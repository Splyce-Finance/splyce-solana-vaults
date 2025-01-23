use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

pub fn get_token_balance(account_info: &AccountInfo) -> Result<u64> {
    let token_account = TokenAccount::try_deserialize(&mut &account_info.try_borrow_data()?[..])?;
    Ok(token_account.amount)
}