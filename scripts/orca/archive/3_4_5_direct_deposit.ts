import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../../target/types/tokenized_vault";
import { Strategy } from "../../../target/types/strategy";
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
} from "@solana/web3.js";
import * as dotenv from 'dotenv';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";

// Load environment variables
dotenv.config();

// Load deployment addresses based on environment
const ADDRESSES_FILE = path.join(__dirname, 'deployment_addresses', 'addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';

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

// Get underlying token mint
const UNDERLYING_MINT = new PublicKey(CONFIG.mints.underlying.address);

async function main() {
  try {
    // Setup Provider and Programs
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Load admin keypair
    const secretKeyPath = path.resolve(process.env.HOME!, ".config/solana/mainnet.json");
    const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(secretKeyPath, 'utf8')));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;

    // Get vault PDA
    const vaultIndex = 2;
    const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vaultIndex)]).buffer))
      ],
      vaultProgram.programId
    );

    console.log("Vault PDA:", vaultPDA.toBase58());

    // Get strategy PDA (using vaultIndex instead of hardcoded 0)
    const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
      [vaultPDA.toBuffer(), new BN(vaultIndex).toArrayLike(Buffer, 'le', 8)],
      strategyProgram.programId
    );

    console.log("Strategy PDA:", strategy.toBase58());

    // Get shares mint PDA
    const [sharesMint] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("shares"), vaultPDA.toBuffer()],
      vaultProgram.programId
    );
    
    // Get user's token accounts
    const userUsdcATA = await getAssociatedTokenAddress(UNDERLYING_MINT, admin.publicKey);

    const userSharesATA = await getOrCreateAssociatedTokenAccount(
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


    // Get vault and strategy token accounts
    const vaultUsdcATA = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("underlying"), vaultPDA.toBuffer()],
      vaultProgram.programId
    )[0];

    const strategyTokenAccount = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("underlying"), strategy.toBuffer()],
      strategyProgram.programId
    )[0];

    // Modify the remaining accounts generation
    const combinedRemainingAccounts = [];

    for (const [symbol, asset] of Object.entries(CONFIG.mints.assets)) {
      const assetMint = new PublicKey(asset.address);
      const whirlpoolAddress = new PublicKey(asset.pool.id);
      
      // Get strategy token account and invest tracker
      const [strategyAssetAccount] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("token_account"), assetMint.toBuffer(), strategy.toBuffer()],
        strategyProgram.programId
      );

      const [investTrackerAccount] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("invest_tracker"), assetMint.toBuffer(), strategy.toBuffer()],
        strategyProgram.programId
      );

      // Get invest tracker data first
      const investTracker = await strategyProgram.account.investTracker.fetch(investTrackerAccount);
      
      // Determine account order based on a_to_b_for_purchase
      const [tokenAccountA, tokenAccountB] = investTracker.aToBForPurchase
        ? [strategyTokenAccount, strategyAssetAccount]
        : [strategyAssetAccount, strategyTokenAccount];

      // Add logging for invest tracker PDA
      console.log(`\nInvest Tracker PDA for ${symbol}:`);
      console.log("Asset Mint:", assetMint.toBase58());
      console.log("Strategy:", strategy.toBase58());
      console.log("Invest Tracker Account:", investTrackerAccount.toBase58());
      
      // Verify the invest tracker account exists and fetch its data
      try {
        const trackerAccount = await strategyProgram.account.investTracker.fetch(investTrackerAccount);
        console.log("Invest Tracker Data:", {
          whirlpoolId: trackerAccount.whirlpoolId.toString(),
          assetMint: trackerAccount.assetMint.toString(),
          amountInvested: trackerAccount.amountInvested.toString(),
          amountWithdrawn: trackerAccount.amountWithdrawn.toString(),
          assetAmount: trackerAccount.assetAmount.toString(),
          assetPrice: trackerAccount.assetPrice.toString(),
          sqrtPrice: trackerAccount.sqrtPrice.toString(),
          assetValue: trackerAccount.assetValue.toString(),
          aToBForPurchase: trackerAccount.aToBForPurchase,
          assignedWeight: trackerAccount.assignedWeight,
          currentWeight: trackerAccount.currentWeight
        });
      } catch (error) {
        console.error(`Failed to fetch invest tracker for ${symbol}:`, error);
      }

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

    // Log initial balances
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

    // Read lookup table address from ALT.json
    const altJsonPath = path.join(__dirname, 'ALT', 'ALT.json');
    const altJson = JSON.parse(fs.readFileSync(altJsonPath, 'utf8'));
    
    // Load the lookup table
    const lookupTableAccount = (
      await provider.connection.getAddressLookupTable(new PublicKey(altJson.lookupTableAddress))
    ).value;
    
    if (!lookupTableAccount) {
      throw new Error(`Lookup table not found for address: ${altJson.lookupTableAddress}`);
    }

    console.log("Loaded lookup table:", altJson.lookupTableAddress);

    // Define deposit amount (5 USDC)
    const depositAmount = new BN(5).mul(new BN(10).pow(new BN(6)));

    // Set compute unit limit
    const computeUnitIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 600_000,
    });

    // Set compute unit price
    const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1,
    });

    // Get latest blockhash before creating transaction
    const latestBlockhash = await provider.connection.getLatestBlockhash();

    // Build the instruction for direct deposit
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

    // Create a TransactionMessage with the lookup table
    const messageV0 = new TransactionMessage({
      payerKey: admin.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [computeUnitIx, computePriceIx, depositIx],
    }).compileToV0Message([lookupTableAccount]);

    console.log("Lookup table account:", lookupTableAccount);
    
    // Create VersionedTransaction
    const transaction = new VersionedTransaction(messageV0);

    // Sign the transaction
    transaction.sign([admin]);

    // Send the transaction
    const txid = await provider.connection.sendTransaction(transaction);

    console.log("Direct deposit transaction executed successfully. Txid:", txid);

    // Wait for confirmation
    const confirmation = await provider.connection.confirmTransaction(txid, "confirmed");
    console.log("Transaction confirmed:", confirmation);

    // Log final balances and fetch all asset balances
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

    // Log final balances for each asset
    for (const [symbol, asset] of Object.entries(CONFIG.mints.assets)) {
      const assetMint = new PublicKey(asset.address);
      
      const [strategyAssetAccount] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("token_account"), assetMint.toBuffer(), strategy.toBuffer()],
        strategyProgram.programId
      );

      const [investTrackerAccount] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("invest_tracker"), 
          assetMint.toBuffer(), 
          strategy.toBuffer()
        ],
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
        currentWeight: investTracker.currentWeight
      });
    }

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
