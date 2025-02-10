import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { BN } from "@coral-xyz/anchor";
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { strategyProgram } from "../../tests/integration/setups/globalSetup";

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

// Address to transfer management to
const NEW_MANAGER = new anchor.web3.PublicKey("HMcuvAp4dB1EePEBcQHVAprVxpqWaJKBviJgGa8k3ZFF"); //devnet report bot
// const NEW_MANAGER = new anchor.web3.PublicKey("JE1GQhjSiam5TckzWcUu6CHERM3ELfmsVcfd6VJvj6wv"); //mainnet report bot

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

        // Load admin keypair based on environment
        const secretKeyPath = getSecretKeyPath();
        const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
        const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
        const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

        console.log(`Transferring management on ${ENV}`);
        console.log("Admin Public Key:", admin.publicKey.toBase58());
        console.log("New manager address:", NEW_MANAGER.toBase58());

        // Calculate vault PDA (using index 0 as default)
        const vaultIndex = 0;
        const strategyIndex = 2; // WIF strategy index

        const vault = anchor.web3.PublicKey.findProgramAddressSync(
            [
                Buffer.from("vault"),
                Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vaultIndex)]).buffer))
            ],
            vaultProgram.programId
        )[0];
        console.log("Vault PDA:", vault.toBase58());

        // Calculate strategy PDA using vault PDA as seed
        const strategy = anchor.web3.PublicKey.findProgramAddressSync(
            [
                vault.toBuffer(),
                new BN(strategyIndex).toArrayLike(Buffer, 'le', 8)
            ],
            strategyProgram.programId
        )[0];
        console.log("Strategy PDA:", strategy.toBase58());

        // Transfer management
        await strategyProgram.methods.transferManagement(NEW_MANAGER)
            .accounts({
                strategy: strategy,
                signer: admin.publicKey,
            })
            .signers([admin])
            .rpc();

        console.log(`Successfully transferred management to: ${NEW_MANAGER.toBase58()}`);

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