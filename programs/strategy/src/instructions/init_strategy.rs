use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::{UserRole, Role}
};

use crate::constants::{CONFIG_SEED, UNDERLYING_SEED};
use crate::state::*;
use crate::error::ErrorCode;

#[derive(Accounts)]
#[instruction(strategy_type: StrategyType)]
pub struct InitStrategy<'info> {
    /// CHECK: We want to hadle all strategy types here
    #[account(
        init, 
        seeds = [
            vault.key().as_ref(),
            config.next_strategy_index.to_le_bytes().as_ref()
        ], 
        bump,  
        payer = signer, 
        space = strategy_type.space(),
    )]
    pub strategy: UncheckedAccount<'info>,
    #[account(
        init, 
        seeds = [
            UNDERLYING_SEED.as_bytes(),
            strategy.key().as_ref(),
        ], 
        bump, 
        payer = signer, 
        token::mint = underlying_mint, 
        token::authority = strategy,
    )]
    pub token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, seeds = [CONFIG_SEED.as_bytes()], bump)]
    pub config: Account<'info, Config>,

    /// CHECK: This should be a vault account
    #[account()]
    pub vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,

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

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub access_control: Program<'info, AccessControl>,
}

pub fn handle_init_strategy(ctx: Context<InitStrategy>, strategy_type: StrategyType, config: Vec<u8>) -> Result<()> {
    match strategy_type {
        StrategyType::Simple => {
            return init_strategy_internal::<SimpleStrategy>(ctx, config)
        }
        StrategyType::TradeFintech => {
            return init_strategy_internal::<TradeFintechStrategy>(ctx, config)
        }
        StrategyType::Orca => {
            return init_strategy_internal::<OrcaStrategy>(ctx, config)
        }
        _ => {
            return Err(ErrorCode::InvalidStrategyData.into())
        }
    }
}

fn init_strategy_internal<T>(ctx: Context<InitStrategy>, config: Vec<u8>) -> Result<()> 
where 
    T: Strategy + AnchorDeserialize + AnchorSerialize + Discriminator + Default
{
    let strategy_acc = &mut ctx.accounts.strategy;
    let strategy_info = strategy_acc.to_account_info();

    let mut strategy = T::default();
    let mut data = strategy_info.data.borrow_mut();
    // we need to set the discriminator to the first 8 bytes of the account data
    data[..8].copy_from_slice(&T::discriminator());

    strategy.init(
        ctx.bumps.strategy,
        ctx.accounts.config.next_strategy_index,
        ctx.accounts.vault.key(),
        ctx.accounts.underlying_mint.as_ref(),
        ctx.accounts.token_account.key(),
        config,
    )?;
    strategy.set_manager(ctx.accounts.signer.key())?;

    // Serialize the strategy data into the account
    strategy.save_changes(&mut &mut data[8..])?;

    ctx.accounts.config.next_strategy_index += 1;

    Ok(())
}
