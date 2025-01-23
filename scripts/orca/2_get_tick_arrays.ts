import { Connection, PublicKey } from "@solana/web3.js";
import { OrcaDAL } from "./orca-utils/dal/orca-dal";
import { getTickArrayPublicKeysForSwap } from "./orca-utils/getTickArrayPublicKeysForSwap";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Strategy } from "../../target/types/strategy";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Load deployment addresses based on environment
const ADDRESSES_FILE = path.join(__dirname, 'deployment_addresses', 'addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';
const CONFIG = ADDRESSES[ENV];

if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

// Common constants from config
const WHIRLPOOLS_CONFIG = new PublicKey(CONFIG.programs.whirlpools_config);
const WHIRLPOOL_PROGRAM_ID = new PublicKey(CONFIG.programs.whirlpool_program);

interface AssetConfig {
  address: string;
  pool: {
    id: string;
  };
}

interface TickArrayData {
  [environment: string]: {
    assets: {
      [symbol: string]: {
        buying_tick_arrays: string[];
        selling_tick_arrays: string[];
      }
    }
  }
}

async function main() {
  try {
    // Setup Provider and Program
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;

    // Create connection based on environment
    const connection = new Connection(
      ENV === 'devnet' 
        ? "https://api.devnet.solana.com"
        : "https://api.mainnet-beta.solana.com"
    );
    const dal = new OrcaDAL(WHIRLPOOLS_CONFIG, WHIRLPOOL_PROGRAM_ID, connection);

    // Get strategy PDA
    const vaultIndex = 0;
    const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vaultIndex)]).buffer))
      ],
      vaultProgram.programId
    );

    // Initialize data structure for tick arrays
    const tickArrayData: TickArrayData = {
      [ENV]: {
        assets: {}
      }
    };

    // Get all configured assets
    const assets = CONFIG.mints.assets;
    const assetSymbols = Object.keys(assets);

    console.log(`Processing ${assetSymbols.length} strategies...`);

    // Process each strategy
    for (let strategyIndex = 0; strategyIndex < assetSymbols.length; strategyIndex++) {
      const symbol = assetSymbols[strategyIndex];
      const asset = assets[symbol];
      const assetMint = new PublicKey(asset.address);
      const whirlpoolId = new PublicKey(asset.pool.id);

      // Get strategy PDA for this index
      const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          vaultPDA.toBuffer(),
          new anchor.BN(strategyIndex).toArrayLike(Buffer, 'le', 8)
        ],
        strategyProgram.programId
      );

      console.log(`\nProcessing ${symbol} (Strategy ${strategyIndex}):`);
      console.log("Strategy:", strategy.toBase58());

      // Fetch strategy account data to get a_to_b_for_purchase
      const strategyAccount = await strategyProgram.account.orcaStrategy.fetch(strategy);
      const aToBForPurchase = strategyAccount.aToBForPurchase;

      // Get tick arrays for buying flow
      const tickArraysBuying = await getTickArrayPublicKeysForSwap(whirlpoolId, WHIRLPOOL_PROGRAM_ID, aToBForPurchase, dal);
      console.log(`Tick Arrays for Buying (Pool: ${whirlpoolId.toBase58()}):`, tickArraysBuying.map(pk => pk.toBase58()));

      // Get tick arrays for selling flow
      const tickArraysSelling = await getTickArrayPublicKeysForSwap(whirlpoolId, WHIRLPOOL_PROGRAM_ID, !aToBForPurchase, dal);
      console.log(`Tick Arrays for Selling (Pool: ${whirlpoolId.toBase58()}):`, tickArraysSelling.map(pk => pk.toBase58()));

      // Store in data structure
      tickArrayData[ENV].assets[symbol] = {
        buying_tick_arrays: tickArraysBuying.map(pk => pk.toBase58()),
        selling_tick_arrays: tickArraysSelling.map(pk => pk.toBase58())
      };
    }

    // Write to file
    const outputPath = path.join(__dirname, 'deployment_addresses', 'currentTickArrays.json');
    fs.writeFileSync(
      outputPath,
      JSON.stringify(tickArrayData, null, 2)
    );

    console.log(`\nTick arrays have been saved to ${outputPath}`);

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
