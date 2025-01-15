use access_control::state::UserRole;
use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::state::{UserData, Vault};
use crate::utils::unchecked::*;

pub fn validate_deposit<'info>(
    vault_loader: &AccountLoader<'info, Vault>,
    kyc_verified: &AccountInfo<'info>,
    user_data: &Account<'info, UserData>,
    is_direct: bool,
    amount: u64
) -> Result<()> {
    if amount == 0 {
        return Err(ErrorCode::ZeroValue.into());
    }

    let vault = vault_loader.load()?;

    if vault.is_shutdown {
        return Err(ErrorCode::VaultShutdown.into());
    }

    if is_direct && !vault.direct_deposit_enabled {
        return Err(ErrorCode::DirectDepositDisabled.into());
    }

    if vault.user_deposit_limit > 0 && user_data.deposited + amount > vault.user_deposit_limit {
        return Err(ErrorCode::ExceedUserDepositLimit.into());
    }

    if user_data.deposited + amount < vault.min_user_deposit {
        return Err(ErrorCode::MinDepositNotReached.into());
    }

    // todo: introduce deposit limit module
    if amount > vault.max_deposit() {
        return Err(ErrorCode::ExceedDepositLimit.into());
    }

    if vault.kyc_verified_only {
        if kyc_verified.data_is_empty() || !kyc_verified.deserialize::<UserRole>()?.has_role {
            return Err(ErrorCode::KYCRequired.into());
        }
    }

    if vault.whitelisted_only && !user_data.whitelisted {
        return Err(ErrorCode::NotWhitelisted.into());
    }

    Ok(())
}
