import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Strategy } from "../../../target/types/strategy";
import { TokenizedVault } from "../../../target/types/tokenized_vault";
import { AccessControl } from "../../../target/types/access_control";
import { BN } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { formatInvestTrackerData } from "../utils/format-invest-tracker";

// Swap-related constants for WSOL
const WHIRLPOOL_PROGRAM_ID_WSOL = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
);
// Whirlpool for WSOL (replace with actual if different)
const WHIRLPOOL_ID_WSOL = new PublicKey(
  "3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt"
);
const TICK_ARRAY_ADDRESSES_WSOL = [
  new PublicKey("3aBJJLAR3QxGcGsesNXeW3f64Rv3TckF7EQ6sXtAuvGM"),
  new PublicKey("3aBJJLAR3QxGcGsesNXeW3f64Rv3TckF7EQ6sXtAuvGM"),
  new PublicKey("3aBJJLAR3QxGcGsesNXeW3f64Rv3TckF7EQ6sXtAuvGM"),
];
const ORACLE_ADDRESS_WSOL = new PublicKey(
  "2KEWNc3b6EfqoWQpfKQMHh4mhRyKXYRdPbtGRTJX3Cip"
);

// Swap-related constants for TMAC
const WHIRLPOOL_PROGRAM_ID_TMAC = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc" // same as WSOL for now but may change
);
// Whirlpool for TMAC (replace with actual if different)
const WHIRLPOOL_ID_TMAC = new PublicKey(
  "H3xhLrSEyDFm6jjG42QezbvhSxF5YHW75VdGUnqeEg5y"
);
const TICK_ARRAY_ADDRESSES_TMAC = [
  new PublicKey("5NApkpCKADoeYk8s2SHa2u1nHBPEXr937c1amNgjMDdy"),
  new PublicKey("5NApkpCKADoeYk8s2SHa2u1nHBPEXr937c1amNgjMDdy"),
  new PublicKey("5NApkpCKADoeYk8s2SHa2u1nHBPEXr937c1amNgjMDdy"),
];
const ORACLE_ADDRESS_TMAC = new PublicKey(
  "34mJni6KtJBUWoqsT5yZUJ89ywHnYaU11bh27cNHPTov"
);

// Token Mints
const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);
const TMAC_MINT = new PublicKey(
  "Afn8YB1p4NsoZeS5XJBZ18LTfEy5NFPwN46wapZcBQr6"
);
const USDC_MINT = new PublicKey(
  "BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k"
);

// Swap Vaults for WSOL
const TOKEN_VAULT_A_WSOL = new PublicKey(
  "C9zLV5zWF66j3rZj3uuhDqvfuA8esJyWnruGzDW9qEj2"
);
const TOKEN_VAULT_B_WSOL = new PublicKey(
  "7DM3RMz2yzUB8yPRQM3FMZgdFrwZGMsabsfsKopWktoX"
);

// Swap Vaults for TMAC
const TOKEN_VAULT_A_TMAC = new PublicKey(
  "2qE191zsJCJdMXsPcwkVJ5MyiSfreNpQtKpXgAMkwhUf"
);
const TOKEN_VAULT_B_TMAC = new PublicKey(
  "G6qeUBPqU3Ryabi4rwVUgHpLh6wmHLvi8jDQexTR1CTU"
);

async function main() {
  try {
    // Setup Provider and Programs
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;

    // Load admin keypair
    const secretKeyPath = path.resolve(process.env.HOME!, ".config/solana/id.json");
    const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(secretKeyPath, "utf8")));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    // Derive strategy PDA
    const vaultPDA = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(0)]).buffer))
      ],
      anchor.workspace.TokenizedVault.programId
    )[0];

    const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        vaultPDA.toBuffer(),
        new BN(0).toArrayLike(Buffer, "le", 8)
      ],
      strategyProgram.programId
    );

    // Get strategy token accounts
    const strategyWSOLAccount = PublicKey.findProgramAddressSync(
      [
        Buffer.from("token_account"),
        WSOL_MINT.toBuffer(),
        strategy.toBuffer(),
      ],
      strategyProgram.programId
    )[0];

    const strategyTMACAccount = PublicKey.findProgramAddressSync(
      [
        Buffer.from("token_account"),
        TMAC_MINT.toBuffer(),
        strategy.toBuffer(),
      ],
      strategyProgram.programId
    )[0];

    // Add underlying token account derivation
    const underlyingTokenAccount = PublicKey.findProgramAddressSync(
      [Buffer.from("underlying"), strategy.toBuffer()],
      strategyProgram.programId
    )[0];

    // Get invest tracker PDAs
    const [INVEST_TRACKER_ACCOUNT_WSOL] = PublicKey.findProgramAddressSync(
      [Buffer.from("invest_tracker"), WSOL_MINT.toBuffer(), strategy.toBuffer()],
      strategyProgram.programId
    );

    const [INVEST_TRACKER_ACCOUNT_TMAC] = PublicKey.findProgramAddressSync(
      [Buffer.from("invest_tracker"), TMAC_MINT.toBuffer(), strategy.toBuffer()],
      strategyProgram.programId
    );

    // Build remaining accounts array
    const remainingAccountsForWSOL = [
      {
        pubkey: WHIRLPOOL_PROGRAM_ID_WSOL,
        isWritable: false,
        isSigner: false,
      },
      {
        pubkey: WHIRLPOOL_ID_WSOL,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: strategyWSOLAccount,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TOKEN_VAULT_A_WSOL,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: underlyingTokenAccount,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TOKEN_VAULT_B_WSOL,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TICK_ARRAY_ADDRESSES_WSOL[0],
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TICK_ARRAY_ADDRESSES_WSOL[1],
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TICK_ARRAY_ADDRESSES_WSOL[2],
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: ORACLE_ADDRESS_WSOL,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: INVEST_TRACKER_ACCOUNT_WSOL,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: strategy,
        isWritable: true,
        isSigner: false,
      },
    ];

    const remainingAccountsForTMAC = [
      {
        pubkey: WHIRLPOOL_PROGRAM_ID_TMAC,
        isWritable: false,
        isSigner: false,
      },
      {
        pubkey: WHIRLPOOL_ID_TMAC,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: strategyTMACAccount,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TOKEN_VAULT_A_TMAC,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: underlyingTokenAccount,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TOKEN_VAULT_B_TMAC,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TICK_ARRAY_ADDRESSES_TMAC[0],
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TICK_ARRAY_ADDRESSES_TMAC[1],
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: TICK_ARRAY_ADDRESSES_TMAC[2],
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: ORACLE_ADDRESS_TMAC,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: INVEST_TRACKER_ACCOUNT_TMAC,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: strategy,
        isWritable: true,
        isSigner: false,
      },
    ];

    // Combine remaining accounts
    const remainingAccounts = [
      ...remainingAccountsForWSOL,
      ...remainingAccountsForTMAC,
    ];

    // Log initial balances and invest tracker states
    console.log("\nInitial States:");
    const wsolBalanceBefore = await provider.connection.getTokenAccountBalance(strategyWSOLAccount);
    const tmacBalanceBefore = await provider.connection.getTokenAccountBalance(strategyTMACAccount);
    
    console.log("WSOL Balance:", wsolBalanceBefore.value.uiAmount);
    console.log("TMAC Balance:", tmacBalanceBefore.value.uiAmount);

    const wsolTrackerBefore = await strategyProgram.account.investTracker.fetch(INVEST_TRACKER_ACCOUNT_WSOL);
    const tmacTrackerBefore = await strategyProgram.account.investTracker.fetch(INVEST_TRACKER_ACCOUNT_TMAC);

    console.log("\nInvest Tracker States BEFORE rebalance:");
    console.log("WSOL Invest Tracker:", formatInvestTrackerData(wsolTrackerBefore));
    console.log("TMAC Invest Tracker:", formatInvestTrackerData(tmacTrackerBefore));

    // Call rebalance instruction
    await strategyProgram.methods
      .rebalance(new BN(0))
      .accounts({
        strategy: strategy,
        signer: admin.publicKey,
      })
      .remainingAccounts(remainingAccounts)
      .signers([admin])
      .rpc();

    console.log("\nRebalance completed successfully!");

    // Log final balances and changes
    const wsolBalanceAfter = await provider.connection.getTokenAccountBalance(strategyWSOLAccount);
    const tmacBalanceAfter = await provider.connection.getTokenAccountBalance(strategyTMACAccount);
    
    console.log("\nFinal States:");
    console.log("WSOL Balance:", wsolBalanceAfter.value.uiAmount);
    console.log("TMAC Balance:", tmacBalanceAfter.value.uiAmount);

    const wsolTrackerAfter = await strategyProgram.account.investTracker.fetch(INVEST_TRACKER_ACCOUNT_WSOL);
    const tmacTrackerAfter = await strategyProgram.account.investTracker.fetch(INVEST_TRACKER_ACCOUNT_TMAC);

    console.log("\nInvest Tracker States AFTER rebalance:");
    console.log("WSOL Invest Tracker:", formatInvestTrackerData(wsolTrackerAfter));
    console.log("TMAC Invest Tracker:", formatInvestTrackerData(tmacTrackerAfter));

  } catch (error) {
    console.error("Error occurred:", error);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});