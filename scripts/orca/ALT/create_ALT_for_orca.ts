import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../../target/types/tokenized_vault";
import { Strategy } from "../../../target/types/strategy";
import { BN } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  TransactionInstruction,
  AddressLookupTableAccount,
  SystemProgram,
  VersionedTransaction,  
  TransactionMessage,
  AddressLookupTableProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Load deployment addresses based on environment
const ADDRESSES_FILE = path.join(__dirname, '..', 'deployment_addresses', 'addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';

interface PoolConfig {
  id: string;
  token_vault_a: string;
  token_vault_b: string;
  oracle: string;
  tick_arrays: string[];
}

interface InvestmentConfig {
  a_to_b_for_purchase: boolean;
  assigned_weight_bps: number;
}

interface AssetConfig {
  address: string;
  decimals: number;
  pool: PoolConfig;
  investment_config: InvestmentConfig;
}

interface Config {
  programs: {
    whirlpool_program: string;
    token_program: string;
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
}

// Then modify the CONFIG type
const CONFIG = ADDRESSES[ENV] as Config;

if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

async function main() {
  try {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const connection = provider.connection;
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;

    // Load admin keypair
    const secretKeyPath = path.resolve(process.env.HOME!, `.config/solana/${ENV === 'mainnet' ? 'mainnet.json' : 'id.json'}`);
    const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(secretKeyPath, 'utf8')));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log(`Creating Address Lookup Table for ${ENV} environment`);

    // Define vault index (matching with init script)
    const vaultIndex = 2; // third vault
    console.log("Using Vault Index:", vaultIndex);

    // Get PDAs using vaultIndex
    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        new anchor.BN(vaultIndex).toArrayLike(Buffer, 'le', 8)
      ],
      vaultProgram.programId
    );
    console.log("Vault PDA:", vault.toBase58());

    const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
      [vault.toBuffer(), 
        new anchor.BN(vaultIndex).toArrayLike(Buffer, 'le', 8)
      ],
      strategyProgram.programId
    );
    console.log("Strategy PDA:", strategy.toBase58());

    
    const [strategyData] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("strategy_data"),
        vault.toBuffer(),
        strategy.toBuffer(),
      ],
      vaultProgram.programId
    );

    const [strategyTokenAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("underlying"), strategy.toBuffer(), strategy.toBuffer()],
      strategyProgram.programId
    );
    console.log("Strategy Data PDA:", strategyData.toBase58());
    // Collect addresses for lookup table
    const addresses: PublicKey[] = [
      new PublicKey(CONFIG.programs.whirlpool_program),
      TOKEN_PROGRAM_ID,
      vault,
      strategy,
      strategyData,
      strategyTokenAccount,
    ];

    // Add addresses for each configured asset
    for (const [symbol, asset] of Object.entries(CONFIG.mints.assets)) {
      const assetMint = new PublicKey(asset.address);
      
      // Add pool-related addresses
      addresses.push(
        new PublicKey(asset.pool.id),
        new PublicKey(asset.pool.token_vault_a),
        new PublicKey(asset.pool.token_vault_b),
        new PublicKey(asset.pool.oracle)
      );

      // Add tick arrays
      asset.pool.tick_arrays.forEach(tickArray => {
        addresses.push(new PublicKey(tickArray));
      });

      // Add PDAs
      const [strategyAssetAccount] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("token_account"), assetMint.toBuffer(), strategy.toBuffer()],
        strategyProgram.programId
      );

      const [investTracker] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("invest_tracker"), assetMint.toBuffer(), strategy.toBuffer()],
        strategyProgram.programId
      );

      console.log("Strategy Asset Account PDA:", strategyAssetAccount.toBase58());
      console.log("Invest Tracker PDA:", investTracker.toBase58());

      addresses.push(strategyAssetAccount, investTracker);
    }


    const slot = await connection.getSlot();
    const [lookupTableInst, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
      authority: admin.publicKey,
      payer: admin.publicKey,
      recentSlot: slot - 1,
    });

    // Create the lookup table
    console.log("\nCreating lookup table...");
    const tx = new anchor.web3.Transaction().add(lookupTableInst);
    await provider.sendAndConfirm(tx, [admin]);

    await waitForNewBlock(connection, 1);

    // Extend table with addresses in chunks
    console.log(`\nExtending lookup table with ${addresses.length} total addresses...`);
    console.log("\nAddresses being added:");
    addresses.forEach((addr, index) => {
      console.log(`${index + 1}. ${addr.toBase58()}`);
    });

    const chunkSize = 20;
    for (let i = 0; i < addresses.length; i += chunkSize) {
      const chunk = addresses.slice(i, Math.min(i + chunkSize, addresses.length));
      const extendIx = AddressLookupTableProgram.extendLookupTable({
        payer: admin.publicKey,
        authority: admin.publicKey,
        lookupTable: lookupTableAddress,
        addresses: chunk
      });

      await provider.sendAndConfirm(new anchor.web3.Transaction().add(extendIx), [admin]);
      console.log(`Added chunk ${Math.floor(i / chunkSize) + 1}: addresses ${i + 1} to ${i + chunk.length} (${chunk.length} addresses)`);
      await waitForNewBlock(connection, 1);
    }

    // After all chunks are added, verify final count
    console.log(`\nTotal addresses added: ${addresses.length}`);

    // Save the lookup table address
    const altJson = {
      lookupTableAddress: lookupTableAddress.toBase58()
    };
    
    const altJsonPath = path.join(__dirname, 'ALT.json');
    fs.writeFileSync(altJsonPath, JSON.stringify(altJson, null, 2));
    
    console.log(`\nLookup table created successfully!`);
    console.log(`Address: ${lookupTableAddress.toBase58()}`);
    console.log(`Saved to: ${altJsonPath}`);

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

async function waitForNewBlock(
  connection: Connection,
  targetBlocks: number,
): Promise<void> {
  console.log(`Waiting for ${targetBlocks} new block(s)...`);
  const initialSlot = await connection.getSlot();
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      try {
        const currentSlot = await connection.getSlot();
        if (currentSlot >= initialSlot + targetBlocks) {
          clearInterval(interval);
          console.log(`New block(s) reached. Current slot: ${currentSlot}`);
          resolve();
        }
      } catch (error) {
        console.error("Error while fetching slot:", error);
        clearInterval(interval);
        resolve();
      }
    }, 1000);
  });
}
