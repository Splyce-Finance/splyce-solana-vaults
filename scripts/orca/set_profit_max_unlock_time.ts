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
        console.log("Vault Program:", vaultProgram.programId.toBase58());
        console.log("Access Control Program:", accessControlProgram.programId.toBase58());
        // Load admin keypair based on environment
        const secretKeyPath = getSecretKeyPath();
        const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
        const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
        const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

        // Get vault PDA
        const vaultIndex = 1;
        const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
            [
                Buffer.from("vault"),
                Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vaultIndex)]).buffer))
            ],
            vaultProgram.programId
        );
        console.log("Vault address:", vault.toBase58());

        // Fetch vault data before setting profit_max_unlock_time
        const vaultDataBefore = await vaultProgram.account.vault.fetch(vault);
        console.log("\nBefore setting profit_max_unlock_time:");
        console.log("profit_max_unlock_time:", vaultDataBefore.profitMaxUnlockTime);

        // Call set_whitelisted_only
        console.log("\nSetting profit_max_unlock_time...");
        await vaultProgram.methods
            .setProfitMaxUnlockTime(new BN(0))
            .accounts({
                vault,
                signer: admin.publicKey,
            })
            .signers([admin])
            .rpc();

        // Fetch vault data after setting whitelisted_only
        const vaultDataAfter = await vaultProgram.account.vault.fetch(vault);
        console.log("\nAfter setting profit_max_unlock_time:");
        console.log("profit_max_unlock_time:", vaultDataAfter.profitMaxUnlockTime);

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