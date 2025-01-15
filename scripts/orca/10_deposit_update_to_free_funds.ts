//TODO: after seeing free_funds directly works.
// make cluade refer to free_funds directly's remaining account structuring and make it call updateDebt only in this script.

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
    const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(secretKeyPath, "utf8")));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    // Initialize programs
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;

    const updateAmount = new BN(10_000_000).sub(new BN(7_000_000)); // Amount to update
    
    const vaultIndex = 0;

    // Derive vault PDA
    const [vault] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        new BN(vaultIndex).toArrayLike(Buffer, 'le', 8)
      ],
      vaultProgram.programId
    );

    // Get assets and verify environment
    const assets = CONFIG.mints.assets;
    const totalWeightBps = Object.values(assets as Record<string, Asset>).reduce(
      (sum, asset) => sum + asset.investment_config.assigned_weight_bps, 
      0
    );

    console.log("\nDistributing debt across strategies...");
    
    for (let i = 0; i < Object.keys(assets).length; i++) {
      const assetSymbol = Object.keys(assets)[i];
      const asset = assets[assetSymbol];
      const weight = asset.investment_config.assigned_weight_bps;
      
      // Calculate proportional amount
      const strategyAmount = updateAmount.mul(new BN(weight)).div(new BN(totalWeightBps));

      // Derive strategy PDA
      const [strategy] = PublicKey.findProgramAddressSync(
        [vault.toBuffer(), new BN(i).toArrayLike(Buffer, 'le', 8)],
        strategyProgram.programId
      );

      console.log(`\nUpdating debt for ${assetSymbol} (Strategy ${i}):`);
      console.log(`- Amount: ${strategyAmount.toString()}`);

      // Get strategy account to check a_to_b_for_purchase
      const strategyAccount = await strategyProgram.account.orcaStrategy.fetch(strategy);

      const assetMint = new PublicKey(assets[assetSymbol].address);
      const [strategyAssetAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_account"), assetMint.toBuffer(), strategy.toBuffer()],
        strategyProgram.programId
      );

      const [strategyTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("underlying"), strategy.toBuffer()],
        strategyProgram.programId
      );

      // Use the same token account ordering as in free_funds
      const [tokenAccountA, tokenAccountB] = strategyAccount.aToBForPurchase
        ? [strategyTokenAccount, strategyAssetAccount]
        : [strategyAssetAccount, strategyTokenAccount];

      // Form remaining accounts using selling tick arrays instead of buying
      const remainingAccounts = [
        { pubkey: new PublicKey(CONFIG.programs.whirlpool_program), isWritable: false, isSigner: false },
        { pubkey: new PublicKey(asset.pool.id), isWritable: true, isSigner: false },
        { pubkey: tokenAccountA, isWritable: true, isSigner: false },
        { pubkey: new PublicKey(asset.pool.token_vault_a), isWritable: true, isSigner: false },
        { pubkey: tokenAccountB, isWritable: true, isSigner: false },
        { pubkey: new PublicKey(asset.pool.token_vault_b), isWritable: true, isSigner: false },
        ...TICK_ARRAYS[ENV].assets[assetSymbol].selling_tick_arrays.slice(0, 3).map(addr => ({
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

      await vaultProgram.methods
        .updateDebt(strategyAmount)
        .accounts({
          vault,
          strategy,
          signer: admin.publicKey,
          underlyingMint: new PublicKey(CONFIG.mints.underlying.address),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(remainingAccounts)
        .preInstructions([computeUnitIx])
        .signers([admin])
        .rpc();

      console.log(`✓ Debt updated for ${assetSymbol}`);
    }

  } catch (error) {
    console.error("Error occurred:", error);
    if ('logs' in error) {
      console.error("Program Logs:", error.logs);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});