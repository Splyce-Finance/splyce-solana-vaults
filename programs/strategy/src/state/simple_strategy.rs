use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use super::base_strategy::*;
use super::StrategyType;
use super::fee_data::*;

use crate::error::ErrorCode;
use crate::events::{StrategyDepositEvent, StrategyInitEvent, StrategyWithdrawEvent};
use crate::utils::token;
use crate::instructions::{ReportProfit, ReportLoss, DeployFunds, FreeFunds};

#[account()]
#[derive(Default, Debug, InitSpace)]
pub struct SimpleStrategy {
    /// Bump to identify PDA
    pub bump: [u8; 1],
    pub index_bytes: [u8; 8],

    /// vault
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub underlying_mint: Pubkey,
    pub underlying_token_acc: Pubkey,

    // this value mast be u64 because of the borsh serialization
    pub underlying_decimals: u8,
    pub total_assets: u64,
    pub deposit_limit: u64,

    pub total_invested: u64,

    pub fee_data: FeeData,
}

#[derive(AnchorSerialize, AnchorDeserialize, Default, Clone, Debug)]
pub struct SimpleStrategyConfig {
    pub deposit_limit: u64,
    pub performance_fee: u64,
    pub fee_manager: Pubkey,
}

impl StrategyManagement for SimpleStrategy {
    fn manager(&self) -> Pubkey {
        self.manager
    }

    fn set_manager(&mut self, manager: Pubkey) -> Result<()> {
        self.manager = manager;
        Ok(())
    }
}

impl StrategyGetters for SimpleStrategy {
    fn strategy_type(&self) -> StrategyType {
        StrategyType::Simple
    }

    fn vault(&self) -> Pubkey {
        self.vault
    }

    fn total_assets(&self) -> u64 {
        self.total_assets
    }

    fn total_invested(&self) -> u64 {
        0
    }

    fn available_deposit(&self) -> u64 {
        self.deposit_limit - self.total_assets
    }

    fn available_withdraw(&self) -> u64 {
        self.total_assets - self.total_invested
    }

    fn token_account(&self) -> Pubkey {
        self.underlying_token_acc
    }

    fn underlying_mint(&self) -> Pubkey {
        self.underlying_mint
    }

    fn fee_data(&mut self) -> &mut FeeData {
        &mut self.fee_data
    }
}

impl Strategy for SimpleStrategy {
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

    fn report_profit<'info>(&mut self, accounts: &ReportProfit<'info>, remaining: &[AccountInfo<'info>], profit: u64) -> Result<()> {
        if token::get_balance(&remaining[0].to_account_info())? < profit {
            return Err(ErrorCode::InsufficientFunds.into());
        }

        token::transfer(
            accounts.token_program.to_account_info(),
            remaining[0].to_account_info(),
            accounts.underlying_token_account.to_account_info(),
            accounts.signer.to_account_info(),
            &accounts.underlying_mint,
            profit,
        )?;

        let underlying_token_account = &mut accounts.underlying_token_account.clone();
        underlying_token_account.reload()?;

        let dto = HarvestReportDTO {
            strategy: accounts.strategy.clone(),
            underlying_token_account: underlying_token_account.clone(),
            underlying_mint: accounts.underlying_mint.clone(),
            signer: accounts.signer.clone(),
            token_program: accounts.token_program.clone(),
        };

        self.update_total_assets(&dto, remaining)?;

        Ok(())
    }

    /// remaining[0] - manager token account
    fn report_loss<'info>(&mut self, accounts: &ReportLoss<'info>, remaining: &[AccountInfo<'info>], loss: u64) -> Result<()> {
        if  accounts.underlying_token_account.amount < loss {
            return Err(ErrorCode::InsufficientFunds.into());
        }

        token::transfer_with_signer(
            accounts.token_program.to_account_info(),
            accounts.underlying_token_account.to_account_info(),
            remaining[0].to_account_info(),
            accounts.strategy.to_account_info(),
            &accounts.underlying_mint,
            loss,
            &self.seeds(),
        )?;

        let underlying_token_account = &mut accounts.underlying_token_account.clone();
        underlying_token_account.reload()?;

        let dto = HarvestReportDTO {
            strategy: accounts.strategy.clone(),
            underlying_token_account: underlying_token_account.clone(),
            underlying_mint: accounts.underlying_mint.clone(),
            signer: accounts.signer.clone(),
            token_program: accounts.token_program.clone(),
        };

        self.update_total_assets(&dto, remaining)?;

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

    fn withdraw_fees(&mut self, amount: u64) -> Result<()> {
        self.fee_data.fee_balance -= amount;
        Ok(())
    }

    fn harvest_and_report<'info>(&mut self, dto: &HarvestReportDTO<'info>, _remaining: &[AccountInfo<'info>]) -> Result<u64> {
        if dto.underlying_token_account.key() != self.underlying_token_acc {
            return Err(ErrorCode::InvalidAccount.into());
        }
        let idle_assets = dto.underlying_token_account.amount;
        Ok(idle_assets + self.total_invested)
    }

    fn deploy_funds<'info>(&mut self, accounts: &DeployFunds<'info>, remaining: &[AccountInfo<'info>], amount: u64) -> Result<()> {
        self.total_invested += amount;

        let seeds = self.seeds();
        token::transfer_with_signer(
            accounts.token_program.to_account_info(),
            accounts.underlying_token_account.to_account_info(),
            remaining[0].to_account_info(),
            accounts.strategy.to_account_info(),
            &accounts.underlying_mint,
            amount,
            &seeds
        )?;

        Ok(())
    }

    fn free_funds<'info>(&mut self, accounts: &FreeFunds<'info>, remaining: &[AccountInfo<'info>], amount: u64) -> Result<()> {
        if self.total_invested < amount {
            return Err(ErrorCode::InsufficientFunds.into());
        }

        self.total_invested -= amount;

        token::transfer(
            accounts.token_program.to_account_info(),
            remaining[0].to_account_info(),
            accounts.underlying_token_account.to_account_info(),
            accounts.signer.to_account_info(),
            &accounts.underlying_mint,
            amount,
        )
    }

    fn set_total_assets(&mut self, total_assets: u64) {
        self.total_assets = total_assets;
    }
}

impl StrategyInit for SimpleStrategy {
    fn init(
        &mut self,
        bump: u8,
        index: u64,
        vault: Pubkey, 
        underlying_mint: &InterfaceAccount<Mint>, 
        underlying_token_acc: Pubkey, 
        config_bytes: Vec<u8>
    ) -> Result<()> {
        let config = SimpleStrategyConfig::try_from_slice(&config_bytes)
        .map_err(|_| ErrorCode::InvalidStrategyConfig)?;

        self.bump = [bump]; 
        self.index_bytes = index.to_le_bytes();
        self.vault = vault;
        self.underlying_mint = underlying_mint.key();
        self.underlying_decimals = underlying_mint.decimals;
        self.underlying_token_acc = underlying_token_acc;
        self.deposit_limit = config.deposit_limit;
        self.total_assets = 0;

        self.fee_data = FeeData {
            fee_manager: config.fee_manager,
            performance_fee: config.performance_fee,
            fee_balance: 0,
        };

        emit!(
            StrategyInitEvent 
            {
                account_key: self.key(),
                strategy_type: String::from("simple"),
                vault: self.vault,
                underlying_mint: self.underlying_mint,
                underlying_token_acc: self.underlying_token_acc,
                underlying_decimals: self.underlying_decimals,
                deposit_limit: self.deposit_limit,
                deposit_period_ends: 0,
                lock_period_ends: 0,
            });
        Ok(())
    }
}

impl StrategyDataAccount for SimpleStrategy {
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
