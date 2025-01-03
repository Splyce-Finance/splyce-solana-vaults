use anchor_lang::prelude::*;
use anchor_spl::{
    token::{ Token },
};
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::{UserRole, Role}
};

use crate::constants::{MAX_ASSIGNED_WEIGHT, ASSET_VALUE_DISCOUNT_BPS, FEE_BPS};
use crate::state::invest_tracker::*;
use crate::state::whirlpool::*;
use crate::error::ErrorCode;
use crate::utils::orca_utils::{compute_asset_value, get_price_in_underlying_decimals};
use crate::events::InvestTrackerUpdateEvent;
use crate::utils::unchecked_strategy::UncheckedStrategy;

//This instruction initializes an invest tracker for the strategy
#[derive(Accounts)]
#[instruction()]
pub struct UpdateInvestTrackers<'info> {
    /// CHECK: can be any strategy
    #[account(mut)]
    pub strategy: UncheckedAccount<'info>,

    #[account(
        seeds = [
            USER_ROLE_SEED.as_bytes(), 
            signer.key().as_ref(),
            Role::StrategiesManager.to_seed().as_ref()
        ], 
        bump,
        seeds::program = access_control.key()
    )]
    pub roles: Account<'info, UserRole>,

    #[account(mut, constraint = roles.check_role()?)]
    pub signer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub access_control: Program<'info, AccessControl>,
}

pub fn handle_update_invest_trackers(ctx: Context<UpdateInvestTrackers>) -> Result<()> {
    let mut strategy = ctx.accounts.strategy.from_unchecked()?;

    msg!("Updating invest trackers");
    //so there would be a pair of accounts for each invest tracker
    //remaining accounts[0] = invest_tracker
    //remaining accounts[1] = whirlpool
    //need to loop thorugh the remaining accounts by pairs

    //require that the sum of all assigned weights is 100%

    let remaining_accounts = &ctx.remaining_accounts;
    require!(remaining_accounts.len() % 2 == 0, ErrorCode::InvalidAccount);

    let mut total_weight: u16 = 0;
    let mut total_asset_value: u128 = 0;

    // First pass - update prices and asset values, calculate total weight and total asset value
    for chunk in remaining_accounts.chunks(2) {
        let invest_tracker_info = &chunk[0];
        let whirlpool_info = &chunk[1];

        // Verify the invest tracker account is writable
        if !invest_tracker_info.is_writable {
            return Err(ProgramError::InvalidAccountData.into());
        }

        // Get account data
        let mut account_data = invest_tracker_info.try_borrow_mut_data()?;
        let whirlpool_data = whirlpool_info.try_borrow_data()?;

        // First read the current data
        let mut current_data = InvestTracker::try_from_slice(&account_data[8..])?;
        let whirlpool = Whirlpool::try_from_slice(&whirlpool_data[8..])?;

        // Verify whirlpool matches tracker
        require!(
            current_data.whirlpool_id == whirlpool_info.key(),
            ErrorCode::InvalidAccount
        );

        // Update sqrt_price
        current_data.sqrt_price = whirlpool.sqrt_price;

        // Calculate and update asset price using get_price_from_sqrt_price
        // If a_to_b_for_purchase is false, underlying_decimals should be b_decimals
        let (a_decimals, b_decimals) = if current_data.a_to_b_for_purchase {
            (current_data.underlying_decimals, current_data.asset_decimals)
        } else {
            (current_data.asset_decimals, current_data.underlying_decimals)
        };

        current_data.asset_price = get_price_in_underlying_decimals(
            whirlpool.sqrt_price,
            current_data.a_to_b_for_purchase,
            a_decimals,
            b_decimals,
        );

        // Calculate full asset value first
        let full_asset_value = compute_asset_value(
            current_data.asset_amount,
            current_data.asset_price,
            current_data.asset_decimals
        );

        // Apply discount more efficiently: value * (10000 - 30) / 10000
        current_data.asset_value = full_asset_value
            .checked_mul((FEE_BPS - ASSET_VALUE_DISCOUNT_BPS as u64) as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(FEE_BPS as u128)
            .ok_or(ErrorCode::MathOverflow)?;

        // Calculate unrealized profit/loss
        let effective_invested = current_data.effective_invested_amount as u128;
        let asset_value = current_data.asset_value;

        if asset_value > effective_invested {
            current_data.unrealized_profit = (asset_value - effective_invested) as u64;
            current_data.unrealized_loss = 0;
        } else {
            current_data.unrealized_profit = 0;
            current_data.unrealized_loss = (effective_invested - asset_value) as u64;
        }

        // Add to totals
        total_weight += current_data.assigned_weight as u16;
        total_asset_value = total_asset_value
            .checked_add(current_data.asset_value)
            .ok_or(ErrorCode::MathOverflow)?;

        // Emit the update event
        emit!(InvestTrackerUpdateEvent {
            account_key: strategy.key(),
            invest_tracker_account_key: invest_tracker_info.key(),
            whirlpool_id: current_data.whirlpool_id,
            asset_mint: current_data.asset_mint,
            amount_invested: current_data.amount_invested,
            amount_withdrawn: current_data.amount_withdrawn,
            asset_amount: current_data.asset_amount,
            asset_price: current_data.asset_price as u64,
            sqrt_price: current_data.sqrt_price as u64,
            asset_value: current_data.asset_value as u64,
            asset_decimals: current_data.asset_decimals as u32, 
            underlying_decimals: current_data.underlying_decimals as u32,
            a_to_b_for_purchase: current_data.a_to_b_for_purchase,
            assigned_weight: current_data.assigned_weight as u32,
            current_weight: current_data.current_weight as u32,
            effective_invested_amount: current_data.effective_invested_amount as u64,
            scenario_realized_profit: current_data.scenario_realized_profit as u64,
            unrealized_profit: current_data.unrealized_profit as u64,
            unrealized_loss: current_data.unrealized_loss as u64,
            tx_realized_profit_accumulated: current_data.tx_realized_profit_accumulated as u64,
            tx_realized_loss_accumulated: current_data.tx_realized_loss_accumulated as u64,
            timestamp: Clock::get()?.unix_timestamp,
        });
      
        // Serialize the updated data
        let serialized = current_data.try_to_vec()?;

        // Write the updated data
        account_data[8..].copy_from_slice(&serialized);
    }

    // Verify total weight is 100%
    require!(total_weight == MAX_ASSIGNED_WEIGHT as u16, ErrorCode::InvalidTrackerSetup);

    // Second pass - calculate and update current weights
    if total_asset_value > 0 {
        let mut total_current_weight: u16 = 0;

        for chunk in remaining_accounts.chunks(2) {
            let invest_tracker_info = &chunk[0];
            let mut account_data = invest_tracker_info.try_borrow_mut_data()?;
            let mut current_data = InvestTracker::try_from_slice(&account_data[8..])?;

            // Calculate current weight as percentage (base 10000)
            current_data.current_weight = ((current_data.asset_value as u128)
                .checked_mul(MAX_ASSIGNED_WEIGHT as u128)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(total_asset_value as u128)
                .ok_or(ErrorCode::MathOverflow)?) as u16;

            total_current_weight = total_current_weight.checked_add(current_data.current_weight)
                .ok_or(ErrorCode::MathOverflow)?;

            // Serialize and write back
            let serialized = current_data.try_to_vec()?;
            account_data[8..].copy_from_slice(&serialized);
        }

        // Verify total current weight does not exceed MAX_ASSIGNED_WEIGHT
        require!(total_current_weight <= MAX_ASSIGNED_WEIGHT as u16, ErrorCode::InvalidTrackerSetup);
    }

    strategy.save_changes(&mut &mut ctx.accounts.strategy.try_borrow_mut_data()?[8..])?;
    Ok(())
}