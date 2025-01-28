import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { BN } from "@coral-xyz/anchor";
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { AccessControl } from "../../target/types/access_control";

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

// Address to be whitelisted
// const ADDRESS_TO_WHITELIST = new anchor.web3.PublicKey("FJ2B6DtzYXbk6mQhQATGV9d9fb9htasvMmnUCSbSvpW9");

// const ADDRESS_TO_WHITELIST = new anchor.web3.PublicKey("F7FLF8hrNk1p493dCjHHVoQJBqfzXVk917BvfAj5r4yJ");
// const ADDRESS_TO_WHITELIST = new anchor.web3.PublicKey("2fAy3iYztUAoXx6TzKZXYc1h862NL4J6XN5ShYb4sUu8"); 
const ADDRESS_TO_WHITELIST = new anchor.web3.PublicKey("5mBKbBdkLteZ1vMtBhzagKqYAWMBzUKPaNfANADyQc13"); 


function getSecretKeyPath(): string {
  const ENV = process.env.CLUSTER || 'devnet';
  const filename = ENV === 'mainnet' ? 'mainnet.json' : 'id.json';
  return path.resolve(process.env.HOME!, '.config/solana', filename);
}

async function main() {
    try {
        // Setup provider and program
        const provider = anchor.AnchorProvider.env();
        anchor.setProvider(provider);

        const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
        const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;

        // Load admin keypair based on environment
        const secretKeyPath = getSecretKeyPath();
        const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
        const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
        const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

        console.log(`Setting minimum user deposit on ${ENV}`);
        console.log("Admin Public Key:", admin.publicKey.toBase58());
        console.log("Address to whitelist:", ADDRESS_TO_WHITELIST.toBase58());

        // Calculate roles PDA (VaultsAdmin role)
        const [roles] = anchor.web3.PublicKey.findProgramAddressSync(
            [
                Buffer.from("user_role"),
                admin.publicKey.toBuffer(),
                Buffer.from([1]) // Role::VaultsAdmin = 1
            ],
            accessControlProgram.programId
        );

        // Calculate vault PDA (using index 0 as default)
        const vaultIndex = 2; // Update this to target specific vault
        const vault = anchor.web3.PublicKey.findProgramAddressSync(
            [
                Buffer.from("vault"),
                Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vaultIndex)]).buffer))
            ],
            vaultProgram.programId
        )[0];

        // Get min user deposit value from config
        const minUserDeposit = new BN(1000000);

        // Call set_min_user_deposit instruction
        await vaultProgram.methods.setMinUserDeposit(minUserDeposit)
            .accounts({
                vault: vault,
                signer: admin.publicKey,
            })
            .signers([admin])
            .rpc();

        console.log(`Successfully set minimum user deposit to ${minUserDeposit.toString()}`);

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