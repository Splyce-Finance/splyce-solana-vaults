use anchor_lang::prelude::*;
use anchor_spl::{token, token_2022, token_interface::Mint};

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

pub fn get_balance(token_account: &AccountInfo) -> Result<u64> {
    let amount = token::accessor::amount(token_account)?;
    Ok(amount)
}