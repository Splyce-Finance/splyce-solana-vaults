import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SimpleVault } from "../../target/types/simple_vault";
import { PublicKey, Keypair } from "@solana/web3.js";
import { BN } from "bn.js";

export async function initVault(
  program: Program<SimpleVault>,
) {
  // Generate a new keypair for the vault
  const vaultKeypair = Keypair.generate();

  try {
    // Initialize the vault
    const tx = await program.methods
      .initialize()
      .accounts({
      })
      .signers([])
      .rpc();

    console.log("Vault initialized successfully!");
    console.log("Vault address:", vaultKeypair.publicKey.toString());
    console.log("Transaction signature:", tx);

    return {
      vaultPubkey: vaultKeypair.publicKey,
      tx,
    };
  } catch (error) {
    console.error("Error initializing vault:", error);
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
  
  // Use provider's wallet as authority
  const authority = (provider.wallet as any).payer;
  
  // Initialize vault
  await initVault(program);
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
