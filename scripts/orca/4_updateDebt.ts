import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  Keypair,
  TransactionInstruction,
  ComputeBudgetProgram,
  AddressLookupTableAccount,
  AddressLookupTableProgram
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { Strategy } from "../../target/types/strategy";

// =============================================
// Load environment variables & config
// =============================================
dotenv.config();
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

// Program IDs
const WHIRLPOOL_PROGRAM_ID = new PublicKey(CONFIG.programs.whirlpool_program);
const UNDERLYING_MINT = new PublicKey(CONFIG.mints.underlying.address);

// =============================================
// 1) A helper to collect ALL addresses needed
// =============================================
function collectAllAddressesForLUT(
  strategy: PublicKey,
  strategyTokenAccount: PublicKey,
  strategyProgram: Program<Strategy>
): PublicKey[] {
  const allAddresses: PublicKey[] = [];

  // We'll do the same loop as building combinedRemainingAccounts,
  // but store these addresses in an array for LUT extension.
  for (const asset of Object.values(CONFIG.mints.assets)) {
    const assetMint = new PublicKey(asset.address);
    const whirlpoolAddress = new PublicKey(asset.pool.id);

    // StrategyAssetAccount
    const [strategyAssetAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("token_account"), assetMint.toBuffer(), strategy.toBuffer()],
      strategyProgram.programId
    );

    // InvestTracker
    const [investTrackerAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("invest_tracker"), assetMint.toBuffer(), strategy.toBuffer()],
      strategyProgram.programId
    );

    // Because we need the data from the chain, a fetch can fail if it doesn't exist
    // but let's assume it does exist:
    // (If it doesn't, you'd handle the error or skip.)
    // We do this only to see if aToBForPurchase is set:
    // eslint-disable-next-line no-console
    console.log(`Collecting addresses for assetMint ${assetMint.toBase58()}`);

    // Normally: fetch the investTracker to find aToBForPurchase
    // let investTracker = await strategyProgram.account.investTracker.fetch(investTrackerAccount);

    // For offline compilation, let's just push them. We'll set order at actual instruction time:
    // But we know we always need:
    //   - the Whirlpool Program ID
    //   - the Whirlpool Address
    //   - the two vaults
    //   - the Oracle
    //   - the Invest Tracker
    //   - the Strategy
    //   - the Tick Arrays
    //   - the 2 token accounts

    // 1) Whirlpool Program
    allAddresses.push(WHIRLPOOL_PROGRAM_ID);
    // 2) Whirlpool address
    allAddresses.push(whirlpoolAddress);
    // 3) strategyTokenAccount or strategyAssetAccount
    // 4) pool.token_vault_a
    // 5) whichever is the second token
    // 6) pool.token_vault_b
    // We'll push both possibilities now, because we might not know the order yet:
    allAddresses.push(strategyTokenAccount);
    allAddresses.push(strategyAssetAccount);

    allAddresses.push(new PublicKey(asset.pool.token_vault_a));
    allAddresses.push(new PublicKey(asset.pool.token_vault_b));
    allAddresses.push(new PublicKey(asset.pool.oracle));
    allAddresses.push(investTrackerAccount);
    allAddresses.push(strategy);

    // Tick arrays
    for (const tick of asset.pool.tick_arrays) {
      allAddresses.push(new PublicKey(tick));
    }
  }

  // It's best practice to deduplicate in case any addresses repeat
  const uniqueAddresses = [...new Set(allAddresses.map((pk) => pk.toBase58()))].map(
    (x) => new PublicKey(x)
  );

  return uniqueAddresses;
}

// =============================================
// 2) A helper to extend an existing LUT
//    so it includes the needed addresses
// =============================================
async function extendLookupTableIfNeeded(
  connection: Connection,
  payer: Keypair,
  lutAddress: PublicKey,
  requiredAddresses: PublicKey[]
) {
  // Find how many addresses are already in the LUT
  const lutAccountResult = await connection.getAddressLookupTable(lutAddress);
  if (!lutAccountResult?.value) {
    throw new Error(`LUT not found at ${lutAddress.toBase58()}`);
  }
  const existing = new Set(
    lutAccountResult.value.state.addresses.map((addr) => addr.toBase58())
  );

  // Filter out addresses we already have
  const newAddrs = requiredAddresses.filter((addr) => !existing.has(addr.toBase58()));
  if (newAddrs.length === 0) {
    console.log("No new addresses need to be added to the LUT");
    return;
  }
  console.log(`Extending LUT with ${newAddrs.length} new addresses...`);

  // Because each extend instruction can only fit ~30 addresses,
  // chunk them if needed.
  const CHUNK_SIZE = 30;
  let startIndex = 0;
  while (startIndex < newAddrs.length) {
    const chunk = newAddrs.slice(startIndex, startIndex + CHUNK_SIZE);
    startIndex += CHUNK_SIZE;

    const extendIx = AddressLookupTableProgram.extendLookupTable({
      payer: payer.publicKey,
      authority: payer.publicKey,
      lookupTable: lutAddress,
      addresses: chunk,
    });

    // Build a short versioned tx for each chunk
    const blockhashObj = await connection.getLatestBlockhash();
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhashObj.blockhash,
      instructions: [extendIx],
    }).compileToV0Message([]);
    const vtx = new VersionedTransaction(msg);
    vtx.sign([payer]);

    const sig = await connection.sendTransaction(vtx);
    console.log(`Extend LUT chunk tx: ${sig}`);
    await connection.confirmTransaction(sig, "confirmed");
  }

  console.log("All required addresses successfully added to LUT.");
}

// =============================================
// 3) A small helper to wait 1 slot
//    so newly extended LUT is "warmed up"
// =============================================
async function waitOneSlot(connection: Connection) {
  const startSlot = await connection.getSlot();
  console.log("Current slot:", startSlot);
  let newSlot = startSlot;
  while (newSlot <= startSlot) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    newSlot = await connection.getSlot();
  }
  console.log("Next slot:", newSlot, "(LUT is now warmed up)");
}

// =============================================
// 4) Main script
// =============================================
async function main() {
  try {
    // Setup anchor provider
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Load admin keypair
    const secretKeyPath = path.resolve(process.env.HOME!, ".config/solana/mainnet.json");
    const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(secretKeyPath, "utf8")));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    // Anchor programs
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;

    // Derive PDAs
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

    // Strategy token account
    const strategyTokenAccount = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("underlying"), strategy.toBuffer()],
      strategyProgram.programId
    )[0];

    // -------------------------------------------
    // 1) Collect all addresses that we want the LUT to store
    // -------------------------------------------
    const allRequiredAddresses = collectAllAddressesForLUT(strategy, strategyTokenAccount, strategyProgram);

    // -------------------------------------------
    // 2) Read the Address Lookup Table from ALT.json
    // -------------------------------------------
    const altJsonPath = path.join(__dirname, "ALT", "ALT.json");
    const altJson = JSON.parse(fs.readFileSync(altJsonPath, "utf8"));
    const lutPubkey = new PublicKey(altJson.lookupTableAddress);

    // Extend the LUT if needed
    await extendLookupTableIfNeeded(provider.connection, admin, lutPubkey, allRequiredAddresses);

    // Wait 1 slot so the extension is recognized
    await waitOneSlot(provider.connection);

    // Reload the LUT to pass to our versioned transaction
    const lutAccountInfo = (await provider.connection.getAddressLookupTable(lutPubkey)).value;
    if (!lutAccountInfo) {
      throw new Error("Lookup table not found even after extension!");
    }
    console.log("LUT is ready at:", lutPubkey.toBase58());

    // -------------------------------------------
    // 3) Build the updateDebt instruction
    // -------------------------------------------
    // Suppose we want to update debt by 1 USDC
    const updateAmount = new BN(1).mul(new BN(10).pow(new BN(6)));

    // Build the big "combinedRemainingAccounts" just like your directDeposit
    const combinedRemainingAccounts = [];
    for (const [symbol, asset] of Object.entries(CONFIG.mints.assets)) {
      const assetMint = new PublicKey(asset.address);
      const whirlpoolAddress = new PublicKey(asset.pool.id);

      const [strategyAssetAccount] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("token_account"), assetMint.toBuffer(), strategy.toBuffer()],
        strategyProgram.programId
      );

      const [investTrackerAccount] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("invest_tracker"), assetMint.toBuffer(), strategy.toBuffer()],
        strategyProgram.programId
      );

      // Usually, you'd fetch to see aToBForPurchase
      // For brevity, we skip that step and assume we have the correct order
      // But in practice you do:
       const investTracker = await strategyProgram.account.investTracker.fetch(investTrackerAccount);
       const [tokenAccountA, tokenAccountB] = investTracker.aToBForPurchase
          ? [strategyTokenAccount, strategyAssetAccount]
          : [strategyAssetAccount, strategyTokenAccount];

      // Select the correct tick arrays based on pool ID
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
        ...tickArrayAddresses.map(addr => ({ 
          pubkey: new PublicKey(addr), 
          isWritable: true, 
          isSigner: false 
        })),
        { pubkey: new PublicKey(asset.pool.oracle), isWritable: true, isSigner: false },
        { pubkey: investTrackerAccount, isWritable: true, isSigner: false },
        { pubkey: strategy, isWritable: true, isSigner: false },
      ];

      combinedRemainingAccounts.push(...remainingAccountsForAsset);
    }

    // Build the instruction
    const updateDebtIx = await vaultProgram.methods
      .updateDebt(updateAmount)
      .accounts({
        vault: vaultPDA,
        strategy: strategy,
        signer: admin.publicKey,
        underlyingMint: UNDERLYING_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(combinedRemainingAccounts)
      .instruction();

    // Add Compute Budget instructions
    const computeUnitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
    const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });

    // -------------------------------------------
    // 4) Build & send the VersionedTransaction
    // -------------------------------------------
    const { blockhash } = await provider.connection.getLatestBlockhash();

    const msgV0 = new TransactionMessage({
      payerKey: admin.publicKey,
      recentBlockhash: blockhash,
      instructions: [computeUnitIx, computePriceIx, updateDebtIx],
    }).compileToV0Message([lutAccountInfo]); // pass the LUT for compression

    const vtx = new VersionedTransaction(msgV0);
    vtx.sign([admin]);

    const sig = await provider.connection.sendTransaction(vtx);
    console.log("UpdateDebt transaction executed successfully. Txid:", sig);

    // Wait for confirmation
    const confirmation = await provider.connection.confirmTransaction({
      signature: sig,
      blockhash: blockhash,
      lastValidBlockHeight: await provider.connection.getBlockHeight()
    }, "confirmed");

    // Get transaction details with versioned transaction support
    const txDetails = await provider.connection.getParsedTransaction(sig, {
      maxSupportedTransactionVersion: 0
    });

    console.log("Transaction confirmed:", {
      slot: txDetails?.slot,
      blockTime: txDetails?.blockTime,
      version: txDetails?.version
    });

  } catch (err) {
    console.error("Error occurred:", err);
    if ("logs" in err) {
      console.error("Program Logs:", err.logs);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});