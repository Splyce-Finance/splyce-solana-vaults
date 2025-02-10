import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
// import { SimpleVault } from "../../target/types/simple_vault";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";

/**
 * Updates the "directWithdrawEnabled" flag on the vault.
 *
 * @param program - The TokenizedVault program client.
 * @param vaultPubkey - The public key of the vault.
 * @param directWithdrawEnabled - The new value to set for directWithdrawEnabled.
 */
export async function setDirectWithdrawEnabled(
  program: Program<TokenizedVault>,
  vaultPubkey: PublicKey,
  directWithdrawEnabled: boolean
) {
  try {
    // Fetch and log the vault state before update
    const vaultBefore = await program.account.vault.fetch(vaultPubkey);
    console.log("Vault state before update:");
    console.log("Current directWithdrawEnabled flag:", vaultBefore.directWithdrawEnabled);

    // Call the instruction to update the directWithdrawEnabled flag
    const tx = await program.methods
      .setDirectWithdrawEnabled(directWithdrawEnabled)
      .accounts({
        vault: vaultPubkey,
        signer: program.provider.publicKey,
      })
      .rpc();

    // Fetch and log the vault state after update
    const vaultAfter = await program.account.vault.fetch(vaultPubkey);
    console.log("\nVault state after update:");
    console.log("New directWithdrawEnabled flag:", vaultAfter.directWithdrawEnabled);
    console.log("Transaction signature:", tx);

    return {
      tx,
      vaultBefore,
      vaultAfter,
    };
  } catch (error) {
    console.error("Error setting directWithdrawEnabled flag:", error);
    throw error;
  }
}

// Example usage in main function
async function main() {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Generate the program client for tokenized_vault
  const program = anchor.workspace.TokenizedVault as Program<TokenizedVault>;

  // Calculate the vault PDA using a vault index (adjust the index as required)
  const vaultIndex = 0;
  const vaultPubkey = PublicKey.findProgramAddressSync(
    [
      Buffer.from("vault"),
      Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vaultIndex)]).buffer))
    ],
    program.programId
  )[0];

  // Set directWithdrawEnabled flag to true (or false as needed)
  const newDirectWithdrawEnabled = false;
  await setDirectWithdrawEnabled(program, vaultPubkey, newDirectWithdrawEnabled);
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
