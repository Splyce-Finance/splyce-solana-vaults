import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SimpleVault } from "../../target/types/simple_vault";
import { PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";

export async function setDepositLimit(
  program: Program<SimpleVault>,
  vaultPubkey: PublicKey,
  newLimit: number
) {
  try {
    // Fetch and log the vault state before update
    const vaultBefore = await program.account.vault.fetch(vaultPubkey);
    console.log("Vault state before update:");
    console.log("Current deposit limit:", vaultBefore.depositLimit.toString());

    // Set new deposit limit
    const tx = await program.methods
      .setDepositLimit(new BN(newLimit))
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
  const program = anchor.workspace.SimpleVault as Program<SimpleVault>;
  
  // Get the vault PDA
  const [vaultPubkey] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );

  // Set deposit limit to 1000 tokens
  const newLimit = 100;
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
