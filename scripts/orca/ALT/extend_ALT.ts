import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../../target/types/tokenized_vault";
import { Strategy } from "../../../target/types/strategy";
import * as fs from "fs";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";
import {
  Connection,
  AddressLookupTableProgram,
} from "@solana/web3.js";
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Load deployment addresses based on environment
const ADDRESSES_FILE = path.join(__dirname, '..', 'deployment_addresses', 'add_addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';

// Load existing ALT address
const ALT_FILE = path.join(__dirname, 'ALT.json');
const ALT_CONFIG = JSON.parse(fs.readFileSync(ALT_FILE, 'utf8'));

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

    console.log(`Extending Address Lookup Table for ${ENV} environment`);
    console.log("ALT Address:", ALT_CONFIG.lookupTableAddress);

    // Load and log the initial ALT state
    const initialLookupTableAccount = (
      await provider.connection.getAddressLookupTable(new PublicKey(ALT_CONFIG.lookupTableAddress))
    ).value;

    if (!initialLookupTableAccount) {
      throw new Error("Lookup table not found");
    }

    console.log("\nInitial ALT addresses:");
    initialLookupTableAccount.state.addresses.forEach((addr, index) => {
      console.log(`${index + 1}. ${addr.toBase58()}`);
    });
    console.log(`Total addresses in ALT before extension: ${initialLookupTableAccount.state.addresses.length}`);

    // Define vault index (matching with init script)
    const vaultIndex = 1; // Second vault
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
    const newAddresses: PublicKey[] = [
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
      newAddresses.push(
        new PublicKey(asset.pool.id),
        new PublicKey(asset.pool.token_vault_a),
        new PublicKey(asset.pool.token_vault_b),
        new PublicKey(asset.pool.oracle)
      );

      // Add tick arrays
      asset.pool.tick_arrays.forEach(tickArray => {
        newAddresses.push(new PublicKey(tickArray));
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

      newAddresses.push(strategyAssetAccount, investTracker);
    }

    // Get existing ALT account to check current addresses
    const lookupTableAccount = await connection.getAddressLookupTable(new PublicKey(ALT_CONFIG.lookupTableAddress));
    if (!lookupTableAccount.value) {
      throw new Error("Lookup table not found");
    }

    const existingAddresses = lookupTableAccount.value.state.addresses.map(addr => addr.toBase58());
    console.log("\nExisting addresses in ALT:", existingAddresses.length);

    // Filter out addresses that already exist in the ALT
    const addressesToAdd = newAddresses.filter(
      addr => !existingAddresses.includes(addr.toBase58())
    );

    if (addressesToAdd.length === 0) {
      console.log("No new addresses to add to the lookup table.");
      return;
    }

    console.log(`\nAdding ${addressesToAdd.length} new addresses to lookup table...`);
    console.log("\nAddresses being added:");
    addressesToAdd.forEach((addr, index) => {
      console.log(`${index + 1}. ${addr.toBase58()}`);
    });

    // Extend table with new addresses in chunks
    const chunkSize = 20;
    for (let i = 0; i < addressesToAdd.length; i += chunkSize) {
      const chunk = addressesToAdd.slice(i, Math.min(i + chunkSize, addressesToAdd.length));
      const extendIx = AddressLookupTableProgram.extendLookupTable({
        payer: admin.publicKey,
        authority: admin.publicKey,
        lookupTable: new PublicKey(ALT_CONFIG.lookupTableAddress),
        addresses: chunk
      });

      await provider.sendAndConfirm(new anchor.web3.Transaction().add(extendIx), [admin]);
      console.log(`Added chunk ${Math.floor(i / chunkSize) + 1}: addresses ${i + 1} to ${i + chunk.length} (${chunk.length} addresses)`);
      await waitForNewBlock(connection, 1);
    }

    // After extension, fetch and log the final state
    const finalLookupTableAccount = (
      await provider.connection.getAddressLookupTable(new PublicKey(ALT_CONFIG.lookupTableAddress))
    ).value;

    if (!finalLookupTableAccount) {
      throw new Error("Failed to fetch final lookup table state");
    }

    console.log("\nFinal ALT addresses after extension:");
    finalLookupTableAccount.state.addresses.forEach((addr, index) => {
      console.log(`${index + 1}. ${addr.toBase58()}`);
    });
    console.log(`Total addresses in ALT after extension: ${finalLookupTableAccount.state.addresses.length}`);

    // Log the newly added addresses
    if (finalLookupTableAccount.state.addresses.length > initialLookupTableAccount.state.addresses.length) {
      console.log("\nNewly added addresses:");
      const newAddressesCount = finalLookupTableAccount.state.addresses.length - initialLookupTableAccount.state.addresses.length;
      finalLookupTableAccount.state.addresses.slice(-newAddressesCount).forEach((addr, index) => {
        console.log(`${index + 1}. ${addr.toBase58()}`);
      });
    }

  } catch (error) {
    console.error("Error occurred:", error);
    if ('logs' in error) {
      console.error("Program Logs:", error.logs);
    }
  }
}

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
}); 