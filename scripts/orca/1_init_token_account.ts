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
const ADDRESSES_FILE = path.join(__dirname, 'deployment_addresses', 'abridged_10_assets_addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';
const CONFIG = ADDRESSES[ENV];

if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

async function main() {
  try {
    // Setup Provider and Programs
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Load admin keypair
    const secretKeyPath = path.resolve(
      process.env.HOME!,
      ".config/solana/mainnet.json"
    );
    const secretKeyString = fs.readFileSync(secretKeyPath, "utf8");
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log(`Initializing token accounts on ${ENV}`);
    console.log("Admin PublicKey:", admin.publicKey.toBase58());

    // Initialize programs
    const strategyProgram: Program<Strategy> = anchor.workspace.Strategy;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;

    console.log("Strategy Program ID:", strategyProgram.programId.toBase58());
    console.log("Access Control Program ID:", accessControlProgram.programId.toBase58());
    console.log("Vault Program ID:", vaultProgram.programId.toBase58());

    // Define vault index (matching with init script)
    const vaultIndex = 2; // third vault
    console.log("Using Vault Index:", vaultIndex);

    // Derive strategy PDA (using vaultIndex)
    const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        new anchor.BN(vaultIndex).toArrayLike(Buffer, 'le', 8)
      ],
      vaultProgram.programId
    );

    const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
      [vaultPDA.toBuffer(), 
        new anchor.BN(vaultIndex).toArrayLike(Buffer, 'le', 8)
      ],
      strategyProgram.programId
    );

    // Get all configured assets for the environment
    const assets = CONFIG.mints.assets;
    const assetSymbols = Object.keys(assets);

    console.log(`Found ${assetSymbols.length} assets to initialize:`, assetSymbols);

    // Initialize token accounts for each asset
    for (const symbol of assetSymbols.slice(0)) {
      const assetConfig = assets[symbol];
      const assetMint = new PublicKey(assetConfig.address);

      // Calculate token account PDA
      const [tokenAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("token_account"),
          assetMint.toBytes(),
          strategy.toBytes(),
        ],
        strategyProgram.programId
      );

      console.log(`\nInitializing token account for ${symbol}...`);
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

        console.log(`✓ Token account initialized successfully for ${symbol}`);
      } catch (error) {
        console.error(`Error initializing token account for ${symbol}:`, error);
        // Continue with other assets even if one fails
      }
    }

    console.log("\nToken account initialization complete!");

  } catch (error) {
    console.error("Error occurred:", error);
    throw error;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});