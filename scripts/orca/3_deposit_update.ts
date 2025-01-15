import * as dotenv from 'dotenv';
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { AccessControl } from "../../target/types/access_control";
import { BN } from "@coral-xyz/anchor";
import * as token from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount
} from "@solana/spl-token";
import { Accountant } from "../../target/types/accountant";
import { Strategy } from "../../target/types/strategy";
import { ComputeBudgetProgram } from "@solana/web3.js";

// Load config
dotenv.config();
const ADDRESSES_FILE = path.join(__dirname, 'deployment_addresses', 'addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';
const CONFIG = ADDRESSES[ENV];

if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

const underlyingMint = new PublicKey(CONFIG.mints.underlying.address);

type Asset = {
  investment_config: {
    assigned_weight_bps: number;
  }
};

const TICK_ARRAYS_FILE = path.join(__dirname, 'deployment_addresses', 'currentTickArrays.json');
const TICK_ARRAYS = JSON.parse(fs.readFileSync(TICK_ARRAYS_FILE, 'utf8'));

async function main() {
  try {
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
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;
    const accountantProgram = anchor.workspace.Accountant as Program<Accountant>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;

    const depositAmount = new BN(10_000_000); // 5 USDC
    const vaultIndex = 0;
    const accountantIndex = 0; // The first accountant we created

    // Derive vault PDA
    const [vault] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        new BN(vaultIndex).toArrayLike(Buffer, 'le', 8)
      ],
      vaultProgram.programId
    );

    // Derive accountant PDA (same way as in init_accountant.rs)
    const [accountant] = PublicKey.findProgramAddressSync(
      [new BN(accountantIndex).toArrayLike(Buffer, 'le', 8)],
      accountantProgram.programId
    );

    // Derive shares mint
    const [sharesMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("shares"), vault.toBuffer()],
      vaultProgram.programId
    );

    // Get user's token account
    const userTokenAccount = await getAssociatedTokenAddress(
      underlyingMint,
      admin.publicKey
    );

    // console.log("User token account:", userTokenAccount.toBase58());

    // Get or create user's shares account
    const userSharesAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      sharesMint,
      admin.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // console.log("User shares account:", userSharesAccount.toBase58());

    // Log initial balances
    const initialBalances = {
      userUsdc: await provider.connection.getTokenAccountBalance(userTokenAccount),
      userShares: await provider.connection.getTokenAccountBalance(userSharesAccount.address),
    };

    console.log("\nInitial Balances:");
    console.log("User USDC:", initialBalances.userUsdc.value.uiAmount);
    console.log("User Shares:", initialBalances.userShares.value.uiAmount);

    try {
      // Execute deposit first
      await vaultProgram.methods
        .deposit(depositAmount)
        .accounts({
          vault,
          accountant,
          userTokenAccount,
          underlyingMint,
          userSharesAccount: userSharesAccount.address,
          user: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      console.log("\nDeposit transaction executed successfully");
      console.log(`Deposit amount: ${depositAmount.toString()}`);

      // Get assets and verify environment
      const assets = CONFIG.mints.assets;
      console.log(`\nEnvironment: ${ENV}`);
      console.log("Assets to distribute:", Object.keys(assets).join(", "));

      // Calculate total weight and verify it equals 10000 (100%)
      const totalWeightBps = Object.values(assets as Record<string, Asset>).reduce(
        (sum, asset) => sum + asset.investment_config.assigned_weight_bps, 
        0
      );
      
      if (totalWeightBps !== 10000) {
        console.warn(`Warning: Total weight (${totalWeightBps} bps) does not equal 100% (10000 bps)`);
      }

      console.log("\nWeight Distribution:");
      Object.entries(assets as Record<string, Asset>).forEach(([symbol, asset]) => {
        const weight = asset.investment_config.assigned_weight_bps;
        console.log(`${symbol}: ${weight} bps (${(weight / 100).toFixed(2)}%)`);
      });

      console.log("\nDistributing debt across strategies...");
      
      for (let i = 0; i < Object.keys(assets).length; i++) {
        const assetSymbol = Object.keys(assets)[i];
        const asset = assets[assetSymbol];
        const weight = asset.investment_config.assigned_weight_bps;
        const aToBForPurchase = asset.investment_config.a_to_b_for_purchase;
        
        // Calculate proportional amount
        const strategyAmount = depositAmount.mul(new BN(weight)).div(new BN(totalWeightBps));

        // Derive strategy PDA
        const [strategy] = PublicKey.findProgramAddressSync(
          [vault.toBuffer(), new BN(i).toArrayLike(Buffer, 'le', 8)],
          strategyProgram.programId
        );

        console.log(`\nUpdating debt for ${assetSymbol} (Strategy ${i}):`);
        console.log(`- Weight: ${weight} bps (${(weight / 100).toFixed(2)}%)`);
        console.log(`- Amount: ${strategyAmount.toString()}`);
        console.log(`- Strategy address: ${strategy.toString()}`);
        console.log(`- A to B for purchase: ${aToBForPurchase}`);

        const assetMint = new PublicKey(assets[assetSymbol].address);
        const whirlpoolAddress = new PublicKey(assets[assetSymbol].pool.id);

        // Get strategy token accounts
        const [strategyAssetAccount] = PublicKey.findProgramAddressSync(
          [Buffer.from("token_account"), assetMint.toBuffer(), strategy.toBuffer()],
          strategyProgram.programId
        );

        const strategyTokenAccount = PublicKey.findProgramAddressSync(
          [Buffer.from("underlying"), strategy.toBuffer()],
          strategyProgram.programId
        )[0];

        // Get token account order based on a_to_b_for_purchase
        const [tokenAccountA, tokenAccountB] = aToBForPurchase
          ? [strategyTokenAccount, strategyAssetAccount]
          : [strategyAssetAccount, strategyTokenAccount];

        // Form remaining accounts for this asset
        const remainingAccounts = [
          { pubkey: new PublicKey(CONFIG.programs.whirlpool_program), isWritable: false, isSigner: false },
          { pubkey: whirlpoolAddress, isWritable: true, isSigner: false },
          { pubkey: tokenAccountA, isWritable: true, isSigner: false },
          { pubkey: new PublicKey(assets[assetSymbol].pool.token_vault_a), isWritable: true, isSigner: false },
          { pubkey: tokenAccountB, isWritable: true, isSigner: false },
          { pubkey: new PublicKey(assets[assetSymbol].pool.token_vault_b), isWritable: true, isSigner: false },
          ...TICK_ARRAYS[ENV].assets[assetSymbol].buying_tick_arrays.slice(0, 3).map(addr => ({
            pubkey: new PublicKey(addr),
            isWritable: true,
            isSigner: false
          })),
          { pubkey: new PublicKey(assets[assetSymbol].pool.oracle), isWritable: true, isSigner: false }
        ];

        // Set compute unit limit
        const computeUnitIx = ComputeBudgetProgram.setComputeUnitLimit({
          units: 300_000,
        });

        await vaultProgram.methods
          .updateDebt(strategyAmount)
          .accounts({
            vault,
            strategy,
            signer: admin.publicKey,
            underlyingMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts(remainingAccounts)
          .preInstructions([computeUnitIx])
          .signers([admin])
          .rpc();

        console.log(`✓ Debt updated for ${assetSymbol}`);
      }

      // Log final balances
      const finalBalances = {
        userUsdc: await provider.connection.getTokenAccountBalance(userTokenAccount),
        userShares: await provider.connection.getTokenAccountBalance(userSharesAccount.address),
      };

      console.log("\nFinal Balances:");
      console.log("User USDC:", finalBalances.userUsdc.value.uiAmount);
      console.log("User Shares:", finalBalances.userShares.value.uiAmount);

      console.log("\nBalance Changes:");
      console.log("User USDC:", finalBalances.userUsdc.value.uiAmount! - initialBalances.userUsdc.value.uiAmount!);
      console.log("User Shares:", finalBalances.userShares.value.uiAmount! - initialBalances.userShares.value.uiAmount!);

    } catch (error) {
      console.error("Error during deposit or debt update:", error);
      if ('logs' in error) {
        console.error("Program Logs:", error.logs);
      }
    }

  } catch (error) {
    console.error("Error occurred:", error);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});