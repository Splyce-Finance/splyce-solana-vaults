use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use super::base_strategy::*;
use super::StrategyType;
use super::fee_data::*;
use crate::error::ErrorCode;
use crate::events::{StrategyDepositEvent, StrategyInitEvent, StrategyWithdrawEvent, HarvestAndReportDTFEvent, InvestTrackerSwapEvent, StrategyDeployFundsEvent, StrategyFreeFundsEvent};

use crate::instructions::{Report, ReportProfit, ReportLoss, DeployFunds, FreeFunds, Rebalance};
use crate::constants::{
    MAX_SQRT_PRICE_X64, 
    MIN_SQRT_PRICE_X64, INVEST_TRACKER_SEED, NO_EXPLICIT_SQRT_PRICE_LIMIT, 
    MAX_ASSIGNED_WEIGHT,
    ORCA_ACCOUNTS_PER_SWAP, ORCA_INVEST_TRACKER_OFFSET
};
use crate::state::invest_tracker::*;
use crate::utils::{
    get_token_balance,
    orca_utils::compute_asset_per_swap,
};
use crate::utils::execute_swap::{SwapContext, SwapDirection};

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

    pub total_invested: u64, // It's here but not used since total_invested can underflow in orca_strategy when withdrawl amount gets bigger than deposited amount due to asset appreciation
    pub total_assets: u64, // In orca, this is not actual total assets but total asset value in underlying token units (total asset value)
    pub deposit_limit: u64, // Use it when testing beta version

    pub fee_data: FeeData,
}   

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OrcaStrategyConfig {
    pub deposit_limit: u64,
    pub deposit_period_ends: i64,
    pub lock_period_ends: i64,
    pub performance_fee: u64,
    pub fee_manager: Pubkey,
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

        emit!(
            StrategyDepositEvent 
            {
                account_key: self.key(),
                amount: amount,
                total_assets: self.total_assets,
            }
        );

        Ok(())
    }

    fn withdraw(&mut self, amount: u64) -> Result<()> {
        self.total_assets -= amount;

        emit!(
            StrategyWithdrawEvent 
            {
                account_key: self.key(),
                amount: amount,
                total_assets: self.total_assets,
            }
        );

        Ok(())
    }
    //There is no fees to withdraw for this strategy
    #[allow(unused_variables)]
    fn withdraw_fees(&mut self, amount: u64) -> Result<()> {
        Ok(())
    }

    #[allow(unused_variables)]
    fn report_profit<'info>(&mut self, accounts: &ReportProfit<'info>, remaining: &[AccountInfo<'info>], profit: u64) -> Result<()> {
        // Verify we have enough remaining accounts and that they come in pairs
        if remaining.len() < 2 || remaining.len() % 2 != 0 {
            return Err(OrcaStrategyErrorCode::NotEnoughAccounts.into());
        }

        self.report(
            &mut Report {
                strategy: accounts.strategy.clone(),
                underlying_token_account: accounts.underlying_token_account.clone(),
                underlying_mint: accounts.underlying_mint.clone(),
                token_program: accounts.token_program.clone(),
                signer: accounts.signer.clone(),
            },
            &remaining
        )?;

        Ok(())
    }

    #[allow(unused_variables)]
    fn report_loss<'info>(&mut self, accounts: &ReportLoss<'info>, remaining: &[AccountInfo<'info>], loss: u64) -> Result<()> {
        // Verify we have enough remaining accounts and that they come in pairs
        if remaining.len() < 2 || remaining.len() % 2 != 0 {
            return Err(OrcaStrategyErrorCode::NotEnoughAccounts.into());
        }

        self.report(
            &mut Report {
                strategy: accounts.strategy.clone(),
                underlying_token_account: accounts.underlying_token_account.clone(),
                underlying_mint: accounts.underlying_mint.clone(),
                token_program: accounts.token_program.clone(),
                signer: accounts.signer.clone(),
            },
            &remaining
        )?;

        Ok(())
    }

    #[allow(unused_variables)]
    fn harvest_and_report<'info>(&mut self, accounts: &Report<'info>, remaining: &[AccountInfo<'info>]) -> Result<u64> {
        if accounts.underlying_token_account.key() != self.underlying_token_acc {
            return Err(ErrorCode::InvalidAccount.into());
        }

        // Calculate total asset value from all invest tracker accounts
        let mut total_asset_value: u128 = 0;

        // Iterate through invest tracker accounts in pairs
        // Each pair consists of (invest_tracker, asset_mint_account)
        for chunk in remaining.chunks(2) {
            if chunk.len() != 2 {
                return Err(OrcaStrategyErrorCode::NotEnoughAccounts.into());
            }

            let invest_tracker_info = &chunk[0];
            let asset_mint_info = &chunk[1];
            
            // Verify invest tracker PDA using the provided mint account
            self.verify_invest_tracker(
                invest_tracker_info,
                asset_mint_info.key(),
                accounts.strategy.key()
            )?;

            // Get invest tracker data
            let data = invest_tracker_info.try_borrow_data()?;
            let invest_tracker_data = InvestTracker::try_from_slice(&data[8..])?;
            
            // Verify that the mint in invest tracker matches the provided mint account
            require!(invest_tracker_data.asset_mint == asset_mint_info.key(), ErrorCode::InvalidAccount);

            // Add asset value to total
            total_asset_value = total_asset_value
                .checked_add(invest_tracker_data.asset_value)
                .ok_or(OrcaStrategyErrorCode::MathError)?;
        }

        // Ensure total_asset_value fits in u64
        if total_asset_value > u64::MAX as u128 {
            return Err(OrcaStrategyErrorCode::MathError.into());
        }

        let new_total_assets = total_asset_value as u64;

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
    fn free_funds<'info>(&mut self, accounts: &FreeFunds<'info>, remaining: &[AccountInfo<'info>], amount: u64) -> Result<()> {
        let num_swaps = remaining.len() / ORCA_ACCOUNTS_PER_SWAP;
        require!(remaining.len() == num_swaps * ORCA_ACCOUNTS_PER_SWAP, OrcaStrategyErrorCode::NotEnoughAccounts);

        // Calculate amounts for each swap based on current weights
        let (amounts, _) = self.compute_sell_allocations(remaining, amount, num_swaps)?;

        for i in 0..num_swaps {
            let start = i * ORCA_ACCOUNTS_PER_SWAP;
            let invest_tracker_account = &remaining[start + ORCA_INVEST_TRACKER_OFFSET];

            // Extract required data in a limited scope to avoid double borrowing
            let (is_a_to_b, asset_mint) = {
                let data = invest_tracker_account.try_borrow_data()?;
                let invest_tracker_data = InvestTracker::try_from_slice(&data[8..])?;
                (invest_tracker_data.a_to_b_for_purchase, invest_tracker_data.asset_mint)
            }; // Data borrow is dropped here

            let swap_ctx = SwapContext {
                whirlpool_program: remaining[start].clone(),
                whirlpool: remaining[start + 1].clone(),
                token_owner_account_a: remaining[start + 2].clone(),
                token_vault_a: remaining[start + 3].clone(),
                token_owner_account_b: remaining[start + 4].clone(),
                token_vault_b: remaining[start + 5].clone(),
                tick_array_0: remaining[start + 6].clone(),
                tick_array_1: remaining[start + 7].clone(),
                tick_array_2: remaining[start + 8].clone(),
                oracle: remaining[start + 9].clone(),
                invest_tracker_account: invest_tracker_account.clone(),
                token_program: accounts.token_program.to_account_info(),
                strategy: accounts.strategy.to_account_info(),
            };

            self.execute_swap_operation(
                &swap_ctx,
                amounts[i],
                SwapDirection::Sell,
                false,
                if is_a_to_b { MIN_SQRT_PRICE_X64 } else { MAX_SQRT_PRICE_X64 },
                u64::MAX,
                asset_mint,    // Pass asset_mint
                is_a_to_b,     // Pass is_a_to_b
            )?;
        }

        emit!(StrategyFreeFundsEvent {
            account_key: self.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    fn deploy_funds<'info>(&mut self, accounts: &DeployFunds<'info>, remaining: &[AccountInfo<'info>], amount: u64) -> Result<()> {
        let num_swaps = remaining.len() / ORCA_ACCOUNTS_PER_SWAP;
        require!(remaining.len() == num_swaps * ORCA_ACCOUNTS_PER_SWAP, OrcaStrategyErrorCode::NotEnoughAccounts);

        // Validate weights
        let weights = self.validate_weights(remaining, num_swaps)?;

        for i in 0..num_swaps {
            let start = i * ORCA_ACCOUNTS_PER_SWAP;
            let amount_per_swap = compute_asset_per_swap(
                amount,
                weights[i] as u128,
                MAX_ASSIGNED_WEIGHT as u128
            );

            let invest_tracker_account = &remaining[start + ORCA_INVEST_TRACKER_OFFSET];
            
            // Extract required data in a limited scope
            let (is_a_to_b, asset_mint) = {
                let data = invest_tracker_account.try_borrow_data()?;
                let invest_tracker_data = InvestTracker::try_from_slice(&data[8..])?;
                (invest_tracker_data.a_to_b_for_purchase, invest_tracker_data.asset_mint)
            }; // Data borrow is dropped here

            let swap_ctx = SwapContext {
                whirlpool_program: remaining[start].clone(),
                whirlpool: remaining[start + 1].clone(),
                token_owner_account_a: remaining[start + 2].clone(),
                token_vault_a: remaining[start + 3].clone(),
                token_owner_account_b: remaining[start + 4].clone(),
                token_vault_b: remaining[start + 5].clone(),
                tick_array_0: remaining[start + 6].clone(),
                tick_array_1: remaining[start + 7].clone(),
                tick_array_2: remaining[start + 8].clone(),
                oracle: remaining[start + 9].clone(),
                invest_tracker_account: invest_tracker_account.clone(),
                token_program: accounts.token_program.to_account_info(),
                strategy: accounts.strategy.to_account_info(),
            };

            self.execute_swap_operation(
                &swap_ctx,
                amount_per_swap,
                SwapDirection::Buy,
                true,
                NO_EXPLICIT_SQRT_PRICE_LIMIT,
                0,
                asset_mint,    // Pass asset_mint
                is_a_to_b,     // Pass is_a_to_b
            )?;
        }

        emit!(StrategyDeployFundsEvent {
            account_key: self.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    fn set_total_assets(&mut self, total_assets: u64) {
        self.total_assets = total_assets;
    }

    fn rebalance<'info>(&mut self, accounts: &Rebalance<'info>, remaining: &[AccountInfo<'info>], _amount: u64) -> Result<()> {
        // Calculate number of swaps based on remaining accounts length
        let num_swaps = remaining.len() / ORCA_ACCOUNTS_PER_SWAP;
        if remaining.len() != num_swaps * ORCA_ACCOUNTS_PER_SWAP {
            return Err(OrcaStrategyErrorCode::NotEnoughAccounts.into());
        }

        // First, collect InvestTracker data and total asset value
        let (invest_tracker_data_vec, total_asset_value) = self.collect_invest_tracker_data(remaining, num_swaps)?;

        if total_asset_value == 0 {
            return Err(OrcaStrategyErrorCode::ZeroTotalAssetValue.into());
        }

        // Determine assets to sell and buy
        let mut sell_list = Vec::new(); // (index, delta_value)
        let mut buy_list = Vec::new(); // (index, delta_value)

        for (i, invest_tracker_data) in invest_tracker_data_vec.iter().enumerate() {
            let assigned_weight = invest_tracker_data.assigned_weight as u128;
            let target_value = total_asset_value
                .checked_mul(assigned_weight)
                .ok_or(OrcaStrategyErrorCode::MathError)?
                .checked_div(MAX_ASSIGNED_WEIGHT as u128)
                .ok_or(OrcaStrategyErrorCode::MathError)?;

            let current_value = invest_tracker_data.asset_value;

            if current_value > target_value {
                let delta_value = current_value.checked_sub(target_value).ok_or(OrcaStrategyErrorCode::MathError)?;
                sell_list.push((i, delta_value)); // (index, delta_value)
            } else if current_value < target_value {
                let delta_value = target_value.checked_sub(current_value).ok_or(OrcaStrategyErrorCode::MathError)?;
                buy_list.push((i, delta_value)); // (index, delta_value)
            }
        }

        // Process selling assets first
        let underlying_balance_before = get_token_balance(&accounts.underlying_token_account.to_account_info())?;
        
        for (i, delta_value) in sell_list {
            let start = i * ORCA_ACCOUNTS_PER_SWAP;
            let amount_per_swap = delta_value as u64;

            // Extract required data in a limited scope
            let invest_tracker_account = &remaining[start + ORCA_INVEST_TRACKER_OFFSET];
            let (is_a_to_b, asset_mint) = {
                let data = invest_tracker_account.try_borrow_data()?;
                let invest_tracker_data = InvestTracker::try_from_slice(&data[8..])?;
                (invest_tracker_data.a_to_b_for_purchase, invest_tracker_data.asset_mint)
            }; // Data borrow is dropped here

            let swap_ctx = SwapContext {
                whirlpool_program: remaining[start].clone(),
                whirlpool: remaining[start + 1].clone(),
                token_owner_account_a: remaining[start + 2].clone(),
                token_vault_a: remaining[start + 3].clone(),
                token_owner_account_b: remaining[start + 4].clone(),
                token_vault_b: remaining[start + 5].clone(),
                tick_array_0: remaining[start + 6].clone(),
                tick_array_1: remaining[start + 7].clone(),
                tick_array_2: remaining[start + 8].clone(),
                oracle: remaining[start + 9].clone(),
                invest_tracker_account: invest_tracker_account.clone(),
                token_program: accounts.token_program.to_account_info(),
                strategy: accounts.strategy.to_account_info(),
            };

            self.execute_swap_operation(
                &swap_ctx,
                amount_per_swap,
                SwapDirection::Sell,
                false,
                if is_a_to_b { MIN_SQRT_PRICE_X64 } else { MAX_SQRT_PRICE_X64 },
                u64::MAX,
                asset_mint,    // Add asset_mint parameter
                is_a_to_b,     // Add is_a_to_b parameter
            )?;
        }

        // Calculate total underlying tokens obtained
        let underlying_balance_after = get_token_balance(&accounts.underlying_token_account.to_account_info())?;
        let total_underlying_obtained = underlying_balance_after
            .checked_sub(underlying_balance_before)
            .ok_or(OrcaStrategyErrorCode::MathError)?;

        // Check if we obtained any underlying tokens
        if total_underlying_obtained == 0 {
            return Err(OrcaStrategyErrorCode::NoUnderlyingTokensObtained.into());
        }

        // Calculate total delta_value for buys
        let total_buy_value: u128 = buy_list.iter().map(|&(_, delta_value)| delta_value).sum();

        // Process buying assets
        for (i, delta_value) in buy_list {
            let start = i * ORCA_ACCOUNTS_PER_SWAP;
            let amount_per_swap = compute_asset_per_swap(
                total_underlying_obtained,
                delta_value,
                total_buy_value,
            );

            // Extract required data in a limited scope
            let invest_tracker_account = &remaining[start + ORCA_INVEST_TRACKER_OFFSET];
            let (is_a_to_b, asset_mint) = {
                let data = invest_tracker_account.try_borrow_data()?;
                let invest_tracker_data = InvestTracker::try_from_slice(&data[8..])?;
                (invest_tracker_data.a_to_b_for_purchase, invest_tracker_data.asset_mint)
            }; // Data borrow is dropped here

            let swap_ctx = SwapContext {
                whirlpool_program: remaining[start].clone(),
                whirlpool: remaining[start + 1].clone(),
                token_owner_account_a: remaining[start + 2].clone(),
                token_vault_a: remaining[start + 3].clone(),
                token_owner_account_b: remaining[start + 4].clone(),
                token_vault_b: remaining[start + 5].clone(),
                tick_array_0: remaining[start + 6].clone(),
                tick_array_1: remaining[start + 7].clone(),
                tick_array_2: remaining[start + 8].clone(),
                oracle: remaining[start + 9].clone(),
                invest_tracker_account: invest_tracker_account.clone(),
                token_program: accounts.token_program.to_account_info(),
                strategy: accounts.strategy.to_account_info(),
            };

            self.execute_swap_operation(
                &swap_ctx,
                amount_per_swap,
                SwapDirection::Buy,
                true,
                NO_EXPLICIT_SQRT_PRICE_LIMIT,
                0,
                asset_mint,    // Add asset_mint parameter
                is_a_to_b,     // Add is_a_to_b parameter
            )?;
        }

        Ok(())
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

        self.fee_data = FeeData {
            fee_manager: config.fee_manager,
            performance_fee: config.performance_fee,
            fee_balance: 0,
        };

        emit!(
            StrategyInitEvent 
            {
                account_key: self.key(),
                strategy_type: String::from("DETF-Strategy"),
                vault: self.vault,
                underlying_mint: self.underlying_mint,
                underlying_token_acc: self.underlying_token_acc,
                underlying_decimals: self.underlying_decimals,
                deposit_limit: self.deposit_limit,
                deposit_period_ends: config.deposit_period_ends,
                lock_period_ends: config.lock_period_ends,
            });

        Ok(())
    }
}

impl StrategyDataAccount for OrcaStrategy {
    fn save_changes(&self, writer: &mut dyn std::io::Write) -> Result<()> {
        self.try_to_vec().map_err(|_| ErrorCode::SerializationError.into()).and_then(|vec| {
            writer.write_all(&vec).map_err(|_| ErrorCode::SerializationError.into())
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

impl OrcaStrategy {
    fn verify_invest_tracker(
        &self,
        invest_tracker_account: &AccountInfo,
        asset_mint: Pubkey,
        strategy_key: Pubkey,
    ) -> Result<()> {
        let (expected_invest_tracker, _) = Pubkey::find_program_address(
            &[
                INVEST_TRACKER_SEED.as_bytes(),
                &asset_mint.to_bytes(),
                strategy_key.as_ref()
            ],
            &crate::ID
        );
        require!(expected_invest_tracker == invest_tracker_account.key(), ErrorCode::InvalidAccount);
        Ok(())
    }

    fn validate_weights(&self, remaining: &[AccountInfo], num_swaps: usize) -> Result<Vec<u16>> {
        let mut total_weight = 0u64;
        let mut weights = Vec::with_capacity(num_swaps);

        for i in 0..num_swaps {
            let invest_tracker_account = &remaining[i * ORCA_ACCOUNTS_PER_SWAP + ORCA_INVEST_TRACKER_OFFSET];
            let data = invest_tracker_account.try_borrow_data()?;
            let invest_tracker_data = InvestTracker::try_from_slice(&data[8..])?;
            
            weights.push(invest_tracker_data.assigned_weight);
            total_weight = total_weight
                .checked_add(invest_tracker_data.assigned_weight.into())
                .ok_or(OrcaStrategyErrorCode::MathError)?;
        }

        if total_weight != MAX_ASSIGNED_WEIGHT as u64 {
            return Err(OrcaStrategyErrorCode::InvalidTotalWeight.into());
        }

        Ok(weights)
    }

    fn execute_swap_operation(
        &mut self,
        swap_ctx: &SwapContext,
        amount: u64,
        direction: SwapDirection,
        use_amount_as_input: bool,
        sqrt_price_limit: u128,
        other_amount_threshold: u64,
        asset_mint: Pubkey,  // Added parameter
        is_a_to_b: bool,     // Added parameter
    ) -> Result<()> {
        // Verify invest tracker without borrowing data again
        self.verify_invest_tracker(
            &swap_ctx.invest_tracker_account,
            asset_mint,
            swap_ctx.strategy.key()
        )?;

        // Determine a_to_b and sqrt_price_limit based on direction and is_a_to_b
        let (a_to_b, final_sqrt_price_limit, final_amount_specified_is_input) = match direction {
            SwapDirection::Buy => {
                (is_a_to_b, NO_EXPLICIT_SQRT_PRICE_LIMIT, true)
            }
            SwapDirection::Sell => {
                let a_to_b = !is_a_to_b;
                let sqrt_limit = if !is_a_to_b { MIN_SQRT_PRICE_X64 } else { MAX_SQRT_PRICE_X64 };
                (a_to_b, sqrt_limit, false)
            }
        };

        // Perform swap with calculated parameters
        let seeds = &[&self.seeds()[..]];
        let (
            underlying_balance_before,
            underlying_balance_after,
            asset_balance_before,
            asset_balance_after,
        ) = swap_ctx.perform_swap(
            seeds,
            amount,
            direction,
            final_amount_specified_is_input,
            final_sqrt_price_limit,
            other_amount_threshold,
            self.underlying_token_acc,
            a_to_b,
        )?;

        // Update invest tracker after swap
        self.update_invest_tracker_after_swap(
            &swap_ctx.invest_tracker_account,
            underlying_balance_before,
            underlying_balance_after,
            asset_balance_before,
            asset_balance_after,
            direction == SwapDirection::Buy,
        )?;

        Ok(())
    }

    fn compute_sell_allocations(
        &self,
        remaining: &[AccountInfo],
        total_amount: u64,
        num_swaps: usize,
    ) -> Result<(Vec<u64>, usize)> {
        let mut total_weight = 0u64;
        let mut weights = Vec::with_capacity(num_swaps);
        let mut highest_weight_index = 0;

        // First pass: collect weights and find highest weight
        for i in 0..num_swaps {
            let invest_tracker_account = &remaining[i * ORCA_ACCOUNTS_PER_SWAP + ORCA_INVEST_TRACKER_OFFSET];
            let data = invest_tracker_account.try_borrow_data()?;
            let invest_tracker_data = InvestTracker::try_from_slice(&data[8..])?;
            
            weights.push(invest_tracker_data.current_weight);
            if invest_tracker_data.current_weight > weights[highest_weight_index] {
                highest_weight_index = i;
            }
            total_weight = total_weight
                .checked_add(invest_tracker_data.current_weight.into())
                .ok_or(OrcaStrategyErrorCode::MathError)?;
        }

        // Calculate amounts for each swap and track total
        let mut amounts = Vec::with_capacity(num_swaps);
        let mut total_allocated = 0u64;

        for i in 0..num_swaps {
            let amount_per_swap = if total_weight > 0 {
                (total_amount as u128)
                    .checked_mul(weights[i] as u128)
                    .ok_or(OrcaStrategyErrorCode::MathError)?
                    .checked_div(MAX_ASSIGNED_WEIGHT as u128)
                    .ok_or(OrcaStrategyErrorCode::MathError)? as u64
            } else {
                total_amount
                    .checked_div(num_swaps as u64)
                    .ok_or(OrcaStrategyErrorCode::MathError)?
            };
            
            total_allocated = total_allocated
                .checked_add(amount_per_swap)
                .ok_or(OrcaStrategyErrorCode::MathError)?;
            amounts.push(amount_per_swap);
        }

        // Handle any remainder by adding it to the highest weight swap
        if total_allocated < total_amount {
            let remainder = total_amount
                .checked_sub(total_allocated)
                .ok_or(OrcaStrategyErrorCode::MathError)?;
            amounts[highest_weight_index] = amounts[highest_weight_index]
                .checked_add(remainder)
                .ok_or(OrcaStrategyErrorCode::MathError)?;
        }

        Ok((amounts, highest_weight_index))
    }

    // Helper functions for rebalance
    fn collect_invest_tracker_data(
        &self,
        remaining: &[AccountInfo],
        num_swaps: usize,
    ) -> Result<(Vec<InvestTracker>, u128)> {
        let mut total_asset_value: u128 = 0;
        let mut invest_tracker_data_vec = Vec::with_capacity(num_swaps);

        for i in 0..num_swaps {
            let start = i * ORCA_ACCOUNTS_PER_SWAP;
            let invest_tracker_account = &remaining[start + ORCA_INVEST_TRACKER_OFFSET];

            let data = invest_tracker_account.try_borrow_data()?;
            let invest_tracker_data = InvestTracker::try_from_slice(&data[8..])?;

            total_asset_value = total_asset_value
                .checked_add(invest_tracker_data.asset_value)
                .ok_or(OrcaStrategyErrorCode::MathError)?;

            invest_tracker_data_vec.push(invest_tracker_data);
        }

        Ok((invest_tracker_data_vec, total_asset_value))
    }

    fn update_invest_tracker_after_swap(
        &mut self,
        invest_tracker_account: &AccountInfo,
        underlying_balance_before: u64,
        underlying_balance_after: u64,
        asset_balance_before: u64,
        asset_balance_after: u64,
        is_buying: bool,
    ) -> Result<()> {
        let mut data = invest_tracker_account.try_borrow_mut_data()?;
        let mut invest_tracker_data = InvestTracker::try_from_slice(&data[8..])?;
        
        // Initialize per-transaction realized profit/loss
        let mut realized_profit_in_this_tx: u64 = 0;
        let mut realized_loss_in_this_tx: u64 = 0;
    
        if is_buying {
            // Buying scenario:
            let new_asset_amount = asset_balance_after
                .checked_sub(asset_balance_before)
                .ok_or(OrcaStrategyErrorCode::MathError)?;
            invest_tracker_data.asset_amount = invest_tracker_data.asset_amount
                .checked_add(new_asset_amount)
                .ok_or(OrcaStrategyErrorCode::MathError)?;
    
            let underlying_spent = underlying_balance_before
                .checked_sub(underlying_balance_after)
                .ok_or(OrcaStrategyErrorCode::MathError)?;
            invest_tracker_data.amount_invested = invest_tracker_data.amount_invested
                .checked_add(underlying_spent)
                .ok_or(OrcaStrategyErrorCode::MathError)?;
    
            invest_tracker_data.effective_invested_amount = invest_tracker_data.effective_invested_amount
                .checked_add(underlying_spent)
                .ok_or(OrcaStrategyErrorCode::MathError)?;
    
            // Buying: no realized profit or loss
            realized_profit_in_this_tx = 0;
            realized_loss_in_this_tx = 0;
        } else {
            // Selling scenario:
            let asset_amount_before_sale = invest_tracker_data.asset_amount; // snapshot before reducing
            let asset_amount_sold = asset_balance_before
                .checked_sub(asset_balance_after)
                .ok_or(OrcaStrategyErrorCode::MathError)?;
    
            // Update asset_amount after the sale
            invest_tracker_data.asset_amount = invest_tracker_data.asset_amount
                .checked_sub(asset_amount_sold)
                .ok_or(OrcaStrategyErrorCode::MathError)?;
    
            let underlying_received = underlying_balance_after
                .checked_sub(underlying_balance_before)
                .ok_or(OrcaStrategyErrorCode::MathError)?;
            invest_tracker_data.amount_withdrawn = invest_tracker_data.amount_withdrawn
                .checked_add(underlying_received)
                .ok_or(OrcaStrategyErrorCode::MathError)?;
    
            if invest_tracker_data.effective_invested_amount == 0 {
                // If we have no remaining cost basis, all proceeds are scenario-based profit.
                realized_profit_in_this_tx = underlying_received;
                realized_loss_in_this_tx = 0;
    
                invest_tracker_data.scenario_realized_profit = invest_tracker_data.scenario_realized_profit
                    .checked_add(realized_profit_in_this_tx)
                    .ok_or(OrcaStrategyErrorCode::MathError)?;
            } else {
                // Normal cost basis calculation:
                // Check to avoid division by zero:
                if asset_amount_before_sale == 0 {
                    // Selling without having any asset_amount recorded
                    return Err(OrcaStrategyErrorCode::MathError.into());
                }
    
                // cost_basis_for_sale = (effective_invested_amount * asset_amount_sold) / asset_amount_before_sale
                let cost_basis_for_sale = (invest_tracker_data.effective_invested_amount as u128)
                    .checked_mul(asset_amount_sold as u128)
                    .ok_or(OrcaStrategyErrorCode::MathError)?
                    .checked_div(asset_amount_before_sale as u128)
                    .ok_or(OrcaStrategyErrorCode::MathError)? as u64;
    
                // Update effective_invested_amount after removing the cost basis for the sold portion
                invest_tracker_data.effective_invested_amount = invest_tracker_data.effective_invested_amount
                    .checked_sub(cost_basis_for_sale)
                    .ok_or(OrcaStrategyErrorCode::MathError)?;
    
                // Realized profit or loss = underlying_received - cost_basis_for_sale
                if underlying_received > cost_basis_for_sale {
                    realized_profit_in_this_tx = underlying_received
                        .checked_sub(cost_basis_for_sale)
                        .ok_or(OrcaStrategyErrorCode::MathError)?;
                    realized_loss_in_this_tx = 0;
    
                    // If effective_invested_amount is now zero after this sale, 
                    // the realized profit is scenario-based profit.
                    if invest_tracker_data.effective_invested_amount == 0 && realized_profit_in_this_tx > 0 {
                        invest_tracker_data.scenario_realized_profit = invest_tracker_data.scenario_realized_profit
                            .checked_add(realized_profit_in_this_tx)
                            .ok_or(OrcaStrategyErrorCode::MathError)?;
                    }
                } else if underlying_received < cost_basis_for_sale {
                    realized_loss_in_this_tx = cost_basis_for_sale
                        .checked_sub(underlying_received)
                        .ok_or(OrcaStrategyErrorCode::MathError)?;
                    realized_profit_in_this_tx = 0;
                } else {
                    // underlying_received == cost_basis_for_sale
                    realized_profit_in_this_tx = 0;
                    realized_loss_in_this_tx = 0;
                }
            }
        }
    
        // Accumulate transaction-based realized profit and loss
        if realized_profit_in_this_tx > 0 {
            invest_tracker_data.tx_realized_profit_accumulated = invest_tracker_data.tx_realized_profit_accumulated
                .checked_add(realized_profit_in_this_tx)
                .ok_or(OrcaStrategyErrorCode::MathError)?;
        }
    
        if realized_loss_in_this_tx > 0 {
            invest_tracker_data.tx_realized_loss_accumulated = invest_tracker_data.tx_realized_loss_accumulated
                .checked_add(realized_loss_in_this_tx)
                .ok_or(OrcaStrategyErrorCode::MathError)?;
        }
    
        // Recalculate unrealized profit/loss
        let effective_invested = invest_tracker_data.effective_invested_amount as u128;
        let asset_value = invest_tracker_data.asset_value;
    
        if asset_value > effective_invested {
            invest_tracker_data.unrealized_profit = (asset_value - effective_invested) as u64;
            invest_tracker_data.unrealized_loss = 0;
        } else {
            invest_tracker_data.unrealized_profit = 0;
            invest_tracker_data.unrealized_loss = (effective_invested - asset_value) as u64;
        }
    
        let serialized = invest_tracker_data.try_to_vec()?;
        data[8..].copy_from_slice(&serialized);
    
        // Emit event with both per-tx
        emit!(InvestTrackerSwapEvent {
            account_key: self.key(),
            invest_tracker_account_key: invest_tracker_account.key(),
            asset_mint: invest_tracker_data.asset_mint,
            asset_amount: invest_tracker_data.asset_amount,
            effective_invested_amount: invest_tracker_data.effective_invested_amount,
            scenario_realized_profit: invest_tracker_data.scenario_realized_profit,
            realized_profit_in_this_tx: realized_profit_in_this_tx,    // per tx profit
            realized_loss_in_this_tx: realized_loss_in_this_tx,        // per tx loss
            is_buy: is_buying,
            timestamp: Clock::get()?.unix_timestamp,
        });
    
        Ok(())
    }
}
