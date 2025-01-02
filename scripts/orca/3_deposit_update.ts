import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { Strategy } from "../../target/types/strategy";
import { AccessControl } from "../../target/types/access_control";
import { OrcaStrategyConfig, OrcaStrategyConfigSchema } from "../../tests/utils/schemas";
import { BN } from "@coral-xyz/anchor";
import * as token from "@solana/spl-token";
import * as borsh from "borsh";
import * as fs from "fs";
import * as path from "path";
import { PublicKey, Keypair, Transaction, Connection, SystemProgram} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as dotenv from 'dotenv';

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

// Constants
const METADATA_SEED = "metadata";
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(CONFIG.programs.token_metadata_program);

// Get program IDs and mints from config
const WHIRLPOOL_PROGRAM_ID = new PublicKey(CONFIG.programs.whirlpool_program);
const UNDERLYING_MINT = new PublicKey(CONFIG.mints.underlying.address);

async function main() {
  try {
    // ============================
    // Setup Provider and Programs
    // ============================
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Load admin keypair
    const secretKeyPath = path.resolve(
      process.env.HOME!,
      ".config/solana/mainnet.json"
    );
    const secretKeyString = fs.readFileSync(secretKeyPath, "utf8");
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    // Initialize programs
    const vaultProgram: Program<TokenizedVault> = anchor.workspace.TokenizedVault;
    const strategyProgram: Program<Strategy> = anchor.workspace.Strategy;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;

    console.log("Vault Program ID:", vaultProgram.programId.toBase58());
    console.log("Strategy Program ID:", strategyProgram.programId.toBase58());
    console.log("Access Control Program ID:", accessControlProgram.programId.toBase58());

    // ============================
    // Deposit USDC to the Vault
    // ============================
    console.log("Depositing USDC to the Vault...");

    const depositAmount = new BN(1).mul(new BN(10).pow(new BN(6))); // x devUSDC
    const vaultIndex = 2; // third vault

    // Derive the vault PDA
    const [vaultPDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from("vault"),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vaultIndex)]).buffer))
      ],
      vaultProgram.programId
    );

    // Derive the shares mint
    const [sharesMint] = await PublicKey.findProgramAddress(
      [Buffer.from("shares"), vaultPDA.toBuffer()],
      vaultProgram.programId
    );

    // Get user's USDC ATA and shares ATA
    const userUsdcATA = await token.getAssociatedTokenAddress(
      UNDERLYING_MINT,
      admin.publicKey
    );


    const userSharesATA = await token.getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      sharesMint,
      admin.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Get vault's USDC ATA
    const vaultUsdcATA = PublicKey.findProgramAddressSync(
      [Buffer.from("underlying"), vaultPDA.toBuffer()],
      vaultProgram.programId
    )[0];

    try {
      await vaultProgram.methods
        .deposit(depositAmount)
        .accounts({
          vault: vaultPDA,
          userTokenAccount: userUsdcATA,
          userSharesAccount: userSharesATA.address,
          user: admin.publicKey,
          underlyingMint: UNDERLYING_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      // Display balances after deposit
      const userUsdcBalance = await provider.connection.getTokenAccountBalance(userUsdcATA);
      const vaultUsdcBalance = await provider.connection.getTokenAccountBalance(vaultUsdcATA);
      const userSharesBalance = await provider.connection.getTokenAccountBalance(userSharesATA.address);

      console.log("User USDC balance after deposit:", userUsdcBalance.value.uiAmount);
      console.log("Vault USDC balance after deposit:", vaultUsdcBalance.value.uiAmount);
      console.log("User shares balance after deposit:", userSharesBalance.value.uiAmount);
      console.log("User shares balance after deposit raw number:", userSharesBalance.value.amount);
    } catch (error) {
      console.error("Error during deposit:", error);
    }

  } catch (error) {
    console.error("Error occurred:", error);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});