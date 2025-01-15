use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use super::base_strategy::*;
use super::fee_data::*;
use super::StrategyType;
use crate::error::ErrorCode;
use crate::events::{
    OrcaInitEvent,
    OrcaAfterSwapEvent,
    HarvestAndReportDTFEvent, 
    StrategyDeployFundsEvent,
    StrategyDepositEvent, 
    StrategyFreeFundsEvent, 
    StrategyInitEvent, 
    StrategyWithdrawEvent,
};

use crate::constants::{
    MAX_SQRT_PRICE_X64, 
    MIN_SQRT_PRICE_X64,
    NO_EXPLICIT_SQRT_PRICE_LIMIT, 
    ORCA_ACCOUNTS_PER_SWAP,
};
use crate::instructions::{DeployFunds, FreeFunds, Report, ReportLoss, ReportProfit};
use crate::utils::{
    execute_swap::{SwapContext, SwapDirection},
    whirlpool
};

#[account]
#[derive(Default, Debug, InitSpace)]
pub struct OrcaStrategy {
    /// Bump to identify PDA
    pub bump: [u8; 1],
    pub index_bytes: [u8; 8],

    /// vault
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub underlying_mint: Pubkey,
    pub underlying_token_acc: Pubkey,
    pub underlying_decimals: u8,

    pub total_invested: u64, // asset amount * asset price
    pub total_assets: u64, // In orca, this is idle_underlying + total_invested //what can be the problem here?
    pub deposit_limit: u64, // Use it when testing beta version

    pub fee_data: FeeData,

    pub whirlpool_id: Pubkey,
    pub asset_mint: Pubkey,
    pub asset_amount: u64,
    pub asset_price: u128,
    pub asset_decimals: u8,
    pub idle_underlying: u64,

    pub a_to_b_for_purchase: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OrcaStrategyConfig {
    pub deposit_limit: u64,
    pub performance_fee: u64,
    pub fee_manager: Pubkey,
    pub whirlpool_id: Pubkey,
    pub asset_mint: Pubkey,
    pub asset_decimals: u8,
    pub a_to_b_for_purchase: bool,
}

#[error_code]
pub enum OrcaStrategyErrorCode {
    #[msg("Place Holder Error1")]
    Error1,
    #[msg("Not enough accounts")]
    NotEnoughAccounts,
    #[msg("Invalid account")]
    InvalidAccount,
    #[msg("Invalid underlying token account for the swap direction")]
    InvalidUnderlyingToken,
    #[msg("Math error")]
    MathError,
    #[msg("Total weight must equal MAX_ASSIGNED_WEIGHT")]
    InvalidTotalWeight,
    #[msg("Cannot rebalance with zero total asset value")]
    ZeroTotalAssetValue,
    #[msg("No underlying tokens obtained from sales during rebalance")]
    NoUnderlyingTokensObtained,
}

impl StrategyManagement for OrcaStrategy {
    fn manager(&self) -> Pubkey {
        self.manager
    }

    fn set_manager(&mut self, manager: Pubkey) -> Result<()> {
        self.manager = manager;
        Ok(())
    }
}

impl Strategy for OrcaStrategy {
    fn deposit(&mut self, amount: u64) -> Result<()> {
        self.total_assets += amount;
        self.idle_underlying += amount;

        emit!(StrategyDepositEvent {
            account_key: self.key(),
            amount: amount,
            total_assets: self.total_assets,
        });

        Ok(())
    }

    fn withdraw(&mut self, amount: u64) -> Result<()> {
        self.total_assets -= amount;
        self.idle_underlying -= amount;

        emit!(StrategyWithdrawEvent {
            account_key: self.key(),
            amount: amount,
            total_assets: self.total_assets,
        });

        Ok(())
    }
    //There is no fees to withdraw for this strategy
    #[allow(unused_variables)]
    fn withdraw_fees(&mut self, amount: u64) -> Result<()> {
        Ok(())
    }

    #[allow(unused_variables)]
    fn report_profit<'info>(
        &mut self,
        accounts: &ReportProfit<'info>,
        remaining: &[AccountInfo<'info>],
        profit: u64,
    ) -> Result<()> {
        Err(ErrorCode::OperactionNotSupported.into())
    }

    #[allow(unused_variables)]
    fn report_loss<'info>(
        &mut self,
        accounts: &ReportLoss<'info>,
        remaining: &[AccountInfo<'info>],
        loss: u64,
    ) -> Result<()> {
        Err(ErrorCode::OperactionNotSupported.into())
    }

    fn harvest_and_report<'info>(
        &mut self,
        _accounts: &Report<'info>,
        remaining: &[AccountInfo<'info>],
    ) -> Result<u64> {
        require!(
            self.whirlpool_id == remaining[0].key(),
            ErrorCode::InvalidAccount
        );

        self.total_invested = whirlpool::get_assets_value_in_underlying(
            &remaining[0],
            self.asset_amount,
            self.asset_decimals,
            self.underlying_decimals,
            self.a_to_b_for_purchase,
        )
        .unwrap();

        let new_total_assets = self.idle_underlying + self.total_invested;

        // Emit event with total assets and timestamp
        emit!(HarvestAndReportDTFEvent {
            account_key: self.key(),
            total_assets: new_total_assets, //basically total asset value in USDC which is the underlying token
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(new_total_assets)
    }

    //Free fund swaps asset to underlying token
    //Make sure sales would happen based on the current weight from the invest tracker
    fn free_funds<'info>(
        &mut self,
        accounts: &FreeFunds<'info>,
        remaining: &[AccountInfo<'info>],
        amount: u64,
    ) -> Result<()> {
        // we have to report on the current state of the strategy before freeing funds
        self.report(
            &Report {
                strategy: accounts.strategy.clone(),
                underlying_token_account: accounts.underlying_token_account.clone(),
                underlying_mint: accounts.underlying_mint.clone(),
                signer: accounts.signer.clone(),
                token_program: accounts.token_program.clone(),
            },
            &[remaining[1].clone()],
        )
        .unwrap();

        require!(
            remaining.len() == ORCA_ACCOUNTS_PER_SWAP,
            OrcaStrategyErrorCode::NotEnoughAccounts
        );

        let swap_ctx = SwapContext {
            whirlpool_program: remaining[0].clone(),
            whirlpool: remaining[1].clone(),
            token_owner_account_a: remaining[2].clone(),
            token_vault_a: remaining[3].clone(),
            token_owner_account_b: remaining[4].clone(),
            token_vault_b: remaining[5].clone(),
            tick_array_0: remaining[6].clone(),
            tick_array_1: remaining[7].clone(),
            tick_array_2: remaining[8].clone(),
            oracle: remaining[9].clone(),
            token_program: accounts.token_program.to_account_info(),
            strategy: accounts.strategy.to_account_info(),
        };

        let sqrt_price_limit = if !self.a_to_b_for_purchase {
            MIN_SQRT_PRICE_X64
        } else {
            MAX_SQRT_PRICE_X64
        };

        // Perform swap with calculated parameters
        let (
            underlying_balance_before,
            underlying_balance_after,
            asset_balance_before,
            asset_balance_after,
        ) = swap_ctx.perform_swap(
            &[&self.seeds()[..]],
            amount,
            SwapDirection::Sell,
            false,
            sqrt_price_limit,
            u64::MAX,
            self.underlying_token_acc,
            self.a_to_b_for_purchase,
        )?;

        self.asset_amount = asset_balance_after;
        self.idle_underlying = underlying_balance_after;
        self.total_invested = whirlpool::get_assets_value_in_underlying(
            &remaining[1],
            self.asset_amount,
            self.asset_decimals,
            self.underlying_decimals,
            self.a_to_b_for_purchase,
        )
        .unwrap();

        // Report current state to sync total_assets after swap
        self.report(
            &Report {
                strategy: accounts.strategy.clone(),
                underlying_token_account: accounts.underlying_token_account.clone(),
                underlying_mint: accounts.underlying_mint.clone(),
                signer: accounts.signer.clone(),
                token_program: accounts.token_program.clone(),
            },
            &[remaining[1].clone()],
        )
        .unwrap();

        emit!(StrategyFreeFundsEvent {
            account_key: self.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        emit!(OrcaAfterSwapEvent {
            account_key: self.key(),
            vault: self.vault,
            buy: false,
            amount: amount,
            total_invested: self.total_invested,
            whirlpool_id: self.whirlpool_id,
            underlying_mint: self.underlying_mint,
            underlying_decimals: self.underlying_decimals,
            asset_mint: self.asset_mint,
            asset_amount: self.asset_amount,
            asset_decimals: self.asset_decimals,
            total_assets: self.total_assets,
            idle_underlying: self.idle_underlying,
            a_to_b_for_purchase: self.a_to_b_for_purchase,
            underlying_balance_before: underlying_balance_before,
            underlying_balance_after: underlying_balance_after,
            asset_balance_before: asset_balance_before,
            asset_balance_after: asset_balance_after,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    fn deploy_funds<'info>(
        &mut self,
        accounts: &DeployFunds<'info>,
        remaining: &[AccountInfo<'info>],
        amount: u64,
    ) -> Result<()> {
        // we have to report on the current state of the strategy before freeing funds
        self.report(
            &Report {
                strategy: accounts.strategy.clone(),
                underlying_token_account: accounts.underlying_token_account.clone(),
                underlying_mint: accounts.underlying_mint.clone(),
                signer: accounts.signer.clone(),
                token_program: accounts.token_program.clone(),
            },
            &[remaining[1].clone()],
        )
        .unwrap();

        require!(
            remaining.len() == ORCA_ACCOUNTS_PER_SWAP,
            OrcaStrategyErrorCode::NotEnoughAccounts
        );

        // TODO: get rid of magic numbers
        let swap_ctx = SwapContext {
            whirlpool_program: remaining[0].clone(),
            whirlpool: remaining[1].clone(),
            token_owner_account_a: remaining[2].clone(),
            token_vault_a: remaining[3].clone(),
            token_owner_account_b: remaining[4].clone(),
            token_vault_b: remaining[5].clone(),
            tick_array_0: remaining[6].clone(),
            tick_array_1: remaining[7].clone(),
            tick_array_2: remaining[8].clone(),
            oracle: remaining[9].clone(),
            token_program: accounts.token_program.to_account_info(),
            strategy: accounts.strategy.to_account_info(),
        };

        let (
            underlying_balance_before,
            underlying_balance_after,
            asset_balance_before,
            asset_balance_after,
        ) = swap_ctx.perform_swap(
            &[&self.seeds()[..]],
            amount,
            SwapDirection::Buy,
            true,
            NO_EXPLICIT_SQRT_PRICE_LIMIT,
            0,
            self.underlying_token_acc,
            self.a_to_b_for_purchase,
        )?;

        self.asset_amount = asset_balance_after;
        self.idle_underlying = underlying_balance_after;
        self.total_invested = whirlpool::get_assets_value_in_underlying(
            &remaining[1],
            self.asset_amount,
            self.asset_decimals,
            self.underlying_decimals,
            self.a_to_b_for_purchase,
        )
        .unwrap();

        let invested = underlying_balance_before
            .checked_sub(underlying_balance_after)
            .ok_or(OrcaStrategyErrorCode::MathError)?;

        self.total_invested = self
            .total_invested
            .checked_add(invested)
            .ok_or(OrcaStrategyErrorCode::MathError)?;

        // Report current state to sync total_assets after swap
        self.report(
            &Report {
                strategy: accounts.strategy.clone(),
                underlying_token_account: accounts.underlying_token_account.clone(),
                underlying_mint: accounts.underlying_mint.clone(),
                signer: accounts.signer.clone(),
                token_program: accounts.token_program.clone(),
            },
            &[remaining[1].clone()],
        )
        .unwrap();

        emit!(StrategyDeployFundsEvent {
            account_key: self.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        //emiting for data massaging on subgraph
        emit!(OrcaAfterSwapEvent {
            account_key: self.key(),
            vault: self.vault,
            buy: true,
            amount: amount,
            total_invested: self.total_invested,
            whirlpool_id: self.whirlpool_id,
            underlying_mint: self.underlying_mint,
            underlying_decimals: self.underlying_decimals,
            asset_mint: self.asset_mint,
            asset_amount: self.asset_amount,
            asset_decimals: self.asset_decimals,
            total_assets: self.total_assets,
            idle_underlying: self.idle_underlying,
            a_to_b_for_purchase: self.a_to_b_for_purchase,
            underlying_balance_before: underlying_balance_before,
            underlying_balance_after: underlying_balance_after,
            asset_balance_before: asset_balance_before,
            asset_balance_after: asset_balance_after,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    fn set_total_assets(&mut self, total_assets: u64) {
        self.total_assets = total_assets;
    }
}

impl StrategyGetters for OrcaStrategy {
    fn strategy_type(&self) -> StrategyType {
        StrategyType::Orca
    }

    fn underlying_mint(&self) -> Pubkey {
        self.underlying_mint
    }

    fn vault(&self) -> Pubkey {
        self.vault
    }

    fn token_account(&self) -> Pubkey {
        self.underlying_token_acc
    }

    fn total_assets(&self) -> u64 {
        self.total_assets
    }

    fn total_invested(&self) -> u64 {
        self.total_invested
    }

    fn available_deposit(&self) -> u64 {
        self.deposit_limit - self.total_assets
    }

    fn available_withdraw(&self) -> u64 {
        self.total_assets
    }

    fn fee_data(&mut self) -> &mut FeeData {
        &mut self.fee_data
    }
}

impl StrategyInit for OrcaStrategy {
    fn init(
        &mut self,
        bump: u8,
        index: u64,
        vault: Pubkey,
        underlying_mint: &InterfaceAccount<Mint>,
        underlying_token_acc: Pubkey,
        config_bytes: Vec<u8>,
    ) -> Result<()> {
        let config: OrcaStrategyConfig = OrcaStrategyConfig::try_from_slice(&config_bytes)
            .map_err(|_| ErrorCode::InvalidStrategyConfig)?;

        self.bump = [bump];
        self.index_bytes = index.to_le_bytes();
        self.vault = vault;
        self.underlying_mint = underlying_mint.key();
        self.underlying_decimals = underlying_mint.decimals;
        self.underlying_token_acc = underlying_token_acc;
        self.deposit_limit = config.deposit_limit;
        self.total_assets = 0;
        self.total_invested = 0;
        self.whirlpool_id = config.whirlpool_id;
        self.asset_mint = config.asset_mint;
        self.asset_decimals = config.asset_decimals;
        self.a_to_b_for_purchase = config.a_to_b_for_purchase;

        self.fee_data = FeeData {
            fee_manager: config.fee_manager,
            performance_fee: config.performance_fee,
            fee_balance: 0,
        };

        emit!(StrategyInitEvent {
            account_key: self.key(),
            strategy_type: String::from("DETF-Strategy"),
            vault: self.vault,
            underlying_mint: self.underlying_mint,
            underlying_token_acc: self.underlying_token_acc,
            underlying_decimals: self.underlying_decimals,
            deposit_limit: self.deposit_limit,
            deposit_period_ends: 0,
            lock_period_ends: 0,
        });

        emit!(OrcaInitEvent {
            account_key: self.key(),
            whirlpool_id: self.whirlpool_id,
            asset_mint: self.asset_mint,
            asset_decimals: self.asset_decimals,
            a_to_b_for_purchase: self.a_to_b_for_purchase,
        });

        Ok(())
    }
}

impl StrategyDataAccount for OrcaStrategy {
    fn save_changes(&self, writer: &mut dyn std::io::Write) -> Result<()> {
        self.try_to_vec()
            .map_err(|_| ErrorCode::SerializationError.into())
            .and_then(|vec| {
                writer
                    .write_all(&vec)
                    .map_err(|_| ErrorCode::SerializationError.into())
            })
    }

    fn seeds(&self) -> [&[u8]; 3] {
        [
            self.vault.as_ref(),
            self.index_bytes.as_ref(),
            self.bump.as_ref(),
        ]
    }
}
