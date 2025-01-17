import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AccessControl } from "../../target/types/access_control";
import { PublicKey } from "@solana/web3.js";
import * as fs from 'fs';
import * as path from 'path';
import { BN } from "@coral-xyz/anchor";
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Load deployment addresses
const ADDRESSES_FILE = path.join(__dirname, 'deployment_addresses', 'addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';
const CONFIG = ADDRESSES[ENV];

if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

const REPORT_BOT = new PublicKey(CONFIG.roles.report_bot);

function getSecretKeyPath(): string {
  const ENV = process.env.CLUSTER || 'devnet';
  const filename = ENV === 'mainnet' ? 'mainnet.json' : 'id.json';
  return path.resolve(process.env.HOME!, '.config/solana', filename);
}

async function main() {
  try {
    // Setup Provider and Program
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;

    // Load Admin Keypair
    const secretKeyPath = getSecretKeyPath();
    const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log(`Giving VAULTS_ADMIN role to REPORT_BOT on ${ENV}`);
    console.log("Admin Public Key:", admin.publicKey.toBase58());
    console.log("REPORT_BOT Public Key:", REPORT_BOT.toBase58());

    // Give VAULTS_ADMIN role to REPORT_BOT
    await accessControlProgram.methods.setRole(new BN(1), REPORT_BOT) // VAULTS_ADMIN role is 1
      .accounts({
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    
    console.log("VAULTS_ADMIN role successfully assigned to REPORT_BOT");

  } catch (error) {
    console.error("Error occurred:", error);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});