import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Strategy } from "../../target/types/strategy";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { AccessControl } from "../../target/types/access_control";
import { BN } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
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

async function main() {
  try {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;

    // Load admin keypair
    const secretKeyPath = path.resolve(
      process.env.HOME!,
      ".config/solana/id.json"
    );
    const secretKeyString = fs.readFileSync(secretKeyPath, "utf8");
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log(`Initializing token accounts on ${ENV}`);
    console.log("Admin PublicKey:", admin.publicKey.toBase58());

    // Get the latest vault index from config
    const configPDA = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
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

    // Initialize token accounts for each asset
    for (const symbol of assetSymbols) {
      const assetConfig = assets[symbol];
      const assetMint = new PublicKey(assetConfig.address);

      console.log(`\nInitializing token account for ${symbol}...`);
      console.log(`Asset mint address: ${assetMint.toBase58()}`);

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
        throw error;
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