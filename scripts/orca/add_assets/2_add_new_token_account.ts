import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Strategy } from "../../../target/types/strategy";
import { TokenizedVault } from "../../../target/types/tokenized_vault";
import { AccessControl } from "../../../target/types/access_control";
import { BN } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";
import * as dotenv from 'dotenv';

dotenv.config();

// const ADDRESSES_FILE = path.join(__dirname, '..', 'deployment_addresses', 'add_addresses.json');
// const ADDRESSES_FILE = path.join(__dirname, '..', 'deployment_addresses', 'addresses.json');
const ADDRESSES_FILE = path.join(__dirname, '..', 'deployment_addresses', 'share_price_test.json');

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
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;

    // Update admin keypair loading to use environment-based path
    const secretKeyPath = getSecretKeyPath();
    const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
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
    const vaultIndex = 1;  // Hardcoded to match other scripts
    
    if (vaultIndex < 0) {
      throw new Error("No vaults have been created yet");
    }

    console.log("Using Vault Index:", vaultIndex);

    // Calculate vault PDA
    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vaultIndex)]).buffer))
      ],
      vaultProgram.programId
    );
    console.log("Vault PDA:", vault.toBase58());

    // Define the fixed order of assets for mainnet with their corresponding indices
    // strategy indices for vaultIndex = 1
    // const assets = [
    //   { name: "wBTC", index: 3 },
    //   { name: "whETH", index: 4 },
    //   { name: "SOL", index: 5 }
    // ];

    // strategy indices for vaultIndex = 2
    // const assets = [
    //   { name: "wBTC", index: 7 },
    //   { name: "whETH", index: 13 },
    //   { name: "SOL", index: 9 }
    // ];

    // // strategy indices for vaultIndex = 3
    // const assets = [
    //   { name: "BONK", index: 10 },
    //   { name: "PENGU", index: 11 },
    //   { name: "WIF", index: 12 }
    // ];
    
    const assets = [
      { name: "SOL", index: 3 },
      { name: "USDT", index: 4 },
      { name: "SAMO", index: 5 }
    ];

    // Specify which asset to initialize
    const assetToInitialize = assets[2]; // Change index to 0, 1, or 2 to select wBTC, whETH, or SOL
    const assetName = assetToInitialize.name;
    const strategyIndex = assetToInitialize.index;
    
    console.log(`Initializing token account for ${assetName} (strategy index: ${strategyIndex})...`);

    // Calculate strategy PDA using the specific index (3, 4, or 5)
    const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
      [vault.toBuffer(), 
        new BN(strategyIndex).toArrayLike(Buffer, 'le', 8)
      ],
      strategyProgram.programId
    );
    console.log("Strategy PDA:", strategy.toBase58());

    // Get asset configuration
    if (!CONFIG.mints.assets[assetName]) {
      throw new Error(`Asset ${assetName} not found in config`);
    }

    const assetConfig = CONFIG.mints.assets[assetName];
    const assetMint = new PublicKey(assetConfig.address);

    console.log(`Initializing token account for ${assetName}...`);
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

      console.log(`✓ Token account initialized successfully for ${assetName}`);
    } catch (error) {
      console.error(`Error initializing token account for ${assetName}:`, error);
      throw error;
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