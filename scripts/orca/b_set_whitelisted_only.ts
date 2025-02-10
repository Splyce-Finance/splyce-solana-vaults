import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
// import { SimpleVault } from "../../target/types/simple_vault";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";

export async function setWhitelistedOnly(
  program: Program<TokenizedVault>,
  vaultPubkey: PublicKey,
  whitelisted: boolean
) {
  try {
    // Fetch and log the vault state before update
    const vaultBefore = await program.account.vault.fetch(vaultPubkey);
    console.log("Vault state before update:");
    console.log("Current whitelisted_only flag:", vaultBefore.whitelistedOnly);

    // Call the instruction to update the whitelisted_only flag
    const tx = await program.methods
      .setWhitelistedOnly(whitelisted)
      .accounts({
        vault: vaultPubkey,
        signer: program.provider.publicKey,
      })
      .rpc();

    // Fetch and log the vault state after update
    const vaultAfter = await program.account.vault.fetch(vaultPubkey);
    console.log("\nVault state after update:");
    console.log("New whitelisted_only flag:", vaultAfter.whitelistedOnly);
    console.log("Transaction signature:", tx);

    return {
      tx,
      vaultBefore,
      vaultAfter,
    };
  } catch (error) {
    console.error("Error setting whitelisted_only flag:", error);
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

  // Set whitelisted_only flag to true (or false as needed)
  const newWhitelisted = false;
  await setWhitelistedOnly(program, vaultPubkey, newWhitelisted);
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
