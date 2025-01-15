use anchor_lang::prelude::*;
use whirlpool_cpi;

use crate::error::ErrorCode;
use crate::utils::get_token_balance;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SwapDirection {
    Buy,   // underlying → asset
    Sell,  // asset → underlying
}

pub struct SwapContext<'info> {
    pub whirlpool_program: AccountInfo<'info>,
    pub whirlpool: AccountInfo<'info>,
    pub token_owner_account_a: AccountInfo<'info>,
    pub token_vault_a: AccountInfo<'info>,
    pub token_owner_account_b: AccountInfo<'info>,
    pub token_vault_b: AccountInfo<'info>,
    pub tick_array_0: AccountInfo<'info>,
    pub tick_array_1: AccountInfo<'info>,
    pub tick_array_2: AccountInfo<'info>,
    pub oracle: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    pub strategy: AccountInfo<'info>,
}

// The original orca_swap_handler function
pub fn orca_swap_handler<'a>(
    whirlpool_program: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    token_authority: &AccountInfo<'a>,
    whirlpool: &AccountInfo<'a>,
    token_owner_account_a: &AccountInfo<'a>,
    token_vault_a: &AccountInfo<'a>,
    token_owner_account_b: &AccountInfo<'a>,
    token_vault_b: &AccountInfo<'a>,
    tick_array_0: &AccountInfo<'a>,
    tick_array_1: &AccountInfo<'a>,
    tick_array_2: &AccountInfo<'a>,
    oracle: &AccountInfo<'a>,
    seeds: &[&[&[u8]]],  // For PDA signing
    amount: u64,
    other_amount_threshold: u64,
    sqrt_price_limit: u128,
    amount_specified_is_input: bool,
    a_to_b: bool,
) -> Result<()> {
    // Create the CPI accounts struct
    let cpi_accounts = whirlpool_cpi::cpi::accounts::Swap {
        whirlpool: whirlpool.clone(),
        token_program: token_program.clone(),
        token_authority: token_authority.clone(),
        token_owner_account_a: token_owner_account_a.clone(),
        token_vault_a: token_vault_a.clone(),
        token_owner_account_b: token_owner_account_b.clone(),
        token_vault_b: token_vault_b.clone(),
        tick_array_0: tick_array_0.clone(),
        tick_array_1: tick_array_1.clone(),
        tick_array_2: tick_array_2.clone(),
        oracle: oracle.clone(),
    };

    // Create CPI context with signer seeds
    let cpi_ctx = CpiContext::new_with_signer(
        whirlpool_program.clone(),
        cpi_accounts,
        seeds,
    );

    // Execute the swap CPI
    msg!("CPI: whirlpool swap instruction");
    whirlpool_cpi::cpi::swap(
        cpi_ctx,
        amount,
        other_amount_threshold,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
    )?;

    Ok(())
}

impl<'info> SwapContext<'info> {
    pub fn perform_swap(
        &self,
        strategy_seeds: &[&[&[u8]]],
        amount: u64,
        direction: SwapDirection,
        use_amount_as_input: bool,
        sqrt_price_limit: u128,
        other_amount_threshold: u64,
        underlying_token_acc: Pubkey,
        a_to_b: bool,
    ) -> Result<(u64, u64, u64, u64)> {
        // Determine underlying vs asset accounts directly using a_to_b and direction
        let (underlying_account, asset_account) = if a_to_b {
            (&self.token_owner_account_a, &self.token_owner_account_b)
        } else {
            (&self.token_owner_account_b, &self.token_owner_account_a)
        };

        // Validate underlying account
        require!(
            underlying_account.key() == underlying_token_acc,
            ErrorCode::InvalidAccount
        );

        // Get pre-swap balances
        let underlying_balance_before = get_token_balance(underlying_account)?;
        let asset_balance_before = get_token_balance(asset_account)?;

        // Execute swap
        orca_swap_handler(
            &self.whirlpool_program,
            &self.token_program,
            &self.strategy,
            &self.whirlpool,
            &self.token_owner_account_a,
            &self.token_vault_a,
            &self.token_owner_account_b,
            &self.token_vault_b,
            &self.tick_array_0,
            &self.tick_array_1,
            &self.tick_array_2,
            &self.oracle,
            strategy_seeds,
            amount,
            other_amount_threshold,
            sqrt_price_limit,
            use_amount_as_input,
            match direction {
                SwapDirection::Buy => a_to_b,
                SwapDirection::Sell => !a_to_b,
            },
        )?;

        // Get post-swap balances
        let underlying_balance_after = get_token_balance(underlying_account)?;
        let asset_balance_after = get_token_balance(asset_account)?;

        Ok((
            underlying_balance_before,
            underlying_balance_after,
            asset_balance_before,
            asset_balance_after,
        ))
    }
}
