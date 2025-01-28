import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../../target/types/tokenized_vault";
import { Strategy } from "../../../target/types/strategy";
import { AccessControl } from "../../../target/types/access_control";
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as borsh from 'borsh';
import * as fs from 'fs';
import * as path from 'path';
import { PublicKey } from "@solana/web3.js";
import * as dotenv from 'dotenv';
import { OrcaStrategyConfig, OrcaStrategyConfigSchema } from "../../../tests/utils/schemas";

dotenv.config();

const ADDRESSES_FILE = path.join(__dirname, '..', 'deployment_addresses', 'add_addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';
const CONFIG = ADDRESSES[ENV];

if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

const underlyingMint = new PublicKey(CONFIG.mints.underlying.address);

// Add this function before main()
function getSecretKeyPath(): string {
  const ENV = process.env.CLUSTER || 'devnet';
  const filename = ENV === 'mainnet' ? 'mainnet.json' : 'id.json';
  return path.resolve(process.env.HOME!, '.config/solana', filename);
}

async function main() {
  try {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;

    // Update the admin keypair loading
    const secretKeyPath = getSecretKeyPath();
    const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log(`Removing strategy on ${ENV}`);
    console.log("Admin Public Key:", admin.publicKey.toBase58());
    console.log("Vault Program ID:", vaultProgram.programId.toBase58());

    // Get vault index (same as before)
    const vaultIndex = 2;
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

    // Define the strategy index you want to remove
    const strategyIndex = 8; // Change this to the strategy index you want to remove (3, 4, or 5)

    // Calculate strategy PDA
    const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
      [vault.toBuffer(), 
        new BN(strategyIndex).toArrayLike(Buffer, 'le', 8)
      ],
      strategyProgram.programId
    );
    console.log("Strategy to remove:", strategy.toBase58());

    // Calculate strategy data PDA
    const [strategyData] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_data"), vault.toBuffer(), strategy.toBuffer()],
      vaultProgram.programId
    );

    // Remove Strategy
    console.log("Removing Strategy...");
    await vaultProgram.methods.removeStrategy(strategy, true) 
      .accounts({
        vault,
        strategyData,
        signer: admin.publicKey,
        recipient: admin.publicKey, 
      })
      .signers([admin])
      .rpc();
    
    console.log("Strategy successfully removed");

  } catch (error) {
    console.error("Error occurred:", error);
    throw error;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}); 