import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../../target/types/tokenized_vault";
import { Strategy } from "../../../target/types/strategy";
import { AccessControl } from "../../../target/types/access_control";
import { OrcaStrategyConfig, OrcaStrategyConfigSchema } from "../../../tests/utils/schemas";
import { BN } from "@coral-xyz/anchor";
import * as token from "@solana/spl-token";
import * as borsh from "borsh";
import * as fs from "fs";
import * as path from "path";
import { PublicKey, Keypair, Transaction, Connection, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createInitializeAccountInstruction
} from "@solana/spl-token";

// Constants
const METADATA_SEED = "metadata";

// Add these interfaces at the top of the file after imports
interface AssetConfig {
  address: string;
  decimals: number;
  pool: {
    id: string;
    token_vault_a: string;
    token_vault_b: string;
    oracle: string;
    tick_arrays: string[];
  };
  investment_config: {
    a_to_b_for_purchase: boolean;
    assigned_weight_bps: number;
  };
}

interface Config {
  programs: {
    whirlpool_program: string;
    token_program: string;
    token_metadata_program: string;
  };
  mints: {
    underlying: {
      address: string;
      decimals: number;
      symbol: string;
    };
    assets: {
      [key: string]: AssetConfig;
    };
  };
  roles: {
    report_bot: string;
  };
  vault_config: {
    deposit_limit: string;
    min_user_deposit: string;
    profit_max_unlock_time: string;
    kyc_verified_only: boolean;
    direct_deposit_enabled: boolean;
    whitelisted_only: boolean;
  };
}

// Add this near the top with other file reads
const TICK_ARRAYS_FILE = path.join(__dirname, 'deployment_addresses', 'currentTickArrays.json');
const TICK_ARRAYS = JSON.parse(fs.readFileSync(TICK_ARRAYS_FILE, 'utf8'));

async function main() {
  try {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Load admin keypair and initialize programs
    const secretKeyPath = path.resolve(process.env.HOME!, ".config/solana/id.json");
    const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(secretKeyPath, 'utf8')));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;

    // Get vault and strategy PDAs
    const vault_index = 0;
    const [vaultPDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from("vault"),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vault_index)]).buffer))
      ],
      vaultProgram.programId
    );

    // Load addresses from config file
    const ADDRESSES_FILE = path.join(__dirname, 'deployment_addresses', 'addresses.json');
    const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
    const ENV = process.env.CLUSTER || 'devnet';
    const CONFIG: Config = ADDRESSES[ENV];

    if (!CONFIG) {
      throw new Error(`No configuration found for environment: ${ENV}`);
    }

    // Deploy funds for each asset
    for (const [symbol, asset] of Object.entries(CONFIG.mints.assets)) {
      try {
        console.log(`\nProcessing ${symbol}...`);
        
        const assetMint = new PublicKey(asset.address);
        const whirlpoolAddress = new PublicKey(asset.pool.id);

        // Get strategy PDA and fetch its data
        const [strategy] = PublicKey.findProgramAddressSync(
          [vaultPDA.toBuffer(), new BN(0).toArrayLike(Buffer, 'le', 8)],
          strategyProgram.programId
        );

        const strategyAccount = await strategyProgram.account.orcaStrategy.fetch(strategy);
        
        // Get strategy token accounts
        const [strategyAssetAccount] = PublicKey.findProgramAddressSync(
          [Buffer.from("token_account"), assetMint.toBuffer(), strategy.toBuffer()],
          strategyProgram.programId
        );

        const strategyTokenAccount = PublicKey.findProgramAddressSync(
          [Buffer.from("underlying"), strategy.toBuffer()],
          strategyProgram.programId
        )[0];

        // Check idle underlying amount
        const idleUnderlying = strategyAccount.idleUnderlying;
        console.log(`Idle underlying for ${symbol}:`, idleUnderlying.toString());

        if (idleUnderlying.eq(new BN(0))) {
          console.log(`No idle underlying for ${symbol}, skipping...`);
          continue;
        }

        // Get token account order based on a_to_b_for_purchase from strategy account
        const [tokenAccountA, tokenAccountB] = strategyAccount.aToBForPurchase
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
          ...TICK_ARRAYS[ENV].assets[symbol].buying_tick_arrays.slice(0, 3).map(addr => ({
            pubkey: new PublicKey(addr),
            isWritable: true,
            isSigner: false
          })),
          { pubkey: new PublicKey(asset.pool.oracle), isWritable: true, isSigner: false }
        ];

        // Call deployFunds for this asset
        await strategyProgram.methods
          .deployFunds(new BN(idleUnderlying.toString()))
          .accounts({
            strategy: strategy,
            underlyingMint: new PublicKey(CONFIG.mints.underlying.address),
            signer: admin.publicKey,
          })
          .remainingAccounts(remainingAccounts)
          .signers([admin])
          .rpc();

        console.log(`Successfully deployed ${idleUnderlying.toString()} funds for ${symbol}`);

      } catch (error) {
        console.error(`Error deploying funds for ${symbol}:`, error);
        if ('logs' in error) {
          console.error("Program Logs:", error.logs);
        }
      }
    }

  } catch (error) {
    console.error("Error occurred:", error);
    throw error;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});