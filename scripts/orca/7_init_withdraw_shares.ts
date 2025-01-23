import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { Strategy } from "../../target/types/strategy";
import { AccessControl } from "../../target/types/access_control";
import * as fs from "fs";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";

function getSecretKeyPath(): string {
  const ENV = process.env.CLUSTER || 'devnet';
  const filename = ENV === 'mainnet' ? 'mainnet.json' : 'id.json';
  return path.resolve(process.env.HOME!, '.config/solana', filename);
}

async function main() {
  try {
    // Setup Provider and Programs
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;

    // Load admin keypair
    const secretKeyPath = getSecretKeyPath();
    const secretKeyString = fs.readFileSync(secretKeyPath, "utf8");
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);
    const vaultIndex = 0;
    // Derive vault PDA
    const [vault] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        new BN(vaultIndex).toArrayLike(Buffer, 'le', 8)
      ],
      vaultProgram.programId
    );

    // Initialize withdraw shares account
    console.log("Initializing withdraw shares account...");
    
    await vaultProgram.methods
      .initWithdrawSharesAccount()
      .accounts({
        vault: vault,
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log("Withdraw shares account initialized successfully");

  } catch (error) {
    console.error("Error occurred:", error);
    if ('logs' in error) {
      console.error("Program Logs:", error.logs);
    }
    throw error;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
