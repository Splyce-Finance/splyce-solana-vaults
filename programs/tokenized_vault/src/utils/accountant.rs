use anchor_lang::prelude::*;
 
use accountant::utils::UncheckedAccountant;

pub fn report(acccountant: &UncheckedAccount, profit: u64, loss: u64) -> Result<(u64,u64)>{
    let acc = acccountant.from_unchecked()?;
    acc.report(
        profit, 
        loss
    )
}

pub fn redeem(acccountant: &UncheckedAccount, amount: u64) -> Result<u64>{
    let acc = acccountant.from_unchecked()?;
    acc.redeem(amount)
}

pub fn enter(acccountant: &UncheckedAccount, amount: u64) -> Result<u64>{
    let acc = acccountant.from_unchecked()?;
    acc.enter(amount)
}

pub fn performance_fee(acccountant: &UncheckedAccount) -> Result<u64>{
    let acc = acccountant.from_unchecked()?;
    Ok(acc.performance_fee())
}