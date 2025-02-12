use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use super::*;
use crate::constants::FEE_BPS;
use crate::instructions::{Report, ReportProfit, ReportLoss, DeployFunds, FreeFunds, HarvestAndReport};

pub trait StrategyDataAccount {
    fn save_changes(&self, writer: &mut dyn std::io::Write) -> Result<()>;
    fn seeds(&self) -> [&[u8]; 3];
    fn key(&self) -> Pubkey {
        let seeds = self.seeds();
        Pubkey::create_program_address(&seeds, &crate::id()).unwrap()
    }
}

pub trait StrategyInit {
    fn init(
        &mut self, 
        bump: u8,
        index: u64,
        vault: Pubkey, 
        underlying_mint: &InterfaceAccount<Mint>, 
        underlying_token_acc: Pubkey, 
        config_bytes: Vec<u8>
    ) -> Result<()>;
}

pub trait StrategyManagement {
    fn manager(&self) -> Pubkey;
    fn set_manager(&mut self, manager: Pubkey) -> Result<()>;
}

pub trait StrategyGetters {
    fn fee_data(&mut self) -> &mut FeeData;
    fn strategy_type(&self) -> StrategyType;
    fn vault(&self) -> Pubkey;
    /// Returns the total funds in the strategy, this value is affected by gains and losses
    fn total_assets(&self) -> u64;
    fn available_deposit(&self) -> u64;
    fn available_withdraw(&self) -> u64;
    fn token_account(&self) -> Pubkey;
    fn underlying_mint(&self) -> Pubkey;
    fn total_invested(&self) -> u64;
}

pub trait Strategy: 
    StrategyDataAccount + 
    StrategyInit + 
    StrategyManagement + 
    StrategyGetters 
{   
    // setters 
    fn deposit(&mut self, amount: u64) -> Result<()>;
    fn withdraw(&mut self, amount: u64) -> Result<()>;
    fn withdraw_fees(&mut self, amount: u64) -> Result<()>;
    fn harvest_and_report<'info>(&mut self, accounts: &HarvestAndReport<'info>, remaining: &[AccountInfo<'info>]) -> Result<u64>;
    fn deploy_funds<'info>(&mut self, accounts: &DeployFunds<'info>, remaining: &[AccountInfo<'info>], amount: u64) -> Result<()>;
    fn free_funds<'info>(&mut self, accounts: &FreeFunds<'info>, remaining: &[AccountInfo<'info>], amount: u64) -> Result<()>;
    fn set_total_assets(&mut self, total_assets: u64);

    fn report_profit<'info>(&mut self, accounts: &ReportProfit<'info>, remaining: &[AccountInfo<'info>], profit: u64) -> Result<()>;
    fn report_loss<'info>(&mut self, accounts: &ReportLoss<'info>, remaining: &[AccountInfo<'info>], loss: u64) -> Result<()>;
    fn report<'info>(&mut self, accounts: &Report<'info>, remaining: &[AccountInfo<'info>]) -> Result<()> {
        let old_total_assets = self.total_assets();

        let harvest_ctx = HarvestAndReport {
            strategy: accounts.strategy.clone(),
            underlying_token_account: accounts.underlying_token_account.clone(),
            underlying_mint: accounts.underlying_mint.clone(),
            signer: accounts.signer.clone(),
            token_program: accounts.token_program.clone(),
        };
    
        let mut new_total_assets = self.harvest_and_report(&harvest_ctx, remaining)?;
    
        if new_total_assets > old_total_assets {
            let profit = new_total_assets - old_total_assets;
            let fee_data = self.fee_data();
    
            if fee_data.performance_fee > 0 {
                let fees = (profit * fee_data.performance_fee) / FEE_BPS;
                fee_data.fee_balance += fees;
                new_total_assets -= fees;
            }
        }
    
        self.set_total_assets(new_total_assets);
        Ok(())
    }
}
