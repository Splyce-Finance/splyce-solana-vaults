import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../../target/types/tokenized_vault";
import { Strategy } from "../../../target/types/strategy";
import { BN } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import { PublicKey, Connection, Keypair, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AddressLookupTableProgram } from "@solana/web3.js";

// Import existing configuration and helper functions from create_ALT_for_orca.ts
import { 
  ORCA_WHIRLPOOL_PROGRAM_ID, 
  updatePoolConfigs, 
  waitForNewBlock,
  WSOL_MINT,
  TMAC_MINT,
  USDC_MINT,
  USDT_MINT,
  SAMO_MINT
} from "./create_ALT_for_orca";

interface ALTConfig {
  lookupTableAddresses: {
    poolOperations: string;  // ALT for pool-related addresses
    programOperations: string;  // ALT for program and strategy addresses
  };
}

// Constants for PDA seeds
const TOKEN_ACCOUNT_SEED = "token_account";
const INVEST_TRACKER_SEED = "invest_tracker";
const UNDERLYING_SEED = "underlying";

async function calculateStrategyAccounts(strategy: PublicKey, strategyProgram: Program<Strategy>) {
  // Calculate shared strategy token account (for USDC - underlying asset)
  const [strategyTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from(UNDERLYING_SEED), strategy.toBuffer()],
    strategyProgram.programId
  );

  // Calculate strategy asset accounts for each token
  const [strategyWSOLAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from(TOKEN_ACCOUNT_SEED), WSOL_MINT.toBuffer(), strategy.toBuffer()],
    strategyProgram.programId
  );

  const [strategyTMACAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from(TOKEN_ACCOUNT_SEED), TMAC_MINT.toBuffer(), strategy.toBuffer()],
    strategyProgram.programId
  );

  const [strategyUSDTAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from(TOKEN_ACCOUNT_SEED), USDT_MINT.toBuffer(), strategy.toBuffer()],
    strategyProgram.programId
  );

  const [strategySAMOAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from(TOKEN_ACCOUNT_SEED), SAMO_MINT.toBuffer(), strategy.toBuffer()],
    strategyProgram.programId
  );

  // Calculate invest trackers for each asset
  const [investTrackerWSOL] = PublicKey.findProgramAddressSync(
    [Buffer.from(INVEST_TRACKER_SEED), WSOL_MINT.toBuffer(), strategy.toBuffer()],
    strategyProgram.programId
  );

  const [investTrackerTMAC] = PublicKey.findProgramAddressSync(
    [Buffer.from(INVEST_TRACKER_SEED), TMAC_MINT.toBuffer(), strategy.toBuffer()],
    strategyProgram.programId
  );

  const [investTrackerUSDT] = PublicKey.findProgramAddressSync(
    [Buffer.from(INVEST_TRACKER_SEED), USDT_MINT.toBuffer(), strategy.toBuffer()],
    strategyProgram.programId
  );

  const [investTrackerSAMO] = PublicKey.findProgramAddressSync(
    [Buffer.from(INVEST_TRACKER_SEED), SAMO_MINT.toBuffer(), strategy.toBuffer()],
    strategyProgram.programId
  );

  return {
    strategyTokenAccount,
    strategyAssetAccounts: {
      WSOL: strategyWSOLAccount,
      TMAC: strategyTMACAccount,
      USDT: strategyUSDTAccount,
      SAMO: strategySAMOAccount
    },
    investTrackers: {
      WSOL: investTrackerWSOL,
      TMAC: investTrackerTMAC,
      USDT: investTrackerUSDT,
      SAMO: investTrackerSAMO
    }
  };
}

async function createALT(
  connection: Connection,
  admin: Keypair,
  addresses: PublicKey[],
  description: string
): Promise<PublicKey> {
  // Get the most recent slot
  const slot = await connection.getSlot("finalized");
  
  // Create the lookup table
  console.log(`\nCreating ${description} lookup table...`);
  const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: admin.publicKey,
    payer: admin.publicKey,
    recentSlot: slot
  });

  try {
    await sendAndConfirmTransaction(
      connection,
      new anchor.web3.Transaction().add(createIx),
      [admin],
      { commitment: 'confirmed' }
    );

    // Wait for table to be confirmed
    await waitForNewBlock(connection, 1);
    console.log(`${description} lookup table created at:`, lookupTableAddress.toBase58());

    // Extend the table with addresses in chunks
    console.log(`Extending ${description} lookup table with addresses...`);
    const chunkSize = 20;
    for (let i = 0; i < addresses.length; i += chunkSize) {
      const chunk = addresses.slice(i, Math.min(i + chunkSize, addresses.length));
      const extendIx = AddressLookupTableProgram.extendLookupTable({
        payer: admin.publicKey,
        authority: admin.publicKey,
        lookupTable: lookupTableAddress,
        addresses: chunk
      });

      await sendAndConfirmTransaction(
        connection,
        new anchor.web3.Transaction().add(extendIx),
        [admin],
        { commitment: 'confirmed' }
      );

      console.log(`Added addresses ${i + 1} to ${i + chunk.length}`);
      await waitForNewBlock(connection, 1);
    }

    return lookupTableAddress;
  } catch (error) {
    console.error(`Error in createALT (${description}):`, error);
    // If we get a slot error, we could retry with an even more recent slot
    if (error.logs?.some(log => log.includes("is not a recent slot"))) {
      console.log("Retrying with a more recent slot...");
      await new Promise(resolve => setTimeout(resolve, 1000));
      return createALT(connection, admin, addresses, description);
    }
    throw error;
  }
}

async function main() {
  try {
    // Setup provider and admin
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const secretKeyPath = path.resolve(process.env.HOME!, ".config/solana/id.json");
    const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(secretKeyPath, 'utf8')));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    const connection = provider.connection;

    // Setup Programs
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;

    // Get PDAs
    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from(new Uint8Array(new BigUint64Array([BigInt(0)]).buffer))],
      vaultProgram.programId
    );

    const [strategy] = PublicKey.findProgramAddressSync(
      [vaultPDA.toBuffer(), new BN(0).toArrayLike(Buffer, "le", 8)],
      strategyProgram.programId
    );

    const [strategyData] = PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_data"), vaultPDA.toBuffer(), strategy.toBuffer()],
      vaultProgram.programId
    );

    // Get all strategy accounts
    const accounts = await calculateStrategyAccounts(strategy, strategyProgram);

    // Get pool configurations
    const pools = await updatePoolConfigs(strategy, strategyProgram);

    // Separate addresses into two categories:
    // 1. Program operations (core programs, primary strategy PDAs, vault PDA)
    // 2. Pool operations (pools, associated vault accounts, tick arrays, strategy asset accounts, invest trackers, mints)

    const programAddresses = [
      ORCA_WHIRLPOOL_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      strategy,
      strategyData,
      vaultPDA
    ];

    const poolAddresses = [
      accounts.strategyTokenAccount,
      ...Object.values(accounts.strategyAssetAccounts),
      ...Object.values(accounts.investTrackers),
      WSOL_MINT,
      TMAC_MINT,
      USDC_MINT,
      USDT_MINT,
      SAMO_MINT,
      ...pools.flatMap(pool => [
        pool.poolId,
        pool.vaultA,
        pool.vaultB,
        ...pool.tickArrays,
        pool.oracle
      ])
    ];

    // Create two separate ALTs
    const programALT = await createALT(
      connection, 
      admin, 
      programAddresses,
      "program operations"
    );

    const poolALT = await createALT(
      connection, 
      admin, 
      poolAddresses,
      "pool operations"
    );

    // After ALTs are created, verify their contents
    console.log("\nVerifying ALT contents:");
    
    // Verify program operations ALT
    const programALTAccount = (await provider.connection.getAddressLookupTable(programALT)).value;
    console.log("\nProgram Operations ALT contains:");
    programALTAccount?.state.addresses.forEach((addr, i) => {
        console.log(`${i + 1}. ${addr.toBase58()}`);
    });

    // Verify pool operations ALT
    const poolALTAccount = (await provider.connection.getAddressLookupTable(poolALT)).value;
    console.log("\nPool Operations ALT contains:");
    poolALTAccount?.state.addresses.forEach((addr, i) => {
        console.log(`${i + 1}. ${addr.toBase58()}`);
    });

    // Compare with original address lists
    console.log("\nAddress count verification:");
    console.log(`Program addresses expected: ${programAddresses.length}, actual: ${programALTAccount?.state.addresses.length}`);
    console.log(`Pool addresses expected: ${poolAddresses.length}, actual: ${poolALTAccount?.state.addresses.length}`);

    // Save ALT configurations
    const altConfig: ALTConfig = {
      lookupTableAddresses: {
        poolOperations: poolALT.toBase58(),
        programOperations: programALT.toBase58()
      }
    };
    
    const currentDir = __dirname;
    const altJsonPath = path.join(currentDir, 'ALT.json');
    
    fs.writeFileSync(altJsonPath, JSON.stringify(altConfig, null, 2));
    console.log(`\nLookup tables created successfully!`);
    console.log(`Program Operations ALT: ${programALT.toBase58()}`);
    console.log(`Pool Operations ALT: ${poolALT.toBase58()}`);
    console.log(`Configuration saved to: ${altJsonPath}`);

  } catch (error) {
    console.error("Error occurred:", error);
    if ('logs' in error) {
      console.error("Program Logs:", error.logs);
    }
  }
}

main().catch(console.error);