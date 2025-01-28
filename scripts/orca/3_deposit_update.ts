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
  getOrCreateAssociatedTokenAccount,
  createAssociatedTokenAccount
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

function getSecretKeyPath(): string {
  const ENV = process.env.CLUSTER || 'devnet';
  const filename = ENV === 'mainnet' ? 'mainnet.json' : 'id.json';
  return path.resolve(process.env.HOME!, '.config/solana', filename);
}

async function main() {
  try {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Load admin keypair using the dynamic path function
    const secretKeyPath = getSecretKeyPath();
    const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log("Admin PublicKey:", admin.publicKey.toBase58());

    // Initialize programs
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;
    const accountantProgram = anchor.workspace.Accountant as Program<Accountant>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;

    console.log("Vault Program:", vaultProgram.programId.toBase58());
    console.log("Access Control Program:", accessControlProgram.programId.toBase58());
    console.log("Accountant Program:", accountantProgram.programId.toBase58());
    console.log("Strategy Program:", strategyProgram.programId.toBase58());

    const depositAmount = new BN(3_800_000); // 4 USDC
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

    console.log("Vault:", vault.toBase58());

    // Derive accountant PDA (same way as in init_accountant.rs)
    const [accountant] = PublicKey.findProgramAddressSync(
      [new BN(accountantIndex).toArrayLike(Buffer, 'le', 8)],
      accountantProgram.programId
    );

    console.log("Accountant:", accountant.toBase58());

    // Derive shares mint
    const [sharesMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("shares"), vault.toBuffer()],
      vaultProgram.programId
    );

    
    // console.log("Shares mint:", sharesMint.toBase58()); 
    // console.log("Before get user token account")

    // Get user's token account
    const userTokenAccount = await getAssociatedTokenAddress(
      underlyingMint,
      admin.publicKey
    );
    // console.log("After get user token account")
    // console.log("User token account:", userTokenAccount.toBase58());

    console.log("Before get or create user shares account")
    // Get or create user's shares account
    const userSharesAccount = await getAssociatedTokenAddress(
      sharesMint,
      admin.publicKey
    );

    console.log("User shares account:", userSharesAccount.toString());

    // Create the ATA if it doesn't exist
      // await createAssociatedTokenAccount(
      //   provider.connection,
      //   admin,
      //   sharesMint,
      //   admin.publicKey,
      //   undefined,
      //   TOKEN_PROGRAM_ID,
      //   ASSOCIATED_TOKEN_PROGRAM_ID
      // );


    console.log("After get or create user shares account")
    // console.log("User shares account:", userSharesAccount.toBase58());
    console.log("Before log initial balances")
    // Log initial balances
    const initialBalances = {
      userUsdc: await provider.connection.getTokenAccountBalance(userTokenAccount),
      userShares: await provider.connection.getTokenAccountBalance(userSharesAccount),
    };
    console.log("After log initial balances")

    console.log("\nInitial Balances:");
    console.log("User USDC:", initialBalances.userUsdc.value.uiAmount);
    console.log("User Shares:", initialBalances.userShares.value.uiAmount);

      // Execute deposit first
      await vaultProgram.methods
        .deposit(depositAmount)
        .accounts({
          vault,
          accountant,
          userTokenAccount,
          underlyingMint,
          userSharesAccount: userSharesAccount,
          user: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      console.log("\nDeposit transaction executed successfully");
      console.log(`Deposit amount: ${depositAmount.toString()}`);

      // Get assets and verify environment
      const assets = ["BONK", "PENGU", "WIF"]; // Define fixed order of assets
      const assetIndexToUpdate = 2; // 0 for BONK, 1 for PENGU, 2 for WIF
      const assetSymbol = assets[assetIndexToUpdate];
      const asset = CONFIG.mints.assets[assetSymbol];

      if (!asset) {
        throw new Error(`Asset ${assetSymbol} not found in config`);
      }

      console.log(`\nEnvironment: ${ENV}`);
      console.log(`Updating debt for asset: ${assetSymbol}`);

      const weight = asset.investment_config.assigned_weight_bps;
      const aToBForPurchase = asset.investment_config.a_to_b_for_purchase;

      // Calculate proportional amount (assuming 10000 bps total)
      const strategyAmount = depositAmount.mul(new BN(weight)).div(new BN(10000));

      // Derive strategy PDA
      const [strategy] = PublicKey.findProgramAddressSync(
        [vault.toBuffer(), new BN(assetIndexToUpdate).toArrayLike(Buffer, 'le', 8)],
        strategyProgram.programId
      );

      console.log("Strategy:", strategy.toBase58());

      console.log(`\nUpdating debt for ${assetSymbol} (Strategy ${assetIndexToUpdate}):`);
      console.log(`- Weight: ${weight} bps (${(weight / 100).toFixed(2)}%)`);
      console.log(`- Amount: ${strategyAmount.toString()}`);
      console.log(`- Strategy address: ${strategy.toString()}`);
      console.log(`- A to B for purchase: ${aToBForPurchase}`);

      const assetMint = new PublicKey(asset.address);
      const whirlpoolAddress = new PublicKey(asset.pool.id);

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
        { pubkey: new PublicKey(asset.pool.token_vault_a), isWritable: true, isSigner: false },
        { pubkey: tokenAccountB, isWritable: true, isSigner: false },
        { pubkey: new PublicKey(asset.pool.token_vault_b), isWritable: true, isSigner: false },
        ...TICK_ARRAYS[ENV].assets[assetSymbol].buying_tick_arrays.slice(0, 3).map(addr => ({
          pubkey: new PublicKey(addr),
          isWritable: true,
          isSigner: false
        })),
        { pubkey: new PublicKey(asset.pool.oracle), isWritable: true, isSigner: false }
      ];

      // Set compute unit limit
      const computeUnitIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 300_000,
      });

      // await vaultProgram.methods
      //   .updateDebt(strategyAmount)
      //   .accounts({
      //     vault,
      //     strategy,
      //     signer: admin.publicKey,
      //     underlyingMint,
      //     tokenProgram: TOKEN_PROGRAM_ID,
      //   })
      //   .remainingAccounts(remainingAccounts)
      //   .preInstructions([computeUnitIx])
      //   .signers([admin])
      //   .rpc();

      console.log(`✓ Debt updated for ${assetSymbol}`);

      // Log final balances
      const finalBalances = {
        userUsdc: await provider.connection.getTokenAccountBalance(userTokenAccount),
        userShares: await provider.connection.getTokenAccountBalance(userSharesAccount),
      };

      console.log("\nFinal Balances:");
      console.log("User USDC:", finalBalances.userUsdc.value.uiAmount);
      console.log("User Shares:", finalBalances.userShares.value.uiAmount);

      console.log("\nBalance Changes:");
      console.log("User USDC:", finalBalances.userUsdc.value.uiAmount! - initialBalances.userUsdc.value.uiAmount!);
      console.log("User Shares:", finalBalances.userShares.value.uiAmount! - initialBalances.userShares.value.uiAmount!);


  } catch (error) {
    console.error("Error occurred:", error);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});