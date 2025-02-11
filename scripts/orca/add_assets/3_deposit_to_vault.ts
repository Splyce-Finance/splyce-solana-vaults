import * as dotenv from 'dotenv';
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../../target/types/tokenized_vault";
import { AccessControl } from "../../../target/types/access_control";
import { BN } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  createAssociatedTokenAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { Accountant } from "../../../target/types/accountant";
import * as token from "@solana/spl-token";

// Load config
dotenv.config();
// const ADDRESSES_FILE = path.join(__dirname, '../deployment_addresses', 'addresses.json');
const ADDRESSES_FILE = path.join(__dirname, '..', 'deployment_addresses', 'share_price_test.json');

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
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Load admin keypair
    const secretKeyPath = getSecretKeyPath();
    const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log("Admin PublicKey:", admin.publicKey.toBase58());

    // Initialize programs
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const accountantProgram = anchor.workspace.Accountant as Program<Accountant>;

    const depositAmount = new BN(11_000_000); // 6 USDC
    const vaultIndex = 1;
    const accountantIndex = 0;

    // Derive vault PDA
    const [vault] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        new BN(vaultIndex).toArrayLike(Buffer, 'le', 8)
      ],
      vaultProgram.programId
    );

    console.log("Vault:", vault.toBase58());

    // Derive accountant PDA
    const [accountant] = PublicKey.findProgramAddressSync(
      [new BN(accountantIndex).toArrayLike(Buffer, 'le', 8)],
      accountantProgram.programId
    );

    console.log("Accountant:", accountant.toBase58());

    // Derive shares mint
    const [sharesMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("shares"), vault.toBuffer()],
      vaultProgram.programId
    );

    // Get the user's ATA for shares
    const userSharesAccount = await getAssociatedTokenAddress(
      sharesMint,
      admin.publicKey
    );

    // Check if the ATA exists
    try {
      const balance = await provider.connection.getTokenAccountBalance(userSharesAccount);
      console.log("Existing shares account found");
    } catch (e) {
      console.log("Creating user shares token account...");
      await createAssociatedTokenAccount(
        provider.connection,
        admin,
        sharesMint,
        admin.publicKey,
        undefined,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      console.log("Created user shares token account");
    }

    // Get user's token accounts
    const userTokenAccount = await getAssociatedTokenAddress(
      underlyingMint,
      admin.publicKey
    );

    // console.log("User shares account:", userSharesAccount.toString());

    // Log initial balances
    // const initialBalances = {
    //   userUsdc: await provider.connection.getTokenAccountBalance(userTokenAccount),
    //   userShares: await provider.connection.getTokenAccountBalance(userSharesAccount),
    // };

    // console.log("\nInitial Balances:");
    // console.log("User USDC:", initialBalances.userUsdc.value.uiAmount);
    // console.log("User Shares:", initialBalances.userShares.value.uiAmount);

    // Execute deposit
    await vaultProgram.methods
      .deposit(depositAmount)
      .accounts({
        vault,
        accountant,
        userTokenAccount,
        underlyingMint,
        userSharesAccount: userSharesAccount,
        user: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    console.log("\nDeposit transaction executed successfully");
    console.log(`Deposit amount: ${depositAmount.toString()}`);

    // Log final balances
    // const finalBalances = {
    //   userUsdc: await provider.connection.getTokenAccountBalance(userTokenAccount),
    //   userShares: await provider.connection.getTokenAccountBalance(userSharesAccount),
    // };

    // console.log("\nFinal Balances:");
    // console.log("User USDC:", finalBalances.userUsdc.value.uiAmount);
    // console.log("User Shares:", finalBalances.userShares.value.uiAmount);

    // console.log("\nBalance Changes:");
    // console.log("User USDC:", finalBalances.userUsdc.value.uiAmount! - initialBalances.userUsdc.value.uiAmount!);
    // console.log("User Shares:", finalBalances.userShares.value.uiAmount! - initialBalances.userShares.value.uiAmount!);

  } catch (error) {
    console.error("Error occurred:", error);
    if ('logs' in error) {
      console.error("Program Logs:", error.logs);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
