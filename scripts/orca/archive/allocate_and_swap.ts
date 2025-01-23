import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { Strategy } from "../../target/types/strategy";
import { AccessControl } from "../../target/types/access_control";
import { OrcaStrategyConfig, OrcaStrategyConfigSchema } from "../../tests/utils/schemas";
import { BN } from "@coral-xyz/anchor";
import * as token from "@solana/spl-token";
import * as borsh from "borsh";
import * as fs from "fs";
import * as path from "path";
import { PublicKey, Keypair, Transaction, Connection, SystemProgram} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createInitializeAccountInstruction
} from "@solana/spl-token";

// Constants
const METADATA_SEED = "metadata";
const TOKEN_METADATA_PROGRAM_ID = new anchor.web3.PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// Swap-related constants
const WHIRLPOOL_PROGRAM_ID = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
);
const WHIRLPOOL_ID = new PublicKey(
  "3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt"
);
const TICK_ARRAY_ADDRESSES = [
  new PublicKey("3aBJJLAR3QxGcGsesNXeW3f64Rv3TckF7EQ6sXtAuvGM"),
  new PublicKey("3aBJJLAR3QxGcGsesNXeW3f64Rv3TckF7EQ6sXtAuvGM"),
  new PublicKey("3aBJJLAR3QxGcGsesNXeW3f64Rv3TckF7EQ6sXtAuvGM"),
];
const ORACLE_ADDRESS = new PublicKey(
  "2KEWNc3b6EfqoWQpfKQMHh4mhRyKXYRdPbtGRTJX3Cip"
);

// Token Mints
const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);
const USDC_MINT = new PublicKey(
  "BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k"
);

// Swap Vaults
const TOKEN_VAULT_A = new PublicKey(
  "C9zLV5zWF66j3rZj3uuhDqvfuA8esJyWnruGzDW9qEj2"
);
const TOKEN_VAULT_B = new PublicKey(
  "7DM3RMz2yzUB8yPRQM3FMZgdFrwZGMsabsfsKopWktoX"
);

async function main() {
  try {
    // ============================
    // Setup Provider and Programs
    // ============================
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Load admin keypair
    const secretKeyPath = path.resolve(
      process.env.HOME!,
      ".config/solana/id.json"
    );
    const secretKeyString = fs.readFileSync(secretKeyPath, "utf8");
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log("Admin PublicKey:", admin.publicKey.toBase58());

    // Initialize programs
    const vaultProgram: Program<TokenizedVault> = anchor.workspace.TokenizedVault;
    const strategyProgram: Program<Strategy> = anchor.workspace.Strategy;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;

    console.log("Vault Program ID:", vaultProgram.programId.toBase58());
    console.log("Strategy Program ID:", strategyProgram.programId.toBase58());
    console.log("Access Control Program ID:", accessControlProgram.programId.toBase58());
    // ============================
    // 1. Deposit USDC to the Vault
    // ============================
    console.log("Depositing USDC to the Vault...");

    const depositAmount = new BN(10).mul(new BN(10).pow(new BN(6))); // x devUSDC
    const vault_index = 0; // Make sure this matches the index used in init_orca_strategy.ts


    // First, derive the vault PDA (moved up)
    const [vaultPDA] = await PublicKey.findProgramAddress(
      [
          Buffer.from("vault"),
          Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vault_index)]).buffer))
      ],
      vaultProgram.programId
    );

      // Then derive the shares mint (moved up)
    const [sharesMint] = await PublicKey.findProgramAddress(
        [Buffer.from("shares"), vaultPDA.toBuffer()],
        vaultProgram.programId
    );

        // Get user's USDC ATA and shares ATA
    const userUsdcATA = await getAssociatedTokenAddress(
          USDC_MINT,
          admin.publicKey
      );

      const userSharesATA = await token.getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin,                // payer
        sharesMint,          // mint
        admin.publicKey,     // owner
        false,               // allowOwnerOffCurve
        undefined,           // commitment
        undefined,           // confirmOptions
        TOKEN_PROGRAM_ID,    // programId
        ASSOCIATED_TOKEN_PROGRAM_ID // associatedTokenProgramId
    );
  
      // Get vault's USDC ATA
      const vaultUsdcATA = PublicKey.findProgramAddressSync(
        [Buffer.from("underlying"), vaultPDA.toBuffer()],
        vaultProgram.programId
    )[0];
  
      try {
        await vaultProgram.methods
            .deposit(depositAmount)
            .accounts({
                vault: vaultPDA,
                userTokenAccount: userUsdcATA,
                userSharesAccount: userSharesATA.address,
                user: admin.publicKey,
            })
            .signers([admin])
            .rpc();
        
        // Add balance check
        const userUsdcBalance = await provider.connection.getTokenAccountBalance(userUsdcATA);
        const vaultUsdcBalance = await provider.connection.getTokenAccountBalance(vaultUsdcATA);
        const userSharesBalance = await provider.connection.getTokenAccountBalance(userSharesATA.address);
        console.log("User USDC balance after deposit:", userUsdcBalance.value.uiAmount);
        console.log("Vault USDC balance after deposit:", vaultUsdcBalance.value.uiAmount);
        console.log("User shares balance after deposit:", userSharesBalance.value.uiAmount);
      } catch (error) {
        console.error("Error during deposit:", error);
      }

    console.log(`Deposited ${depositAmount.toNumber()} USDC to the Vault.`);
    const userSharesBalance = await provider.connection.getTokenAccountBalance(userSharesATA.address);
    console.log("User shares balance after deposit raw number:", userSharesBalance.value.amount);
    console.log("User shares balance after deposit:", userSharesBalance.value.uiAmount);

    // ============================
    // 2. Update Debt on the Orca Strategy
    // ============================
    console.log("Updating debt on the Orca Strategy...");

    // First derive strategy PDA
    const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
      [vaultPDA.toBuffer(), 
        new BN(0).toArrayLike(Buffer, 'le', 8)
      ],
      strategyProgram.programId
    );

    console.log("Strategy address:", strategy.toString());


    // Then derive strategy token account PDA
    const strategyTokenAccount = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("underlying"), strategy.toBuffer()],
      strategyProgram.programId,
    )[0];

    console.log("Strategy token account:", strategyTokenAccount.toBase58());

    try {
      const strategyAccountInfo = await provider.connection.getAccountInfo(strategy);
      if (!strategyAccountInfo) {
          throw new Error("Strategy account not found");
      }
      console.log("Strategy account exists with data length:", strategyAccountInfo.data.length);
      console.log("Strategy owner:", strategyAccountInfo.owner.toBase58());
      console.log("Expected strategy program ID:", strategyProgram.programId.toBase58());
  
      if (!strategyAccountInfo.owner.equals(strategyProgram.programId)) {
          throw new Error("Strategy account has incorrect owner");
      }
    } catch (error) {
        console.error("Error checking strategy account:", error);
        process.exit(1);
    }

  //check the balance of devUSDC in the strategy token account before updating debt
    const strategyDevUSDCBalance = await provider.connection.getTokenAccountBalance(strategyTokenAccount);
    console.log("Strategy devUSDC account balance before updating debt:", strategyDevUSDCBalance.value.uiAmount);

    const [roles] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_role"),
        admin.publicKey.toBuffer(),
        Buffer.from([1]) // Role::VaultsAdmin = 1
      ],
      accessControlProgram.programId
    );

    console.log("Roles address:", roles.toBase58());

    const STRATEGY_DATA_SEED = "strategy_data";

    // Before calling updateDebt, add this:
    const [strategyData] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(STRATEGY_DATA_SEED),
        vaultPDA.toBuffer(),
        strategy.toBuffer()
      ],
      vaultProgram.programId
    );

    console.log("Strategy Data PDA:", strategyData.toBase58());

    await vaultProgram.methods
      .updateDebt(depositAmount.mul(new BN(1)))
      .accounts({
        vault: vaultPDA,
        strategy: strategy,  
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log("Debt updated successfully.");

    //check the balance of devUSDC in the strategy token account after updating debt
    const strategyDevUSDCBalanceAfterUpdate = await provider.connection.getTokenAccountBalance(strategyTokenAccount);
    console.log("Strategy devUSDC account balance after updating debt:", strategyDevUSDCBalanceAfterUpdate.value.uiAmount);

    // ============================
    // 3. Deploy Funds in the Orca Strategy
    // ============================
    console.log("Deploying funds in the Orca Strategy...");
    const TOKEN_ACCOUNT_SEED = "token_account";

    const strategyWSOLAccount = PublicKey.findProgramAddressSync(
      [
        Buffer.from(TOKEN_ACCOUNT_SEED),    // TOKEN_ACCOUNT_SEED.as_bytes()
        WSOL_MINT.toBuffer(),      // asset_mint.key().to_bytes()
        strategy.toBuffer(),       // strategy.key().as_ref()
      ],
      strategyProgram.programId
    )[0];

    console.log("Strategy WSOL token account address:", strategyWSOLAccount.toBase58());

    // Prepare remaining accounts as per swap.ts
    const remainingAccountsForDeployFunds = [
      {
        pubkey: WHIRLPOOL_PROGRAM_ID,      // whirlpool_program (index 0)
        isWritable: false,
        isSigner: false,
      },
      {
        pubkey: WHIRLPOOL_ID,              // whirlpool (index 1)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: strategyWSOLAccount,      // token_owner_account_a (index 2)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TOKEN_VAULT_A,             // token_vault_a (index 3)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: strategyTokenAccount, // token_owner_account_b (index 4) 
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TOKEN_VAULT_B,             // token_vault_b (index 5)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TICK_ARRAY_ADDRESSES[0],   // tick_array_0 (index 6)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TICK_ARRAY_ADDRESSES[1],   // tick_array_1 (index 7)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TICK_ARRAY_ADDRESSES[2],   // tick_array_2 (index 8)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: ORACLE_ADDRESS,            // oracle (index 9)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: strategy,            // orca_strategy (index 10)
        isWritable: true,
        isSigner: false,
      },
    ];


    //let's check orca_strategy's deposit_limit and orca_strategy's total_assets

    //check the balance of devUSDC in the strategy token account before deploying funds
    const strategyDevUSDCBalanceBeforeDeploy = await provider.connection.getTokenAccountBalance(strategyTokenAccount);
    console.log("Strategy devUSDC account balance before deploying funds:", strategyDevUSDCBalanceBeforeDeploy.value.uiAmount);

    //check the balance of WSOL in the strategy token account before deploying funds
    const strategyWSOLAccountBalanceBeforeDeploy = await provider.connection.getTokenAccountBalance(strategyWSOLAccount);
    console.log("Strategy WSOL account balance before deploying funds:", strategyWSOLAccountBalanceBeforeDeploy.value.uiAmount);

    const deployAmount = new BN(1).mul(new BN(10).pow(new BN(6))); // 1 WSOL
    await strategyProgram.methods
      .deployFunds(deployAmount)
      .accounts({
        signer: admin.publicKey,
        strategy: strategy,
      })
      .remainingAccounts(remainingAccountsForDeployFunds)
      .signers([admin])
      .rpc();

    console.log("deploy_funds called successfully. Swap initiated.");

      //check the balance of devUSDC in the strategy token account after deploying funds
    const strategyDevUSDCBalanceAfterDeploy = await provider.connection.getTokenAccountBalance(strategyTokenAccount);
    console.log("Strategy devUSDC account balance after deploying funds:", strategyDevUSDCBalanceAfterDeploy.value.uiAmount);

    //check the balance of WSOL in the strategy token account after deploying funds
    const strategyWSOLAccountBalanceAfterDeploy = await provider.connection.getTokenAccountBalance(strategyWSOLAccount);
    console.log("Strategy WSOL account balance after deploying funds:", strategyWSOLAccountBalanceAfterDeploy.value.uiAmount);

    //now we need to test free_funds and it happens via redeem fn in the vault program
    const withdrawAmount = new BN(3).mul(new BN(10).pow(new BN(4)));
    const maxLoss = new BN(500000);

    const remainingAccounts = [
      {
        pubkey: WHIRLPOOL_PROGRAM_ID,      // whirlpool_program (index 0)
        isWritable: false,
        isSigner: false,
      },
      {
        pubkey: WHIRLPOOL_ID,              // whirlpool (index 1)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: strategyWSOLAccount,      // token_owner_account_a (index 2)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TOKEN_VAULT_A,             // token_vault_a (index 3)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: strategyTokenAccount, // token_owner_account_b (index 4) 
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TOKEN_VAULT_B,             // token_vault_b (index 5)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TICK_ARRAY_ADDRESSES[0],   // tick_array_0 (index 6)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TICK_ARRAY_ADDRESSES[1],   // tick_array_1 (index 7)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TICK_ARRAY_ADDRESSES[2],   // tick_array_2 (index 8)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: ORACLE_ADDRESS,            // oracle (index 9)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: strategy,            // orca_strategy (index 10)
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: strategyData, // strategy_data (index 11)
        isWritable: true,
        isSigner: false,
      }
    ];

    const remainingAccountsMap = {
      accountsMap: [
        {
          strategyAcc: new BN(10), // Index of the strategy account in remainingAccounts
          strategyTokenAccount: new BN(4), // Index of the strategy token account in remainingAccounts
          strategyData: new BN(11),
          remainingAccounts: [
            new BN(0),
            new BN(1),
            new BN(2),
            new BN(3),
            new BN(4),
            new BN(5),
            new BN(6),
            new BN(7),
            new BN(8),
            new BN(9)
          ], // Indices of any remaining accounts needed for the swap
        },
      ],
    };

    const redeemAmount = new BN(userSharesBalance.value.amount).div(new BN(2)); // Convert string to BN
    await vaultProgram.methods
      .redeem(
        redeemAmount, 
        maxLoss,
        remainingAccountsMap
      )
      .accounts({
        vault: vaultPDA,
        userTokenAccount: userUsdcATA,
        userSharesAccount: userSharesATA.address,
        user: admin.publicKey,
      })
      .remainingAccounts(remainingAccounts)
      .signers([admin])
      .rpc();
  
    // Fetch and assert the balances to ensure withdrawal was successful
    const userUsdcBalance = await provider.connection.getTokenAccountBalance(userUsdcATA);
    const vaultUsdcBalance = await provider.connection.getTokenAccountBalance(vaultUsdcATA);
    const strategyUsdcBalance = await provider.connection.getTokenAccountBalance(strategyTokenAccount);
  
    console.log("User USDC balance after withdrawal:", userUsdcBalance.value.uiAmount);
    console.log("Vault USDC balance after withdrawal:", vaultUsdcBalance.value.uiAmount);
    console.log("Strategy USDC balance after withdrawal:", strategyUsdcBalance.value.uiAmount);
  } catch (error) {
    console.error("Error occurred:", error);
  }


}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});