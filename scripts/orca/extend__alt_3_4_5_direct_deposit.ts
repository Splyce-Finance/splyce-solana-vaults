import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { Strategy } from "../../target/types/strategy";
import { BN } from "@coral-xyz/anchor";
import * as token from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import {
  Connection,
  TransactionInstruction,
  AddressLookupTableAccount,
  SystemProgram,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableProgram,
  Keypair,
} from "@solana/web3.js";
import * as dotenv from "dotenv";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";

// Load environment variables
dotenv.config();

// Load deployment addresses based on environment
const ADDRESSES_FILE = path.join(__dirname, "deployment_addresses", "addresses.json");
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, "utf8"));
const ENV = process.env.CLUSTER || "devnet";

interface AssetConfig {
  address: string;
  decimals: number;
  pool: {
    id: string;
    token_vault_a: string;
    token_vault_b: string;
    oracle: string;
    tick_arrays: string[];
  };
  investment_config: {
    a_to_b_for_purchase: boolean;
    assigned_weight_bps: number;
  };
}

interface Config {
  programs: {
    whirlpool_program: string;
    token_program: string;
    whirlpools_config: string;
  };
  mints: {
    underlying: {
      address: string;
      decimals: number;
    };
    assets: {
      [key: string]: AssetConfig;
    };
  };
}

const CONFIG = ADDRESSES[ENV] as Config;
if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

// Get program IDs from config
const WHIRLPOOL_PROGRAM_ID = new PublicKey(CONFIG.programs.whirlpool_program);
const UNDERLYING_MINT = new PublicKey(CONFIG.mints.underlying.address);

async function main() {
  try {
    // ============================================
    // Setup Provider and Programs
    // ============================================
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Load admin keypair
    const secretKeyPath = path.resolve(process.env.HOME!, ".config/solana/mainnet.json");
    const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(secretKeyPath, "utf8")));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;

    // ============================================
    // Derive PDAs
    // ============================================
    const vaultIndex = 2;
    const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vaultIndex)]).buffer)),
      ],
      vaultProgram.programId
    );
    console.log("Vault PDA:", vaultPDA.toBase58());

    const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
      [vaultPDA.toBuffer(), new BN(vaultIndex).toArrayLike(Buffer, "le", 8)],
      strategyProgram.programId
    );
    console.log("Strategy PDA:", strategy.toBase58());

    // Shares Mint
    const [sharesMint] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("shares"), vaultPDA.toBuffer()],
      vaultProgram.programId
    );

    // User token accounts
    const userUsdcATA = await getAssociatedTokenAddress(UNDERLYING_MINT, admin.publicKey);
    const userSharesATA = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      sharesMint,
      admin.publicKey
    );

    // Vault & Strategy token accounts
    const vaultUsdcATA = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("underlying"), vaultPDA.toBuffer()],
      vaultProgram.programId
    )[0];

    const strategyTokenAccount = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("underlying"), strategy.toBuffer()],
      strategyProgram.programId
    )[0];

    // ============================================
    // Build combinedRemainingAccounts
    // ============================================
    const combinedRemainingAccounts = [];

    for (const [symbol, asset] of Object.entries(CONFIG.mints.assets)) {
      const assetMint = new PublicKey(asset.address);
      const whirlpoolAddress = new PublicKey(asset.pool.id);

      // Strategy's asset account
      const [strategyAssetAccount] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("token_account"), assetMint.toBuffer(), strategy.toBuffer()],
        strategyProgram.programId
      );

      // Invest tracker
      const [investTrackerAccount] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("invest_tracker"), assetMint.toBuffer(), strategy.toBuffer()],
        strategyProgram.programId
      );

      // Get investTracker to see if a_to_b_for_purchase
      const investTracker = await strategyProgram.account.investTracker.fetch(investTrackerAccount);
      const [tokenAccountA, tokenAccountB] = investTracker.aToBForPurchase
        ? [strategyTokenAccount, strategyAssetAccount]
        : [strategyAssetAccount, strategyTokenAccount];

      console.log(`\nInvest Tracker for ${symbol}:`, investTrackerAccount.toBase58());
      console.log("aToBForPurchase:", investTracker.aToBForPurchase);

      let tickArrayAddresses;
      switch (asset.pool.id) {
        case '8QaXeHBrShJTdtN1rWCccBxpSVvKksQ2PCu5nufb2zbk': //BONK
          tickArrayAddresses = [
            '3PPzT57LeR33sahQNKNPn3Zz7xaBJ3GvriEYXZCuBaUE',
            'B75fBdZrMCXjGSgvAr6pDwv5ZUyR5dbZVQ3cu7SS3VFP',
            'AgdM8Go2TNSbmACjxG5m5Gem45eu9vG6u752qwGjC6Ec'
          ];
          break;
        case '6pLFuygN2yLg6fAJ4JRtdDfKaugcY51ZYK5PTjFZMa5s': //PENGU
          tickArrayAddresses = [
            '6J91prWMk3u95Xc3MtmGax4vnGZcwpBnive61wm71m6w',
            'DSg23ei74BfkokGn5pyZE6FQRxVh5fbXFQ6Pk5U4JACv',
            'GpQEB8cpcGNAB8EPi8aAnWtzZ8uXcTk1AbtNgYV4aqtQ'
          ];
          break;
        case 'CN8M75cH57DuZNzW5wSUpTXtMrSfXBFScJoQxVCgAXes': // WIF
          tickArrayAddresses = [
            '3Z4k6Pj8XNg2GpYsw4GbvwhPaagcm2gLC545W5LPUC8B',
            'C3AnpNzNid5dt6qsBg2516vTTKp87wVw7DdnRTwecKfL',
            'HwXApimTPcnw7JSqNxT5PcpUmqQ1bmfdbQZPp1BWq3ro'
          ];
          break;
        case '55BrDTCLWayM16GwrMEQU57o4PTm6ceF9wavSdNZcEiy': // wBTC 
          tickArrayAddresses = [
            'CDwMWZzgxuX55adyGqZarH8S8MaZVZ8QWV27wvKuAGSe',
            'Hxz4DkfTtCT1wmcQW4VhKKcwDUxsmnW2JYqQiZsXEPWW',
            '94FteVE3md4JKzQpxh9yLJ6VYDWCykJCcrDhYaFjw7hX'
          ];
          break;
        case 'AU971DrPyhhrpRnmEBp5pDTWL2ny7nofb5vYBjDJkR2E': // whETH 
          tickArrayAddresses = [
            '29gTuNdR8WY1ykX3RNfpmihoWb7MFHKZADoQhQfmKwk9',
            '8FWug1pT6s38BxTRYZMQUB3nTVM5sbtx5CoBypTV3kRF',
            '5CQq46j1Uke7twCb8DfevHmbc6nXMuhA42XdmhtkLNTY'
          ];
          break;
        case 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE': //  SOL
          tickArrayAddresses = [
            '38d2DowiQEn1BUxqHWt38yp4pZHjDzU87hynZ7dLnmYJ',
            '3M9oTcoC5viBCNuJEKgwCrQDEbE3Rh6CpTGP5C2jGHzU',
            'Dbj8nbAEZPpQvNqhDRGVrwQ2Y2gejNrnGFJ1xPS38TXJ'
          ];
          break;
        default:
          throw new Error(`No tick arrays defined for pool: ${asset.pool.id}`);
      }

      const remainingAccountsForAsset = [
        { pubkey: WHIRLPOOL_PROGRAM_ID, isWritable: false, isSigner: false },
        { pubkey: whirlpoolAddress, isWritable: true, isSigner: false },
        { pubkey: tokenAccountA, isWritable: true, isSigner: false },
        { pubkey: new PublicKey(asset.pool.token_vault_a), isWritable: true, isSigner: false },
        { pubkey: tokenAccountB, isWritable: true, isSigner: false },
        { pubkey: new PublicKey(asset.pool.token_vault_b), isWritable: true, isSigner: false },
        ...tickArrayAddresses.map((addr) => ({
          pubkey: new PublicKey(addr),
          isWritable: true,
          isSigner: false,
        })),
        { pubkey: new PublicKey(asset.pool.oracle), isWritable: true, isSigner: false },
        { pubkey: investTrackerAccount, isWritable: true, isSigner: false },
        { pubkey: strategy, isWritable: true, isSigner: false },
      ];

      combinedRemainingAccounts.push(...remainingAccountsForAsset);
    }

    // ============================================
    // We gather *all* pubkeys from .accounts() + remainingAccounts
    // ============================================
    const allPubkeysForThisTx = new Set<string>();

    // From the .accounts(...) object
    const primaryAccounts = [
      vaultPDA,
      userUsdcATA,
      userSharesATA.address,
      strategy,
      admin.publicKey,
      UNDERLYING_MINT,
    ];
    for (const pk of primaryAccounts) {
      allPubkeysForThisTx.add(pk.toBase58());
    }

    // From remainingAccounts
    for (const acc of combinedRemainingAccounts) {
      allPubkeysForThisTx.add(acc.pubkey.toBase58());
    }

    // Convert back to an array of PublicKeys
    const allPubkeysArr = [...allPubkeysForThisTx].map((x) => new PublicKey(x));
    console.log(`\nTotal unique addresses used in directDeposit: ${allPubkeysArr.length}`);

    // ============================================
    // read & possibly extend the LUT
    // ============================================
    const altJsonPath = path.join(__dirname, "ALT", "ALT_index2Meme.json");
    const altJson = JSON.parse(fs.readFileSync(altJsonPath, "utf8"));

    const lutAddress = new PublicKey(altJson.lookupTableAddress);
    console.log("Using LUT:", lutAddress.toBase58());

    let lutAccountInfo = (await provider.connection.getAddressLookupTable(lutAddress)).value;
    if (!lutAccountInfo) {
      throw new Error(`Lookup table not found: ${lutAddress.toBase58()}`);
    }

    // Extend LUT if needed
    await extendLUTIfNeeded(provider.connection, admin, lutAddress, allPubkeysArr);

    // Wait a slot so newly added addresses are recognized
    await waitOneSlot(provider.connection);

    // Re-fetch the LUT
    lutAccountInfo = (await provider.connection.getAddressLookupTable(lutAddress)).value;
    if (!lutAccountInfo) {
      throw new Error("LUT not found after extension/wait!");
    }

    // ============================================
    // Log initial balances, etc.
    // ============================================
    const initialBalances = {
      userUsdc: await provider.connection.getTokenAccountBalance(userUsdcATA),
      userShares: await provider.connection.getTokenAccountBalance(userSharesATA.address),
      vaultUsdc: await provider.connection.getTokenAccountBalance(vaultUsdcATA),
      strategyUsdc: await provider.connection.getTokenAccountBalance(strategyTokenAccount),
    };

    console.log("\nInitial Balances:");
    console.log("User USDC:", initialBalances.userUsdc.value.uiAmount);
    console.log("User Shares:", initialBalances.userShares.value.uiAmount);
    console.log("Vault USDC:", initialBalances.vaultUsdc.value.uiAmount);
    console.log("Strategy USDC:", initialBalances.strategyUsdc.value.uiAmount);

    // Show strategy's asset token account balances before direct deposit
    console.log("\nStrategy's asset token account balances (before deposit):");
    for (const [symbol, asset] of Object.entries(CONFIG.mints.assets)) {
      const assetMint = new PublicKey(asset.address);
      const [strategyAssetAccount] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("token_account"), assetMint.toBuffer(), strategy.toBuffer()],
        strategyProgram.programId
      );
      try {
        const balance = await provider.connection.getTokenAccountBalance(strategyAssetAccount);
        console.log(`${symbol} =>`, {
          account: strategyAssetAccount.toBase58(),
          amount: balance.value.uiAmount,
        });
      } catch {
        console.log(`${symbol} => not initialized: ${strategyAssetAccount.toBase58()}`);
      }
    }

    // ============================================
    // Build the directDeposit instruction
    // ============================================
    // Suppose deposit = 1 USDC
    const depositAmount = new BN(1).mul(new BN(10).pow(new BN(6)));

    const depositIx = await vaultProgram.methods
      .directDeposit(depositAmount)
      .accounts({
        vault: vaultPDA,
        userTokenAccount: userUsdcATA,
        userSharesAccount: userSharesATA.address,
        strategy: strategy,
        user: admin.publicKey,
        underlyingMint: UNDERLYING_MINT,
      })
      .remainingAccounts(combinedRemainingAccounts)
      .instruction();

    // Add compute budget instructions
    const computeUnitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
    const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });

    // ============================================
    // Build + send Versioned Transaction
    // ============================================
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
      payerKey: admin.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [computeUnitIx, computePriceIx, depositIx],
    }).compileToV0Message([lutAccountInfo]); // references the LUT

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([admin]);

    const txid = await provider.connection.sendTransaction(transaction);
    console.log("Direct deposit transaction executed successfully. Txid:", txid);

    const confirmation = await provider.connection.confirmTransaction(txid, "confirmed");
    console.log("Transaction confirmed:", confirmation);

    // ============================================
    // Final balances
    // ============================================
    const finalBalances = {
      userUsdc: await provider.connection.getTokenAccountBalance(userUsdcATA),
      userShares: await provider.connection.getTokenAccountBalance(userSharesATA.address),
      vaultUsdc: await provider.connection.getTokenAccountBalance(vaultUsdcATA),
      strategyUsdc: await provider.connection.getTokenAccountBalance(strategyTokenAccount),
    };

    console.log("\nFinal Balances:");
    console.log("User USDC:", finalBalances.userUsdc.value.uiAmount);
    console.log("User Shares:", finalBalances.userShares.value.uiAmount);
    console.log("Vault USDC:", finalBalances.vaultUsdc.value.uiAmount);
    console.log("Strategy USDC:", finalBalances.strategyUsdc.value.uiAmount);

    console.log("\nBalance Changes:");
    console.log("User USDC:", finalBalances.userUsdc.value.uiAmount! - initialBalances.userUsdc.value.uiAmount!);
    console.log("User Shares:", finalBalances.userShares.value.uiAmount! - initialBalances.userShares.value.uiAmount!);
    console.log("Vault USDC:", finalBalances.vaultUsdc.value.uiAmount! - initialBalances.vaultUsdc.value.uiAmount!);
    console.log("Strategy USDC:", finalBalances.strategyUsdc.value.uiAmount! - initialBalances.strategyUsdc.value.uiAmount!);

    // Strategy asset token accounts after deposit
    for (const [symbol, asset] of Object.entries(CONFIG.mints.assets)) {
      const assetMint = new PublicKey(asset.address);
      const [strategyAssetAccount] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("token_account"), assetMint.toBuffer(), strategy.toBuffer()],
        strategyProgram.programId
      );
      const [investTrackerAccount] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("invest_tracker"), assetMint.toBuffer(), strategy.toBuffer()],
        strategyProgram.programId
      );

      const assetBalance = await provider.connection.getTokenAccountBalance(strategyAssetAccount);
      const investTracker = await strategyProgram.account.investTracker.fetch(investTrackerAccount);

      console.log(`\n${symbol} Final Data:`);
      console.log("Balance:", assetBalance.value.uiAmount);
      console.log("Invest Tracker:", {
        amountInvested: investTracker.amountInvested.toString(),
        amountWithdrawn: investTracker.amountWithdrawn.toString(),
        assetAmount: investTracker.assetAmount.toString(),
        assetPrice: investTracker.assetPrice.toString(),
        aToBForPurchase: investTracker.aToBForPurchase,
        assignedWeight: investTracker.assignedWeight,
        currentWeight: investTracker.currentWeight,
      });
    }
  } catch (error) {
    console.error("Error occurred:", error);
    if ("logs" in error) {
      console.error("Program Logs:", error.logs);
    }
    process.exit(1);
  }
}

// ============================================
// Helper to extend the LUT if new addresses are needed
// ============================================
async function extendLUTIfNeeded(
  connection: Connection,
  payer: Keypair,
  lutAddress: PublicKey,
  addresses: PublicKey[]
) {
  // Fetch the LUT
  const lutAccountResult = await connection.getAddressLookupTable(lutAddress);
  if (!lutAccountResult?.value) {
    throw new Error("Cannot fetch LUT from chain. Possibly not created?");
  }
  const existingAddrs = new Set(lutAccountResult.value.state.addresses.map((x) => x.toBase58()));

  // Filter out addresses we already have
  const newAddrs = addresses.filter((pk) => !existingAddrs.has(pk.toBase58()));
  if (newAddrs.length === 0) {
    console.log("No new addresses to add to LUT.");
    return;
  }

  console.log(`Extending LUT with ${newAddrs.length} addresses...`);

  // Each extension can only hold ~30 addresses
  // So we chunk them if needed
  let start = 0;
  const CHUNK_SIZE = 30;
  while (start < newAddrs.length) {
    const chunk = newAddrs.slice(start, start + CHUNK_SIZE);
    start += CHUNK_SIZE;

    const extendIx = AddressLookupTableProgram.extendLookupTable({
      payer: payer.publicKey,
      authority: payer.publicKey,
      lookupTable: lutAddress,
      addresses: chunk,
    });

    const { blockhash } = await connection.getLatestBlockhash();
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [extendIx],
    }).compileToV0Message([]);
    const vtx = new VersionedTransaction(msg);
    vtx.sign([payer]);

    const sig = await connection.sendTransaction(vtx);
    console.log("Extend LUT tx:", sig);
    await connection.confirmTransaction(sig, "confirmed");
  }

  console.log("All required addresses successfully added to LUT.");
}

// ============================================
// Helper to wait one slot
// ============================================
async function waitOneSlot(connection: Connection) {
  const startSlot = await connection.getSlot();
  let newSlot = startSlot;
  while (newSlot <= startSlot) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    newSlot = await connection.getSlot();
  }
  console.log(`Waited 1 slot. Now at slot=${newSlot}. LUT is warmed up.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});