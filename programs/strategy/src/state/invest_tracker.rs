use anchor_lang::prelude::*;

#[account]
#[derive(Default, Debug, InitSpace)]
pub struct InvestTracker {
    pub whirlpool_id: Pubkey,
    pub asset_mint: Pubkey,
    pub amount_invested: u64,
    pub amount_withdrawn: u64,
    pub asset_amount: u64,
    pub asset_price: u128,
    pub sqrt_price: u128,
    pub asset_value: u128,
    pub asset_decimals: u8,
    pub underlying_decimals: u8,
    pub a_to_b_for_purchase: bool,
    pub assigned_weight: u16,
    pub current_weight: u16,
    pub effective_invested_amount: u64, // How much of my principal is still “in the game” (effective_invested_amount)?
    pub scenario_realized_profit: u64, // Records how much is made after effective_invested_amount hits 0.(cost basis approach with effective_invested_amount)
    pub unrealized_profit: u64, // shows how much of unrealized profit is there in current position
    pub unrealized_loss: u64, // shows how much of unrealized loss is there in current position
    pub tx_realized_profit_accumulated: u64, // shows how much is made in tx so far 
    pub tx_realized_loss_accumulated: u64, // shows how much is made in tx so far 
}