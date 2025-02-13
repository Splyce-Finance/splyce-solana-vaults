use anchor_lang::prelude::*;
use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::{Role, UserRole}
};

use anchor_spl::{
    token::Token,
    token_interface::{Mint, TokenAccount},
    metadata::{
        create_metadata_accounts_v3,
        mpl_token_metadata::types::DataV2,
        CreateMetadataAccountsV3, 
        Metadata,
    }
};

use crate::events::{TokenData, TokenMetaData,  VaultInitEvent};
use crate::constants::{
    VAULT_SEED, 
    SHARES_SEED, 
    SHARES_ACCOUNT_SEED, 
    CONFIG_SEED,
};
use crate::state::*;

#[derive(Accounts)]
pub struct InitVaultShares<'info> {
    #[account(
        mut, 
        seeds = [
            VAULT_SEED.as_bytes(), 
            config.next_vault_index.to_le_bytes().as_ref()
        ], 
        bump
    )]
    pub vault: AccountLoader<'info, Vault>,
    
    #[account(
        init, 
        seeds = [SHARES_SEED.as_bytes(), vault.key().as_ref()], 
        bump, 
        payer = signer, 
        mint::decimals = 9, 
        mint::authority = shares_mint,
    )]
    pub shares_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: We initialize this metadata account via the Metaplex Metadata Program, so we don't have to check it here
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    #[account(
        init, 
        seeds = [SHARES_ACCOUNT_SEED.as_bytes(), vault.key().as_ref()], 
        bump, 
        payer = signer, 
        token::mint = shares_mint,
        token::authority = vault,
    )]
    pub shares_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    
    #[account(
        seeds = [
            USER_ROLE_SEED.as_bytes(), 
            signer.key().as_ref(),
            Role::VaultsAdmin.to_seed().as_ref()
        ], 
        bump,
        seeds::program = access_control.key()
    )]
    pub roles: Account<'info, UserRole>,

    #[account(mut, constraint = roles.check_role()?)]
    pub signer: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED.as_bytes()], bump)]
    pub config: Box<Account<'info, Config>>,
    
    pub access_control: Program<'info, AccessControl>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub metadata_program: Program<'info, Metadata>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_init_vault_shares(ctx: Context<InitVaultShares>, _index: u64, config: Box<SharesConfig>) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let seeds = &[SHARES_SEED.as_bytes(), vault_key.as_ref(), &[ctx.bumps.shares_mint]];
    let signer = [&seeds[..]];

    let share_token_name = config.name.clone();
    let share_token_symbol = config.symbol.clone();

    let token_data: DataV2 = DataV2 {
        name: config.name,
        symbol: config.symbol,
        uri: config.uri,
        seller_fee_basis_points: 0,
        creators: None,
        collection: None,
        uses: None,
    };

    create_metadata_accounts_v3(
        CpiContext::new_with_signer(
            ctx.accounts.metadata_program.to_account_info(),
            CreateMetadataAccountsV3 {
                payer: ctx.accounts.signer.to_account_info(),
                update_authority: ctx.accounts.shares_mint.to_account_info(),
                mint: ctx.accounts.shares_mint.to_account_info(),
                metadata: ctx.accounts.metadata.to_account_info(),
                mint_authority: ctx.accounts.shares_mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &signer
        ),
        token_data,
        false,
        true,
        None,
    )?;

    let vault = &mut ctx.accounts.vault.load_mut()?;
    vault.shares_bump = [ctx.bumps.shares_mint];

    ctx.accounts.config.next_vault_index += 1;

    let underlying_token = TokenData{
        mint: vault.underlying_mint,
        account: vault.underlying_token_acc,
        decimals: vault.underlying_decimals,
        metadata: TokenMetaData {
            name: "".to_string(),
            symbol: "".to_string(),
        }
    };

    let share_token = TokenData{
        mint: ctx.accounts.shares_mint.key(),
        account: ctx.accounts.shares_token_account.key(),
        decimals: ctx.accounts.shares_mint.decimals,
        metadata: TokenMetaData {
            name: share_token_name,
            symbol: share_token_symbol,
        }
    };

    emit!(VaultInitEvent {
        vault_key,
        underlying_token,
        accountant: vault.accountant,
        share_token,
        deposit_limit: vault.deposit_limit,
        user_deposit_limit: vault.user_deposit_limit,
        min_user_deposit: vault.min_user_deposit,
        kyc_verified_only: vault.kyc_verified_only,
        direct_deposit_enabled: vault.direct_deposit_enabled,
        direct_withdraw_enabled: vault.direct_withdraw_enabled,
        minimum_total_idle: vault.minimum_total_idle,
        whitelisted_only: vault.whitelisted_only,
        profit_max_unlock_time: vault.profit_max_unlock_time,
    });

    Ok(())
}


