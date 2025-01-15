import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Strategy } from "../../target/types/strategy";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { Accountant } from "../../target/types/accountant";
import { AccessControl } from "../../target/types/access_control";
import { BN } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";

// Load addresses configuration
const ADDRESSES_FILE = path.join(__dirname, 'deployment_addresses', 'addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';
const CONFIG = ADDRESSES[ENV];

interface AssetConfig {
  pool: {
    id: string;
  };
}

async function main() {
  try {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Load admin keypair
    const secretKeyPath = path.resolve(process.env.HOME!, ".config/solana/id.json");
    const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(secretKeyPath, 'utf8')));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    // Initialize Programs
    const tokenizedVaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;
    const accountantProgram = anchor.workspace.Accountant as Program<Accountant>;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;

    // Get vault PDA
    const vaultIndex = 0;
    const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), new BN(vaultIndex).toArrayLike(Buffer, 'le', 8)],
      tokenizedVaultProgram.programId
    );

    // Get accountant PDA and its token account
    const accountant = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from(new Uint8Array(new BigUint64Array([BigInt(0)]).buffer))],
      accountantProgram.programId
    )[0];

    // Get assets from config
    const assets = Object.entries(CONFIG.mints.assets);
    
    // Process each strategy
    for (const [symbol, assetConfig] of assets) {
      try {
        console.log(`\n=== Processing ${symbol} Strategy ===`);
        
        // Get strategy index
        const strategyIndex = assets.findIndex(([s]) => s === symbol);
        
        // Get strategy PDA
        const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
          [vaultPDA.toBuffer(), new BN(strategyIndex).toArrayLike(Buffer, 'le', 8)],
          strategyProgram.programId
        );

        // Get strategy data PDA
        const [strategyData] = PublicKey.findProgramAddressSync(
          [Buffer.from("strategy_data"), vaultPDA.toBuffer(), strategy.toBuffer()],
          tokenizedVaultProgram.programId
        );

        // Fetch states BEFORE process report
        const vaultBefore = await tokenizedVaultProgram.account.vault.fetch(vaultPDA);
        const strategyDataBefore = await tokenizedVaultProgram.account.strategyData.fetch(strategyData);
        
        console.log(`\nState BEFORE Process Report for ${symbol}:`);
        console.log("Strategy Data State:");
        console.log("- Current Debt:", strategyDataBefore.currentDebt.toString());
        console.log("- Max Debt:", strategyDataBefore.maxDebt.toString());
        console.log("- Last Update:", strategyDataBefore.lastUpdate.toString());

        // Get the  whirlpool ID for this strategy
        const whirlpoolId = new PublicKey((assetConfig as AssetConfig).pool.id);

        // Add whirlpool as remaining account
        const remainingAccounts = [
          { pubkey: whirlpoolId, isWritable: false, isSigner: false }
        ];

        // Call report
        await strategyProgram.methods
          .report()
          .accounts({
            strategy,
            signer: admin.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            underlyingMint: vaultBefore.underlyingMint,
          })
          .remainingAccounts(remainingAccounts)
          .signers([admin])
          .rpc();

        console.log(`\nReport completed for ${symbol} strategy`);

        // Get accountant's ATA for shares token
        const [sharesMint] = PublicKey.findProgramAddressSync(
          [Buffer.from("shares"), vaultPDA.toBuffer()],
          tokenizedVaultProgram.programId
        );

        const accountantRecipient = await getAssociatedTokenAddress(
          sharesMint,
          accountant,
          true
        );

        // Call process_report with only the necessary accounts
        await tokenizedVaultProgram.methods
          .processReport()
          .accounts({
            vault: vaultPDA,
            strategy,
            accountant: accountant,
            // accountantRecipient: accountantRecipient, //for some reason this shows read underline
          })
          .signers([admin])
          .rpc();

        console.log(`Process report completed for ${symbol} strategy`);

        // Fetch states AFTER process report
        const strategyDataAfter = await tokenizedVaultProgram.account.strategyData.fetch(strategyData);
        
        console.log(`\nState AFTER Process Report for ${symbol}:`);
        console.log("Strategy Data State:");
        console.log("- Current Debt:", strategyDataAfter.currentDebt.toString());
        console.log("- Max Debt:", strategyDataAfter.maxDebt.toString());
        console.log("- Last Update:", strategyDataAfter.lastUpdate.toString());

        // Calculate and log changes
        console.log(`\nChanges for ${symbol}:`);
        console.log("Strategy Data Changes:");
        console.log("- Current Debt Change:", 
          strategyDataAfter.currentDebt.sub(strategyDataBefore.currentDebt).toString());
        console.log("- Last Update Change:", 
          strategyDataAfter.lastUpdate.toNumber() - strategyDataBefore.lastUpdate.toNumber());
        
        console.log("\n------------------------");

      } catch (error) {
        console.error(`Error processing ${symbol} strategy:`, error);
        if (error.logs) {
          console.error("Error logs:", error.logs);
        }
      }
    }

    // Log final vault state after all strategies are processed
    const finalVaultState = await tokenizedVaultProgram.account.vault.fetch(vaultPDA);
    console.log("\n=== Final Vault State ===");
    console.log("- Total Debt:", finalVaultState.totalDebt.toString());
    console.log("- Total Shares:", finalVaultState.totalShares.toString());
    console.log("- Last Profit Update:", finalVaultState.lastProfitUpdate.toString());
    console.log("- Profit Unlocking Rate:", finalVaultState.profitUnlockingRate.toString());
    console.log("- Full Profit Unlock Date:", finalVaultState.fullProfitUnlockDate.toString());

  } catch (error) {
    console.error("Error occurred:", error);
    if (error.logs) {
      console.error("Error logs:", error.logs);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
