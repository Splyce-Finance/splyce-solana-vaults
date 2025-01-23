# Solana Project Setup Guide

This guide outlines the steps required to initialize, build, deploy, and set up a Solana-based project using the Anchor framework. Follow these steps carefully to ensure that everything is configured properly.

## Prerequisites

Ensure you have the following installed and configured:
- **Solana CLI** (Ensure it's up to date)
- **Anchor CLI** (Install via `cargo install --git https://github.com/project-serum/anchor --tag v0.24.2 anchor-cli`)
- **Node.js** and **npm** (for JavaScript/TypeScript-related tasks)
- **Rust** toolchain (for building the Solana programs)

---

## Initialization Steps

### Step 1: Airdrop SOL to Your Wallet

To ensure that you have sufficient SOL balance for transaction fees, run the provided script to airdrop SOL into your wallet.

```bash
./airdrop-sol.sh
```

Ensure that your wallet receives the required SOL by confirming your balance:

`solana balance`

**Step 2: Build the Anchor Program**

Build the Solana program using Anchor:

`sudo anchor build`

This step compiles the smart contracts and prepares them for deployment.


**Step 3: Deploy the Anchor Program**

Deploy the compiled program to the Solana testnet or mainnet:

`sudo anchor deploy`

 

**Step 4: Initilize Porgrams**

Run the predefined anchor run initialize script to initilize your program:

`sudo anchor run initialize`

**Step 5: Set Roles**

Run the predefined set_roles script to configure roles in your program:

`sudo anchor run set_roles`

**Step 6: Mint the Underlying Token**

Initialize the minting process for the underlying token by running:

`sudo anchor run underlying_mint`

**Step 6.1: Capture the Mint Public Key**

After running the above command, capture the Underlying Token Mint Public Key from the output (e.g., "CWduyZkkj34f5YntKwD7NjkHaRt7kfiScopgEqu9RR6W"). You will use this public key in later steps.

----------------------------------------------------------------------------------------

****Vault Initialization****

**Step 7: Update the create_default_vault_with_strategy.ts File**

Edit the file create_default_vault_with_strategy.ts:
    Replace the underlying_mint on line 29 with the public key you captured in Step 5.1.
    ~~Set the index to 0 in the same file.~~

**Step 7.1: Initialize the Vault**

Run the initialization script for the default vault:
`sudo anchor run init_vault`

~~ ** Step 8: Update the Index in the Script ** ~~

~~Go back to the create_default_vault_with_strategy.ts file and update the index to 1.~~

**Step 9: Initialize the Vault Again**

Run the initialization script once more:

`sudo anchor run init_vault`

----------------------------------------------------------------------------------------

****TradeFi Strategy Initialization****

**Step 10: Update the create_vault_with_trade_fi_strategy.ts File**

Edit the file create_vault_with_trade_fi_strategy.ts:
    Replace the underlying_mint on line 29 with the public key from Step 5.1.
    ~~Set the index to 2.~~

**Step 11: Initialize TradeFi**

Run the initialization script for the TradeFi strategy:

Note: update the depositPeriodEnds and lockPeriodEnds fields at line #161 and #163.

`sudo anchor run init_trade_fi`

----------------------------------------------------------------------------------------

****Faucet Initialization****

**Step 12: Initialize the Faucet**

Note: Replace the underlying_mint on line 24 with the public key you captured in Step 5.1.

Run the faucet initialization script:

`sudo anchor run init_faucet`

If you encounter any issues such as program ID mismatch, perform the following actions:
    - Close the Program: Stop any running instances.
    - Delete the idl, target, and deploy Directories:

`rm -rf target/deploy/faucet-keypair.json`
`rm -rf target/idl/faucet.json`


Rebuild and Redeploy:

`sudo anchor build`
`sudo anchor deploy -p faucet`

After resolving these issues, rerun the init_faucet script.

****Final Thoughts****

By following these steps, you should have successfully initialized, deployed, and configured your Solana project. Remember to review logs carefully after each step and ensure that any errors are resolved before proceeding to the next.

If you encounter any specific issues, refer to the official Solana documentation or Anchor documentation.