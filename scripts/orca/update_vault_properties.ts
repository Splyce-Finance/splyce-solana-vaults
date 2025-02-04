import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  // Set up the provider and program
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Load admin keypair from file
  const secretKeyPath = path.resolve(process.env.HOME!, ".config/solana/id.json");
  const secretKeyString = fs.readFileSync(secretKeyPath, "utf8");
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
  const admin = web3.Keypair.fromSecretKey(secretKey);
  console.log("Admin Public Key:", admin.publicKey.toBase58());

  // Get the tokenized_vault program instance from the workspace
  const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;

  // Fetch the global config PDA to get the latest vault index.
  // (Assuming your global config uses the seed "config")
  const [configPDA] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    vaultProgram.programId
  );
  const config = await vaultProgram.account.config.fetch(configPDA);
  const vaultIndex = config.nextVaultIndex.toNumber() - 1;
  if (vaultIndex < 0) {
    throw new Error("No vault has been initialized yet.");
  }
  console.log("Latest Vault Index:", vaultIndex);

  // Derive the vault PDA using the vault index
  const vaultSeedBuffer = Buffer.from(
    new Uint8Array(new BigUint64Array([BigInt(vaultIndex)]).buffer)
  );
  const [vault] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), vaultSeedBuffer],
    vaultProgram.programId
  );
  console.log("Vault PDA:", vault.toBase58());

  // Fetch the current vault state for the two properties
  const vaultAccountBefore = await vaultProgram.account.vault.fetch(vault);
  console.log("Current Vault Properties:");
  console.log("  Direct Withdraw Enabled:", vaultAccountBefore.directWithdrawEnabled);
  console.log("  Whitelisted Only:", vaultAccountBefore.whitelistedOnly);

  // If direct withdraw enabled is true, update it to false
  if (vaultAccountBefore.directWithdrawEnabled) {
    console.log("Updating Direct Withdraw Enabled to false...");
    await vaultProgram.methods
      .setDirectWithdrawEnabled(false)
      .accounts({
        vault: vault,
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Direct Withdraw Enabled has been set to false.");
  } else {
    console.log("Direct Withdraw Enabled is already false.");
  }

  // If whitelisted only is true, update it to false
  if (vaultAccountBefore.whitelistedOnly) {
    console.log("Updating Whitelisted Only to false...");
    await vaultProgram.methods
      .setWhitelistedOnly(false)
      .accounts({
        vault: vault,
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Whitelisted Only has been set to false.");
  } else {
    console.log("Whitelisted Only is already false.");
  }

  // Fetch the updated vault state to log the final properties
  const vaultAccountAfter = await vaultProgram.account.vault.fetch(vault);
  console.log("Updated Vault Properties:");
  console.log("  Direct Withdraw Enabled:", vaultAccountAfter.directWithdrawEnabled);
  console.log("  Whitelisted Only:", vaultAccountAfter.whitelistedOnly);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}); 