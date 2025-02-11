import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Strategy } from "../../target/types/strategy";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { BN } from "@coral-xyz/anchor";
import * as fs from 'fs';
import * as path from 'path';
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
        // Setup provider and program
        const provider = anchor.AnchorProvider.env();
        anchor.setProvider(provider);

        const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;
        const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;

        // Load admin keypair based on environment
        const secretKeyPath = getSecretKeyPath();
        const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
        const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
        const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

        console.log(`Setting strategy total assets on ${ENV}`);
        console.log("Admin Public Key:", admin.publicKey.toBase58());

        // Define vault and strategy indices
        const vaultIndex = 1; // Adjust as needed
        const strategyIndex = 5; // Adjust as needed (3 for SOL, 4 for USDT, 5 for SAMO)

        // Calculate vault PDA using vaultProgram.programId
        const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
            [
                Buffer.from("vault"),
                Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vaultIndex)]).buffer))
            ],
            vaultProgram.programId
        );

        // Calculate strategy PDA
        const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
            [
                vault.toBuffer(),
                new BN(strategyIndex).toArrayLike(Buffer, 'le', 8)
            ],
            strategyProgram.programId
        );

        console.log("Vault PDA:", vault.toBase58());
        console.log("Strategy PDA:", strategy.toBase58());

        // Set the total assets value (adjust as needed)
        // const totalAssets = new BN(3709991).mul(new BN(2)); // 1 USDC with 6 decimals
        const totalAssets = new BN(3709991); // 1 USDC with 6 decimals

        // Call set_total_assets instruction
        const tx = await strategyProgram.methods
            .setTotalAssets(totalAssets)
            .accounts({
                strategy: strategy,
                signer: admin.publicKey,
            })
            .signers([admin])
            .rpc();

        console.log(`Successfully set total assets to ${totalAssets.toString()}`);
        console.log("Transaction signature:", tx);

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