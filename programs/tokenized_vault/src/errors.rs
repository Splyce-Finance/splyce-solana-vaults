use anchor_lang::prelude::*;
use strategy::Withdraw;

use crate::state::WithdrawRequest;

#[error_code]
pub enum ErrorCode {
    #[msg("Vault was shutdown")]
    VaultShutdown,

    #[msg("Zero value")]
    ZeroValue,

    #[msg("Invalid account type")]
    InvalidAccountType,

    #[msg("Debt is the same")]
    SameDebt,

    #[msg("Cannot withdraw")]
    CannotWithdraw,

    #[msg("Cannot deposit")]
    CannotDeposit,

    #[msg("Debt cannot be reduced because of unrealised losses")]
    UnrealisedLosses,

    #[msg("Debt cannot be higher than max debt")]
    DebtHigherThanMaxDebt,

    #[msg("Insufficient funds")]
    InsufficientFunds,

    #[msg("Min deposit not reached")]
    MinDepositNotReached,

    #[msg("Exceed deposit limit")]
    ExceedDepositLimit,

    #[msg("Insufficient shares")]
    InsufficientShares,

    #[msg("Exceed withdraw limit")]
    ExceedWithdrawLimit,

    #[msg("Loss is too high")]
    TooMuchLoss,

    #[msg("Strategy has debt")]
    StrategyHasDebt,

    #[msg("Vault is active")]
    VaultActive,

    #[msg("Vault has debt")]
    VaultHasDebt,

    #[msg("Only KYC verified users can deposit")]
    KYCRequired,

    #[msg("Strategy cannot be added")]
    InvalidStrategyToAdd,

    #[msg("Invalid strategy")]
    InvalidStrategy,

    #[msg("All strategy data pda must be closed before vault closure")]
    VaultHasStrategies,

    #[msg("Direct deposit is disabled")]
    DirectDepositDisabled,

    #[msg("Account is not whitelisted")]
    NotWhitelisted,

    #[msg("User deposit limit exceeded")]
    ExceedUserDepositLimit,

    #[msg("Serialization error")]
    SerializationError,

    #[msg("Withdraw requests are disabled")]
    WithdrawRequestsDisabled,

    #[msg("Direct withdraw is disabled")]
    DirectWithdrawDisabled,
}
