import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Strategy } from "../../target/types/strategy";
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

    console.log(`Initializing invest trackers on ${ENV}`);
    console.log("Admin PublicKey:", admin.publicKey.toBase58());

    // Initialize programs
    const strategyProgram: Program<Strategy> = anchor.workspace.Strategy;
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;

    console.log("Strategy Program ID:", strategyProgram.programId.toBase58());
    console.log("Vault Program ID:", vaultProgram.programId.toBase58());

    // Get underlying mint
    const underlyingMint = new PublicKey(CONFIG.mints.underlying.address);

    // Define vault index (matching with init script)
    const vaultIndex = 2; // third vault
    console.log("Using Vault Index:", vaultIndex);

    // Derive strategy PDA using vaultIndex
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

    console.log(`Found ${assetSymbols.length} assets to initialize invest trackers for:`, assetSymbols);

    // Initialize invest trackers for each asset
    for (const symbol of assetSymbols.slice(9)) {
      const assetConfig = assets[symbol];
      const assetMint = new PublicKey(assetConfig.address);
      const whirlpool = new PublicKey(assetConfig.pool.id);
      const { a_to_b_for_purchase, assigned_weight_bps } = assetConfig.investment_config;

      console.log(`\nInitializing invest tracker for ${symbol}...`);
      console.log(`Asset mint: ${assetMint.toBase58()}`);
      console.log(`Whirlpool: ${whirlpool.toBase58()}`);
      console.log(`A to B for purchase: ${a_to_b_for_purchase}`);
      console.log(`Assigned weight (bps): ${assigned_weight_bps}`);

      try {
        // Calculate invest tracker PDA for verification
        const [investTracker] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("invest_tracker"),
            assetMint.toBuffer(),
            strategy.toBuffer()
          ],
          strategyProgram.programId
        );

        console.log(`${symbol} Invest Tracker PDA:`, investTracker.toBase58());

        // Initialize invest tracker
        await strategyProgram.methods
          .initInvestTracker(
            a_to_b_for_purchase,
            assigned_weight_bps
          )
          .accounts({
            strategy: strategy,
            underlyingMint: underlyingMint,
            assetMint: assetMint,
            whirlpool: whirlpool,
            signer: admin.publicKey,
          })
          .signers([admin])
          .rpc();

        // Fetch and verify the initialized invest tracker
        const trackerAccount = await strategyProgram.account.investTracker.fetch(
          investTracker
        );

        console.log(`✓ Invest tracker initialized successfully for ${symbol}`);
        console.log("Invest Tracker Data:", {
          whirlpoolId: trackerAccount.whirlpoolId.toString(),
          assetMint: trackerAccount.assetMint.toString(),
          amountInvested: trackerAccount.amountInvested.toString(),
          amountWithdrawn: trackerAccount.amountWithdrawn.toString(),
          assetAmount: trackerAccount.assetAmount.toString(),
          assetPrice: trackerAccount.assetPrice.toString(),
          sqrtPrice: trackerAccount.sqrtPrice.toString(),
          assetValue: trackerAccount.assetValue.toString(),
          assetDecimals: trackerAccount.assetDecimals,
          underlyingDecimals: trackerAccount.underlyingDecimals,
          aToBForPurchase: trackerAccount.aToBForPurchase,
          assignedWeight: trackerAccount.assignedWeight,
          currentWeight: trackerAccount.currentWeight
        });

      } catch (error) {
        console.error(`Error initializing invest tracker for ${symbol}:`, error);
        if ('logs' in error) {
          console.error("Program Logs:", error.logs);
        }
        throw error; // Stop execution if any asset fails
      }
    }

    console.log("\nAll invest trackers initialized successfully!");

  } catch (error) {
    console.error("Error occurred:", error);
    throw error;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});