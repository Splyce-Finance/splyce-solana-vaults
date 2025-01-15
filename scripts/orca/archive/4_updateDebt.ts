import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../../target/types/tokenized_vault";
import { Strategy } from "../../../target/types/strategy";
import { AccessControl } from "../../../target/types/access_control";
import { BN } from "@coral-xyz/anchor";
import * as token from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Constants from 3_deposit_update.ts
const METADATA_SEED = "metadata";
const TOKEN_METADATA_PROGRAM_ID = new anchor.web3.PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// Swap-related constants
const WHIRLPOOL_PROGRAM_ID = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
);
const WHIRLPOOL_ID = new PublicKey(
  "3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt"
);

// Token Mints
const USDC_MINT = new PublicKey(
  "BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k"
);

async function main() {
  try {
    // ============================
    // Setup Provider and Programs
    // ============================
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Load admin keypair
    const secretKeyPath = path.resolve(
      process.env.HOME!,
      ".config/solana/id.json"
    );
    const secretKeyString = fs.readFileSync(secretKeyPath, "utf8");
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log("Admin PublicKey:", admin.publicKey.toBase58());

    // Initialize programs
    const vaultProgram: Program<TokenizedVault> = anchor.workspace.TokenizedVault;
    const strategyProgram: Program<Strategy> = anchor.workspace.Strategy;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;

    console.log("Vault Program ID:", vaultProgram.programId.toBase58());
    console.log("Strategy Program ID:", strategyProgram.programId.toBase58());

    // ============================
    // Update Debt on the Orca Strategy
    // ============================
    console.log("Updating debt on the Orca Strategy...");

    const vault_index = 0;
    const updateAmount = new BN(10).mul(new BN(10).pow(new BN(6))); // Amount to update

    // Derive the vault PDA
    const [vaultPDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from("vault"),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vault_index)]).buffer))
      ],
      vaultProgram.programId
    );

    // Derive strategy PDA
    const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
      [vaultPDA.toBuffer(), 
        new BN(0).toArrayLike(Buffer, 'le', 8)
      ],
      strategyProgram.programId
    );

    console.log("Strategy address:", strategy.toString());

    // Derive strategy token account PDA
    const strategyTokenAccount = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("underlying"), strategy.toBuffer()],
      strategyProgram.programId,
    )[0];

    console.log("Strategy token account:", strategyTokenAccount.toBase58());

    // Verify strategy account
    try {
      const strategyAccountInfo = await provider.connection.getAccountInfo(strategy);
      if (!strategyAccountInfo) {
          throw new Error("Strategy account not found");
      }
      console.log("Strategy account exists with data length:", strategyAccountInfo.data.length);
      console.log("Strategy owner:", strategyAccountInfo.owner.toBase58());
  
      if (!strategyAccountInfo.owner.equals(strategyProgram.programId)) {
          throw new Error("Strategy account has incorrect owner");
      }
    } catch (error) {
        console.error("Error checking strategy account:", error);
        process.exit(1);
    }

    // Check initial balance
    const initialStrategyBalance = await provider.connection.getTokenAccountBalance(strategyTokenAccount);
    console.log("Strategy USDC balance before updating debt:", initialStrategyBalance.value.uiAmount);

    // Update debt
    await vaultProgram.methods
      .updateDebt(updateAmount)
      .accounts({
        vault: vaultPDA,
        strategy: strategy,
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log("Debt updated successfully.");

    // Check final balance
    const finalStrategyBalance = await provider.connection.getTokenAccountBalance(strategyTokenAccount);
    console.log("Strategy USDC balance after updating debt:", finalStrategyBalance.value.uiAmount);

  } catch (error) {
    console.error("Error occurred:", error);
    throw error;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});