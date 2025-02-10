import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
// import { SimpleVault } from "../../target/types/simple_vault";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";

export async function setDepositLimit(
  program: Program<TokenizedVault>,
  vaultPubkey: PublicKey,
  newLimit: number
) {
  try {
    // Fetch and log the vault state before update
    const vaultBefore = await program.account.vault.fetch(vaultPubkey);
    console.log("Vault state before update:");
    console.log("Current user deposit limit:", vaultBefore.userDepositLimit.toString());
    // Set new deposit limit
    const tx = await program.methods
      .setUserDepositLimit(new BN(newLimit))
      .accounts({
        vault: vaultPubkey,
        signer: program.provider.publicKey,
      })
      .rpc();

    // Fetch and log the vault state after update
    const vaultAfter = await program.account.vault.fetch(vaultPubkey);
    console.log("\nVault state after update:");
    console.log("New deposit limit:", vaultAfter.depositLimit.toString());
    console.log("Transaction signature:", tx);

    return {
      tx,
      vaultBefore,
      vaultAfter,
    };
  } catch (error) {
    console.error("Error setting deposit limit:", error);
    throw error;
  }
}

// Example usage in main function
async function main() {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Generate the program client
  const program = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
  
  // Calculate the vault PDA using a vault index, following the approach in 0_init_orca_strategy.ts
  const vaultIndex = 0; // Adjust this index as required
  const vaultPubkey = PublicKey.findProgramAddressSync(
    [
      Buffer.from("vault"),
      Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vaultIndex)]).buffer))
    ],
    program.programId
  )[0];

  // Set deposit limit to 100 tokens
  const newLimit = 3000000000000;
  await setDepositLimit(program, vaultPubkey, newLimit);
}

// Run main if this script is run directly
if (require.main === module) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error);
      process.exit(1);
    }
  );
}
