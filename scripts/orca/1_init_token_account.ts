import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Strategy } from "../../target/types/strategy";
import { AccessControl } from "../../target/types/access_control";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import * as fs from "fs";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";
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

function getSecretKeyPath(): string {
  const ENV = process.env.CLUSTER || 'devnet';
  const filename = ENV === 'mainnet' ? 'mainnet.json' : 'id.json';
  return path.resolve(process.env.HOME!, '.config/solana', filename);
}

async function main() {
  try {
    // Setup Provider and Programs
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Load admin keypair
    const secretKeyPath = getSecretKeyPath();
    const secretKeyString = fs.readFileSync(secretKeyPath, "utf8");
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log(`Initializing token accounts on ${ENV}`);
    console.log("Admin PublicKey:", admin.publicKey.toBase58());

    // Initialize programs
    const strategyProgram: Program<Strategy> = anchor.workspace.Strategy;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;

    // Get all configured assets for the environment
    const assets = CONFIG.mints.assets;
    const assetSymbols = Object.keys(assets);

    console.log(`Found ${assetSymbols.length} assets to initialize token accounts for:`, assetSymbols);

    // First, derive the vault PDA (using index 0 as in the init script)
    const vaultIndex = 0;
    const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        new anchor.BN(vaultIndex).toArrayLike(Buffer, 'le', 8)
      ],
      vaultProgram.programId
    );

    // Initialize token accounts for each asset and strategy
    for (let strategyIndex = 0; strategyIndex < assetSymbols.length; strategyIndex++) {
      const symbol = assetSymbols[strategyIndex];
      const assetConfig = assets[symbol];
      const assetMint = new PublicKey(assetConfig.address);

      // Derive strategy PDA for this index
      const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
        [vaultPDA.toBuffer(), 
          new anchor.BN(strategyIndex).toArrayLike(Buffer, 'le', 8)
        ],
        strategyProgram.programId
      );

      // Calculate token account PDA
      const [tokenAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("token_account"),
          assetMint.toBytes(),
          strategy.toBytes(),
        ],
        strategyProgram.programId
      );

      console.log(`\nInitializing token account for ${symbol} (Strategy ${strategyIndex})...`);
      console.log(`Strategy address: ${strategy.toBase58()}`);
      console.log(`Asset mint address: ${assetMint.toBase58()}`);
      console.log(`Token account address: ${tokenAccount.toBase58()}`);

      try {
        await strategyProgram.methods
          .initTokenAccount()
          .accounts({
            strategy: strategy,
            assetMint: assetMint,
            signer: admin.publicKey,
          })
          .signers([admin])
          .rpc();

        console.log(`✓ Token account initialized successfully for ${symbol} (Strategy ${strategyIndex})`);
      } catch (error) {
        console.error(`Error initializing token account for ${symbol} (Strategy ${strategyIndex}):`, error);
        // Continue with other assets even if one fails
      }
    }

    // Log final summary
    console.log("\nToken Account Initialization Summary:");
    console.log(`Total token accounts initialized: ${assetSymbols.length}`);
    console.log(`Strategy indices used: 0 to ${assetSymbols.length - 1}`);

  } catch (error) {
    console.error("Error occurred:", error);
    throw error;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});