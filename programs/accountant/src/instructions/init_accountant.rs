use anchor_lang::prelude::*;
use anchor_lang::Discriminator;

use access_control::{
    constants::USER_ROLE_SEED,
    program::AccessControl,
    state::{Role, UserRole}
};

use crate::state::*;
use crate::constants::CONFIG_SEED;

#[derive(Accounts)]
#[instruction(accountant_type : AccountantType)]
pub struct InitAccountant<'info> {
    /// CHECK: We want to hadle all accountant types here
    #[account(
        init, 
        seeds = [
            config.next_accountant_index.to_le_bytes().as_ref()
        ], 
        bump,  
        payer = signer, 
        space = accountant_type.space(),
    )]
    pub accountant: UncheckedAccount<'info>,

    #[account(mut, seeds = [CONFIG_SEED.as_bytes()], bump)]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [
            USER_ROLE_SEED.as_bytes(), 
            signer.key().as_ref(),
            Role::AccountantAdmin.to_seed().as_ref()
        ], 
        bump,
        seeds::program = access_control.key()
    )]
    pub roles: Account<'info, UserRole>,

    #[account(mut, constraint = roles.check_role()?)]
    pub signer: Signer<'info>,


    pub access_control: Program<'info, AccessControl>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_init_accountant(ctx: Context<InitAccountant>, accountant_type: AccountantType) -> Result<()> {
    match accountant_type {
        AccountantType::Generic => {
            return init_accountant_internal::<GenericAccountant>(ctx)
        }
        // _ => {
        //     return Err(ErrorCode::InvalidData.into())
        // }
    }
}

fn init_accountant_internal<T>(ctx: Context<InitAccountant>) -> Result<()> 
where 
    T: Accountant + AnchorDeserialize + AnchorSerialize + Discriminator + Default
{
    let accountant_info = ctx.accounts.accountant.to_account_info();

    let mut accountant = T::default();
    let mut data = accountant_info.data.borrow_mut();

    // we need to set the discriminator to the first 8 bytes of the account data
    data[..8].copy_from_slice(&T::discriminator());

    accountant.init(ctx.accounts.config.next_accountant_index, ctx.bumps.accountant)?;
    ctx.accounts.config.next_accountant_index += 1;

    // Serialize the accountant data into the account
    accountant.save_changes(&mut &mut data[8..])
}
