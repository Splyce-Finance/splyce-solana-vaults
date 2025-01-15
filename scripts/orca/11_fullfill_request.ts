import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { Strategy } from "../../target/types/strategy";
import { AccessControl } from "../../target/types/access_control";
import * as fs from "fs";
import * as path from "path";
import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import * as dotenv from 'dotenv';
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Accountant } from "../../target/types/accountant";

// Load environment variables
dotenv.config();

// Load deployment addresses based on environment
const ADDRESSES_FILE = path.join(__dirname, 'deployment_addresses', 'addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';
const CONFIG = ADDRESSES[ENV];

if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

// Load current tick arrays from file
const TICK_ARRAYS_FILE = path.join(__dirname, 'deployment_addresses', 'currentTickArrays.json');
const TICK_ARRAYS = JSON.parse(fs.readFileSync(TICK_ARRAYS_FILE, 'utf8'));

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

    // Load admin keypair
    const secretKeyPath = getSecretKeyPath();
    const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;
    const accountantProgram = anchor.workspace.Accountant as Program<Accountant>;

    // Get config PDA and data
    const [configPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      vaultProgram.programId
    );
    const configAccount = await vaultProgram.account.config.fetch(configPDA);
    
    // Get vault PDA
    const vaultIndex = 0;
    const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), new anchor.BN(vaultIndex).toArrayLike(Buffer, 'le', 8)],
      vaultProgram.programId
    );
    const vaultData = await vaultProgram.account.vault.fetch(vaultPDA);

    // Get latest withdraw request index from config
    const withdrawRequestIndex = configAccount.nextWithdrawRequestIndex.subn(1);

    // Get withdraw request PDA and data
    const [withdrawRequestPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("withdraw_request"),
        vaultPDA.toBuffer(),
        admin.publicKey.toBuffer(),
        new anchor.BN(withdrawRequestIndex).toArrayLike(Buffer, 'le', 8)
      ],
      vaultProgram.programId
    );

    console.log("Withdraw Request PDA:", withdrawRequestPDA.toString());

    //stranno
    const withdrawRequestData = await vaultProgram.account.withdrawRequest.fetch(withdrawRequestPDA);
    console.log("\nWithdraw Request Data:", {
      vault: withdrawRequestData.vault.toString(),
      user: withdrawRequestData.user.toString(),
      recipient: withdrawRequestData.recipient.toString(),
      sharesAccount: withdrawRequestData.sharesAccount.toString(),
      requested_amount: withdrawRequestData.requestedAmount.toString(),
      locked_shares: withdrawRequestData.lockedShares.toString(),
      max_loss: withdrawRequestData.maxLoss.toString(),
      fee_shares: withdrawRequestData.feeShares.toString(),
      index: withdrawRequestData.index.toString()
    });

    // Set compute unit limit
    const computeUnitIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 300_000,
    });

    // Calculate accountant PDA
    const accountant = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(0)]).buffer))
      ],
      accountantProgram.programId
    )[0];

    console.log("vault.data_underlying_mint", vaultData.underlyingMint.toString());

    // Call fulfill_withdrawal_request instruction
    await vaultProgram.methods
      .fulfillWithdrawalRequest()
      .accounts({
        withdrawRequest: withdrawRequestPDA,
        vault: vaultPDA,
        user: admin.publicKey,
        userTokenAccount: withdrawRequestData.recipient,
        underlyingMint: vaultData.underlyingMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        accountant: accountant,
      })
      .preInstructions([computeUnitIx])
      .rpc();

    console.log("Withdrawal request fulfilled successfully!");

    // Fetch updated balances using withdrawRequestData.recipient
    const recipientBalance = await provider.connection.getTokenAccountBalance(withdrawRequestData.recipient);
    console.log("\nRecipient's balance after withdrawal:", recipientBalance.value.uiAmount);

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
