use anchor_lang::prelude::*;
use whirlpool_cpi::{ self, state::Whirlpool };

use crate::constants::{ ASSET_VALUE_DISCOUNT_BPS, FEE_BPS };
use crate::error::ErrorCode;
use super::orca_utils;

pub fn get_assets_value_in_underlying(
    whirlpool_acc_info: &AccountInfo,
    asset_amount: u64,
    asset_decimals: u8,
    underlying_decimals: u8,
    a_to_b_for_purchase: bool,
) -> Result<u64> {
        let whirlpool_data = whirlpool_acc_info.try_borrow_data()?;
        let whirlpool = Whirlpool::try_from_slice(&whirlpool_data[8..])?;

        let (a_decimals, b_decimals) = if a_to_b_for_purchase {
            (underlying_decimals, asset_decimals)
        } else {
            (asset_decimals, underlying_decimals)
        };

        let asset_price = orca_utils::get_price_in_underlying_decimals(
            whirlpool.sqrt_price,
            a_to_b_for_purchase,
            a_decimals,
            b_decimals,
        );

        let full_asset_value = orca_utils::compute_asset_value(
            asset_amount,
            asset_price,
            asset_decimals,
        );

        let asset_value = full_asset_value
            .checked_mul((FEE_BPS - ASSET_VALUE_DISCOUNT_BPS as u64) as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(FEE_BPS as u128)
            .ok_or(ErrorCode::MathOverflow)?;

        // Ensure total_asset_value fits in u64
        if asset_value > u64::MAX as u128 {
            return Err(ErrorCode::MathError.into());
        }

        Ok(asset_value as u64)
}