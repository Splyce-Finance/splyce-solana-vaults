use anchor_lang::prelude::*;
use anchor_spl::{
    token::{self, MintTo, Burn},
    token_2022,
    token_interface::Mint,
};

pub fn get_athority<'a>(
    token_program: AccountInfo<'a>
) -> Result<Pubkey> {
    token::accessor::authority(&token_program)
}

pub fn transfer_with_signer<'a>(
    token_program: AccountInfo<'a>,
    from: AccountInfo<'a>,
    to: AccountInfo<'a>,
    authority: AccountInfo<'a>,
    mint: &InterfaceAccount<'a, Mint>,
    amount: u64,
    seeds: &[&[u8]],
) -> Result<()> {
    if token_program.key() == token_2022::ID {
        return token_2022::transfer_checked(
            CpiContext::new_with_signer(
                token_program,
                token_2022::TransferChecked {
                    from,
                    to,
                    mint: mint.to_account_info(),
                    authority,
                },
                &[&seeds]
            ),
            amount,
            mint.decimals
        )
    } else {
        token::transfer(
            CpiContext::new_with_signer(
                token_program,
                token::Transfer {
                    from,
                    to,
                    authority,
                },
                &[&seeds]
            ),
            amount,
        )
    }
}

pub fn transfer<'a>(
    token_program: AccountInfo<'a>,
    from: AccountInfo<'a>,
    to: AccountInfo<'a>,
    authority: AccountInfo<'a>,
    mint: &InterfaceAccount<'a, Mint>,
    amount: u64,
) -> Result<()> {   
    if token_program.key() == token_2022::ID {
        return token_2022::transfer_checked(
            CpiContext::new(
                token_program,
                token_2022::TransferChecked {
                    from,
                    to,
                    mint: mint.to_account_info(),
                    authority,
                }
            ),
            amount,
            mint.decimals
        )
    } else {
        token::transfer(
            CpiContext::new(
                token_program,
                token::Transfer {
                    from,
                    to,
                    authority,
                }
            ),
            amount,
        )
    }
}

pub fn mint_to<'a>(
    token_program: AccountInfo<'a>,
    mint: AccountInfo<'a>,
    to: AccountInfo<'a>,
    authority: AccountInfo<'a>,
    amount: u64,
    seeds: &[&[u8]],
) -> Result<()> {
    token::mint_to(
        CpiContext::new_with_signer(
            token_program,
            MintTo {
                mint,
                to,
                authority,
            },
            &[&seeds]
        ),
        amount,
    )
}

pub fn burn<'a>(
    token_program: AccountInfo<'a>,
    mint: AccountInfo<'a>,
    from: AccountInfo<'a>,
    authority: AccountInfo<'a>,
    amount: u64
) -> Result<()> {
    token::burn(
        CpiContext::new(
            token_program,
            Burn {
                mint,
                from,
                authority
            }
        ), 
        amount
    )
}

pub fn burn_with_signer<'a>(
    token_program: AccountInfo<'a>,
    mint: AccountInfo<'a>,
    from: AccountInfo<'a>,
    authority: AccountInfo<'a>,
    amount: u64,
    seeds: &[&[u8]],
) -> Result<()> {
    token::burn(
        CpiContext::new_with_signer(
            token_program,
            Burn {
                mint,
                from,
                authority
            },
            &[&seeds]
        ), 
        amount
    )
}

