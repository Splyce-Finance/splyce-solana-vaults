import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { Strategy } from "../../target/types/strategy";
import { BN } from "@coral-xyz/anchor";
import * as token from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as dotenv from 'dotenv';
import { formatInvestTrackerData } from "./utils/format-invest-tracker";

// Load environment variables
dotenv.config();

// Type definitions for config file structure
interface PoolConfig {
  id: string;
  token_vault_a: string;
  token_vault_b: string;
  oracle: string;
  tick_arrays: string[];
}

interface InvestmentConfig {
  a_to_b_for_purchase: boolean;
  assigned_weight_bps: number;
}

interface AssetConfig {
  address: string;
  decimals: number;
  pool: PoolConfig;
  investment_config: InvestmentConfig;
}

interface Config {
  programs: {
    whirlpool_program: string;
    token_program: string;
    token_metadata_program: string;
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

// Load deployment addresses based on environment
const ADDRESSES_FILE = path.join(__dirname, 'deployment_addresses', 'abridged_10_assets_addresses.json');
const ADDRESSES: { [env: string]: Config } = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';
const CONFIG = ADDRESSES[ENV];

if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

// Get program IDs and mints from config
const WHIRLPOOL_PROGRAM_ID = new PublicKey(CONFIG.programs.whirlpool_program);
const UNDERLYING_MINT = new PublicKey(CONFIG.mints.underlying.address);

async function main() {
  try {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Load admin keypair
    const secretKeyPath = path.resolve(
      process.env.HOME!,
      ".config/solana/mainnet.json"
    );
    const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(secretKeyPath, "utf8")));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    // Initialize Programs
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;

    // Define vault index
    const vaultIndex = 2; // third vault
    console.log("Using Vault Index:", vaultIndex);

    // Derive vault PDA
    const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        new BN(vaultIndex).toArrayLike(Buffer, 'le', 8)
      ],
      vaultProgram.programId
    );
    console.log("Vault PDA:", vaultPDA.toBase58());

    // Derive strategy PDA using vaultIndex
    const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
      [vaultPDA.toBuffer(), 
        new BN(vaultIndex).toArrayLike(Buffer, 'le', 8)
      ],
      strategyProgram.programId
    );
    console.log("Strategy PDA:", strategy.toBase58());

    // Get strategy token account
    const strategyTokenAccount = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("underlying"), strategy.toBuffer()],
      strategyProgram.programId,
    )[0];

    // Load Address Lookup Table
    const ALT_FILE = path.join(__dirname, 'ALT', 'ALT.json');
    const ALT_CONFIG = JSON.parse(fs.readFileSync(ALT_FILE, 'utf8'));
    console.log("Using Address Lookup Table:", ALT_CONFIG.lookupTableAddress);

    const lookupTableAccount = await provider.connection.getAddressLookupTable(
      new PublicKey(ALT_CONFIG.lookupTableAddress)
    ).then(res => res.value);

    if (!lookupTableAccount) {
      throw new Error("Lookup table not found");
    }

    // Define deploy amount
    const deployAmount = new BN(1).mul(new BN(10).pow(new BN(6))); // 1 USDC

    // Log initial USDC balances
    const initialStrategyUsdc = await provider.connection.getTokenAccountBalance(strategyTokenAccount);
    console.log("\nInitial Balances:");
    console.log("Strategy Token Account:", strategyTokenAccount.toBase58());
    console.log("Strategy USDC:", initialStrategyUsdc.value.uiAmount);

    // Check strategy's asset token account balances before deployment
    console.log("\nStrategy's asset token account balances before deployment:");
    for (const [symbol, asset] of Object.entries(CONFIG.mints.assets)) {
      const assetMint = new PublicKey(asset.address);
      
      // Get strategy's token account for this asset using same seeds as init_token_account.rs
      const [strategyAssetAccount] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("token_account"),
          assetMint.toBuffer(),
          strategy.toBuffer()
        ],
        strategyProgram.programId
      );

      try {
        const balance = await provider.connection.getTokenAccountBalance(strategyAssetAccount);
        console.log(`${symbol} Balance:`, {
          address: strategyAssetAccount.toBase58(),
          amount: balance.value.uiAmount,
          decimals: balance.value.decimals
        });
      } catch (error) {
        console.log(`${symbol} token account not yet initialized:`, strategyAssetAccount.toBase58());
      }
    }

    // Collect remaining accounts
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

      // Get invest tracker data
      const investTracker = await strategyProgram.account.investTracker.fetch(investTrackerAccount);
      
      // Determine account order based on a_to_b_for_purchase
      const [tokenAccountA, tokenAccountB] = investTracker.aToBForPurchase
        ? [strategyTokenAccount, strategyAssetAccount]
        : [strategyAssetAccount, strategyTokenAccount];

      // Log invest tracker data
      console.log(`\nInvest Tracker for ${symbol}:`, formatInvestTrackerData(investTracker));

      // Get tick arrays based on pool ID
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
        case '6NUiVmsNjsi4AfsMsEiaezsaV9N4N1ZrD4jEnuWNRvyb': //  JLP
          tickArrayAddresses = [
            'J9twoKR2DfmyvE8HX6fDraaY2q5oECkHpZgtySiJkpsV',
            'GeBC3bZ6ixc6BMXpyuA9eZDxtDudjZYS8pZswWrijGVk',
            '7ueP95xxpKL6rUqmBMUTvcMG1BXMooc4B7hm2mXKQp5k'
          ];
          break;
        case '3ndjN1nJVUKGrJBc1hhVpER6kWTZKHdyDrPyCJyX3CXK': //  KMNO
          tickArrayAddresses = [
            'Hy684vQNupY6fvtCuirdjUaf8wUhMwEseBqWKMy4S4YL',
            '9aMj1NkoqeT5a8DbawHv7t3aCLcqv4XEvCPVwtULkShp',
            'GEDHsNyxB8qV9iFMoAeT42iSjV5ehLqx1rUR92Eoh6Zz'
          ];
        case '7riFsDxbskTqDtCSjev2jN9hyAJqeKmbWqgfiWD6ikUC': //  USDY
          tickArrayAddresses = [
            'DfVnKPFCQmf48JATSAPzehiQDtmQkXdLc2U4zqEaLPFa',
            'B9P8LzeKLKCpypocPdauLVt4Ao31VvfTEpeJQSFZN8jq',
            '5kdjFutJDTqKYziRBvX9HoBNRuiqHaJ4HW476QEzz456'
          ];
          break;
        case '8hcwA1hr1bLGLHXBCadXWDgxsc1BTe4hAKPcQgTVNXL4': //  USDCet
          tickArrayAddresses = [
            'ACG8u3WjaNZWzp9pwYsP8gX25F63dc1dUACWwPqUQuKt',
            'GJZ9jbHzoBzi75GEMA3FLm8V7HeqSdC8X6UTaHT3vWje',
            '4keAqfWtMXmrdqJn9P7vrwQ6nA7opSeEfzZ2d7fm4F1Y'
          ];
          break;
        case 'B2i3TXHdtdDLYP5X2DhXZhUTpbqfzW3JKtBAH4sKAvnY': //  IO
          tickArrayAddresses = [
            '7Cdgb77ikfJDXsfyDxvnYzZfQ1L8FCQGQBnCWHjSgF56',
            '87pM4cDSmdubqym4qrNZuM4bSSfLGeoceEb6qaF3WDse',
            'F5zBmTjYBqnVHEvWLguz9qLs1Nqb8EhrRU7JDnUXKPG1'
          ];
          break;
        case '57xTqqteaKhQuXYSzNxb6yqZKHw7vBfsj927DznumJGP': //  NYAN
          tickArrayAddresses = [
            '3Xu868X1GoaavGTtJQDgZXJtFXdaxcDmQd1ihTaYvx2N',
            '2fMZ1XaExqntTN31P5ki74PVrK42h3b7Lmi6gMhcGN6v',
            '8K7PitU1hrtaU831ck5juNNpZjRy5dq9C7gYoZb5WC6V'
          ];
          break;
        case 'Gr7WKYBqRLt7oUkjZ54LSbiUf8EgNWcj3ogtN8dKbfeb': //  AURY
          tickArrayAddresses = [
            'GCthzwrm2q3p5pEbs7gQDk1syQacUZNfy95boKdUmCj9',
            'DGcDgUv8dhJNgVnYT234cDx4zCweKqgfjak3Zq1vbi6L',
            'GCgjTj8TP2BVCxF41JYLuewPdrvd3SZoyUQ89fHEfbQF'
          ];
          break;
        default:
          throw new Error(`No tick arrays defined for pool: ${asset.pool.id}`);
      }

      // Add accounts in the correct order
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
    const deployFundsIx = await strategyProgram.methods
      .deployFunds(deployAmount)
      .accounts({
        strategy: strategy,
        underlyingMint: UNDERLYING_MINT,
        signer: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(combinedRemainingAccounts)
      .instruction();

    // Add compute budget instructions
    const computeUnitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 900_000 });
    const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });

    // Build and send versioned transaction
    const { blockhash } = await provider.connection.getLatestBlockhash();

    const messageV0 = new TransactionMessage({
      payerKey: admin.publicKey,
      recentBlockhash: blockhash,
      instructions: [computeUnitIx, computePriceIx, deployFundsIx],
    }).compileToV0Message([lookupTableAccount]);

    const vtx = new VersionedTransaction(messageV0);
    vtx.sign([admin]);

    const sig = await provider.connection.sendTransaction(vtx);
    console.log("Deploy funds transaction sent:", sig);

    // Wait for confirmation
    await provider.connection.confirmTransaction({
      signature: sig,
      blockhash: blockhash,
      lastValidBlockHeight: await provider.connection.getBlockHeight()
    });

    console.log("Transaction confirmed!");

    // Check final USDC balance
    const finalStrategyUsdc = await provider.connection.getTokenAccountBalance(strategyTokenAccount);
    console.log("\nFinal Balances:");
    console.log("Strategy USDC:", finalStrategyUsdc.value.uiAmount);
    console.log("USDC Change:", finalStrategyUsdc.value.uiAmount - initialStrategyUsdc.value.uiAmount);

    // Check strategy's asset token account balances after deployment
    console.log("\nStrategy's asset token account balances after deployment:");
    for (const [symbol, asset] of Object.entries(CONFIG.mints.assets)) {
      const assetMint = new PublicKey(asset.address);
      
      const [strategyAssetAccount] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("token_account"),
          assetMint.toBuffer(),
          strategy.toBuffer()
        ],
        strategyProgram.programId
      );

      try {
        const balance = await provider.connection.getTokenAccountBalance(strategyAssetAccount);
        console.log(`${symbol} Balance:`, {
          address: strategyAssetAccount.toBase58(),
          amount: balance.value.uiAmount,
          decimals: balance.value.decimals
        });
      } catch (error) {
        console.log(`${symbol} token account not yet initialized:`, strategyAssetAccount.toBase58());
      }
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