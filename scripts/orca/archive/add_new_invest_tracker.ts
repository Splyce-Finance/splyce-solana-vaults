import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Strategy } from "../../target/types/strategy";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { AccessControl } from "../../target/types/access_control";
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from 'fs';
import * as path from 'path';
import { PublicKey } from "@solana/web3.js";
import * as dotenv from 'dotenv';

dotenv.config();

const ADDRESSES_FILE = path.join(__dirname, 'deployment_addresses', 'add_addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';
const CONFIG = ADDRESSES[ENV];

if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

const underlyingMint = new PublicKey(CONFIG.mints.underlying.address);

async function main() {
  try {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;

    // Load Admin Keypair
    const secretKeyPath = path.resolve(process.env.HOME, '.config/solana/id.json');
    const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log(`Initializing invest trackers on ${ENV}`);
    console.log("Admin Public Key:", admin.publicKey.toBase58());

    // Get the latest vault index from config
    const configPDA = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("CONFIG_SEED")],
      vaultProgram.programId
    )[0];
    
    const vaultConfig = await vaultProgram.account.config.fetch(configPDA);
    const vaultIndex = vaultConfig.nextVaultIndex.toNumber() - 1;
    
    if (vaultIndex < 0) {
      throw new Error("No vaults have been created yet");
    }

    console.log("Using latest Vault Index:", vaultIndex);

    // Calculate vault PDA
    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vaultIndex)]).buffer))
      ],
      vaultProgram.programId
    );
    console.log("Vault PDA:", vault.toBase58());

    // Calculate strategy PDA
    const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
      [vault.toBuffer(), 
        new BN(0).toArrayLike(Buffer, 'le', 8)
      ],
      strategyProgram.programId
    );
    console.log("Strategy PDA:", strategy.toBase58());

    // Verify admin has STRATEGIES_MANAGER role
    const [roles] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_role"),
        admin.publicKey.toBuffer(),
        Buffer.from([3]) // Role::StrategiesManager = 3
      ],
      accessControlProgram.programId
    );

    // Verify the role exists
    try {
      await accessControlProgram.account.userRole.fetch(roles);
    } catch (error) {
      throw new Error("Admin does not have STRATEGIES_MANAGER role");
    }

    // Get all configured assets
    const assets = CONFIG.mints.assets;
    const assetSymbols = Object.keys(assets);

    console.log(`Found ${assetSymbols.length} assets to initialize:`, assetSymbols);

    // Initialize invest trackers and token accounts for each asset
    for (const symbol of assetSymbols) {
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
        // First initialize token account for the asset
        console.log(`Initializing token account for ${symbol}...`);
        await strategyProgram.methods
          .initTokenAccount()
          .accounts({
            strategy,
            assetMint,
            signer: admin.publicKey,
          })
          .signers([admin])
          .rpc();
        console.log(`Token account initialized for ${symbol}`);

        // Then initialize invest tracker
        console.log(`Initializing invest tracker for ${symbol}...`);
        await strategyProgram.methods
          .initInvestTracker(
            a_to_b_for_purchase,
            assigned_weight_bps
          )
          .accounts({
            strategy,
            underlyingMint,
            assetMint,
            whirlpool,
            signer: admin.publicKey,
          })
          .signers([admin])
          .rpc();

        // Calculate invest tracker PDA for verification
        const [investTracker] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("invest_tracker"),
            assetMint.toBuffer(),
            strategy.toBuffer()
          ],
          strategyProgram.programId
        );

        // Verify the initialized invest tracker
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
        console.error(`Error initializing for ${symbol}:`, error);
        throw error;
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