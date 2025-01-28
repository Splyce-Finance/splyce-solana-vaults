import * as dotenv from 'dotenv';
dotenv.config();
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { Strategy } from "../../target/types/strategy";
import { AccessControl } from "../../target/types/access_control";
import * as fs from "fs";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import * as path from "path";
import { Accountant } from "../../target/types/accountant";

const ADDRESSES_FILE = path.join(__dirname, 'deployment_addresses', 'addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';
const CONFIG = ADDRESSES[ENV];

if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

const underlyingMint = new PublicKey(CONFIG.mints.underlying.address);

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
    const accountantProgram = anchor.workspace.Accountant as Program<Accountant>;


    // Replace admin keypair loading with new approach
    const secretKeyPath = getSecretKeyPath();
    const secretKeyString = fs.readFileSync(secretKeyPath, "utf8");
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    // Add vault index
    const vaultIndex = 0;

    // Update vault PDA derivation to include index
    const [vault] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        new anchor.BN(vaultIndex).toArrayLike(Buffer, 'le', 8)
      ],
      vaultProgram.programId
    );

    // Get shares mint PDA
    const [sharesMint] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("shares"),
        vault.toBuffer()
      ],
      vaultProgram.programId
    );

    // Get user's shares token account
    const userSharesATA = await getAssociatedTokenAddress(
      sharesMint,
      admin.publicKey
    );

    // Get withdraw shares token account
    const [withdrawSharesAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("withdraw_shares_account"),
        vault.toBuffer()
      ],
      vaultProgram.programId
    );

    const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(new Uint8Array(new BigUint64Array([BigInt(0)]).buffer))
        ],
        accountantProgram.programId
      )[0];

    // Get current shares balance
    // const userSharesBalance = await provider.connection.getTokenAccountBalance(userSharesATA);
    // console.log("Current shares balance:", userSharesBalance.value.uiAmount);

    // Request withdrawal of all shares
    // const withdrawAmount = userSharesBalance.value.amount;
    // console.log("Requesting withdrawal of", withdrawAmount, "shares");

    // Get withdraw request PDA
    const [withdrawRequest] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("withdraw_request"),
        vault.toBuffer(),
        admin.publicKey.toBuffer(),
        new anchor.BN(0).toArrayLike(Buffer, 'le', 8) // index 0
      ],
      vaultProgram.programId
    );

    console.log("Withdraw request:", withdrawRequest.toBase58());

    // Get user's underlying token account
    const userTokenAccount = await getAssociatedTokenAddress(
      underlyingMint,
      admin.publicKey
    );

    const withdrawAmount = new anchor.BN(2000000);
    await vaultProgram.methods
      .requestWithdraw(new anchor.BN(withdrawAmount), new anchor.BN(8000))
      .accounts({
        vault: vault,
        userSharesAccount: userSharesATA,
        userTokenAccount: userTokenAccount,
        accountant: accountant,
      })
      .signers([admin])
      .rpc();

    // console.log("Withdrawal request submitted successfully");

    // Fetch and log withdraw request data
    const withdrawRequestData = await vaultProgram.account.withdrawRequest.fetch(withdrawRequest);
    // console.log("\nWithdraw Request Data:");
    // console.log({
    //   vault: withdrawRequestData.vault.toString(),
    //   user: withdrawRequestData.user.toString(),
    //   recipient: withdrawRequestData.recipient.toString(),
    //   sharesAccount: withdrawRequestData.sharesAccount.toString(),
    //   requestedAmount: withdrawRequestData.requestedAmount.toString(),
    //   lockedShares: withdrawRequestData.lockedShares.toString(),
    //   maxLoss: withdrawRequestData.maxLoss.toString(),
    //   feeShares: withdrawRequestData.feeShares.toString(),
    //   index: withdrawRequestData.index.toString()
    // });

    // Get final balances
    const finalSharesBalance = await provider.connection.getTokenAccountBalance(userSharesATA);
    const withdrawSharesBalance = await provider.connection.getTokenAccountBalance(withdrawSharesAccount);

    // console.log("\nFinal Balances:");
    // console.log("User Shares:", finalSharesBalance.value.uiAmount);
    // console.log("Withdraw Shares Account:", withdrawSharesBalance.value.uiAmount);

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
