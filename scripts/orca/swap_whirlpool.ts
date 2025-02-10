/**
 * This script performs a swap on an Orca Whirlpool pool.
 *
 * Environment Variables:
 *   - RPC_ENDPOINT: the Solana RPC endpoint (e.g., https://api.devnet.solana.com)
 *   - CLUSTER: the cluster name (e.g., devnet or mainnet)
 *   - KEYPAIR_PATH: path to your Solana wallet keypair (e.g., ~/.config/solana/id.json)
 *   - POOL_ADDRESS: public key of the target Whirlpool pool
 */

import { Connection, PublicKey, Keypair, Transaction, Commitment } from '@solana/web3.js';
import { WhirlpoolContext, WhirlpoolClient } from '@orca-so/whirlpool-client-sdk';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as path from 'path';

dotenv.config();

// Helper function to load the keypair from file
function loadKeypair(keypairPath: string): Keypair {
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

// Helper function to compute the associated token account address
async function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
  const [ata] = await PublicKey.findProgramAddress(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

async function main() {
  // Load environment variables
  const rpcEndpoint = process.env.ANCHOR_PROVIDER_URL || 'https://api.devnet.solana.com';
  const cluster = process.env.CLUSTER || 'devnet';
  // Default to ~/.config/solana/id.json if KEYPAIR_PATH is not provided
  const keypairPath = process.env.KEYPAIR_PATH || `${process.env.HOME}/.config/solana/id.json`;

  // Read addresses from the deployed addresses file
  const addressesFile = path.join(__dirname, "deployment_addresses", "addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesFile, "utf8"));
  
  // Use CLUSTER env var (default 'devnet') for environment configuration
  const envConfig = addresses[cluster];
  if (!envConfig) {
    throw new Error(`No configuration found for environment: ${cluster}`);
  }

  // Define asset to swap. Options: "SOL", "BONK", "USDT", etc.
  const asset = "SAMO";
  const swapDirection: "buy" | "sell" = "buy"; // Change to "sell" to initiate a sell swap.

  const poolIdStr = envConfig.mints.assets[asset]?.pool?.id;
  if (!poolIdStr) {
    throw new Error(`No pool id found for asset: ${asset}`);
  }
  const poolAddress = new PublicKey(poolIdStr);

  // Setup connection and wallet
  const connection = new Connection(rpcEndpoint, 'confirmed');

  // Monkey-patch getRecentBlockhash to avoid the deprecated RPC call
  connection.getRecentBlockhash = async (commitment?: Commitment) => {
    const { blockhash } = await connection.getLatestBlockhash(commitment);
    // Return a dummy feeCalculator; adjust lamportsPerSignature if needed.
    return { blockhash, feeCalculator: { lamportsPerSignature: 5000 } };
  };

  const keypair = loadKeypair(keypairPath);
  // Create a wallet adapter that implements the Wallet interface
  const wallet = {
    publicKey: keypair.publicKey,
    signTransaction: async (tx: Transaction) => {
      tx.partialSign(keypair);
      return tx;
    },
    signAllTransactions: async (txs: Transaction[]) => {
      txs.forEach(tx => tx.partialSign(keypair));
      return txs;
    }
  };
  console.log(`Using wallet: ${wallet.publicKey.toBase58()}`);

  // Create the Whirlpool context and client.
  // IMPORTANT: Note that in addresses.json the whirlpool program key is stored under "whirlpool_program"
  const whirlpoolProgramId = new PublicKey(envConfig.programs.whirlpool_program);
  const whirlpoolContext = WhirlpoolContext.from(connection, wallet, whirlpoolProgramId);
  const whirlpoolClient = new WhirlpoolClient(whirlpoolContext);

  // Fetch the Whirlpool pool data
  const pool = await whirlpoolClient.getPool(poolAddress);
  if (!pool) {
    throw new Error(`Pool not found for address: ${poolAddress.toBase58()}`);
  }
  console.log(`Pool loaded for asset ${asset}: ${poolAddress.toBase58()}`);

  // --- Determine swap direction based on local variable and config
  // Set swapDirection to either "buy" or "sell"
  // Determine aToB for this asset from the config:
  // If buying, use the configured a_to_b_for_purchase; if selling, use its negation.
  const aToB = swapDirection === "buy" 
    ? envConfig.mints.assets[asset].investment_config.a_to_b_for_purchase 
    : !envConfig.mints.assets[asset].investment_config.a_to_b_for_purchase;

  console.log(`Swap direction set to ${swapDirection} (aToB=${aToB})`);

  // --- Load tick arrays from currentTickArrays.json based on the swap direction.
  const tickArraysFile = path.join(__dirname, "deployment_addresses", "currentTickArrays.json");
  const tickArraysData = JSON.parse(fs.readFileSync(tickArraysFile, "utf8"));
  
  // Use aToB as the indicator for which tick arrays to choose.
  const isAToB = aToB; 
  const tickAssetData = tickArraysData[cluster].assets[asset];
  if (!tickAssetData) {
    throw new Error(`No tick array data found for asset: ${asset} in currentTickArrays.json`);
  }
  const tickArrayAddresses = isAToB ? tickAssetData.buying_tick_arrays : tickAssetData.selling_tick_arrays;
  if (!tickArrayAddresses || tickArrayAddresses.length < 3) {
    throw new Error(`Not enough tick arrays defined for asset ${asset} (${isAToB ? 'buying' : 'selling'} mode)`);
  }
  const tickArray0 = new PublicKey(tickArrayAddresses[0]);
  const tickArray1 = new PublicKey(tickArrayAddresses[1]);
  const tickArray2 = new PublicKey(tickArrayAddresses[2]);

  // Use the deployed oracle address from addresses.json for the chosen asset
  const oracle = new PublicKey(envConfig.mints.assets[asset].pool.oracle);

  // Determine if the specified input amount should be considered as input (USDC-based).
  const amountSpecifiedIsInput = swapDirection === "buy";
  
  // --- Define swap parameters without slippage constraints --
  // Use BN, not u64
  const amount = new BN(1_000_000);
  let otherAmountThreshold;
  let sqrtPriceLimit;
  if (swapDirection === "buy") {
    // For a buy swap: Input is specified.
    // Minimum acceptable output is 0 and no explicit price limit is enforced.
    otherAmountThreshold = new BN(0);
    sqrtPriceLimit = new BN(0); // NO_EXPLICIT_SQRT_PRICE_LIMIT
  } else {
    // For a sell swap: Output is specified.
    // Allow spending up to the maximum u64 value.
    otherAmountThreshold = new BN("18446744073709551615"); // u64::MAX
    // Set the square root price limit based on the strategy's configuration:
    // If "a_to_b_for_purchase" (i.e. aToB) is true, use MAX_SQRT_PRICE_X64;
    // otherwise, use MIN_SQRT_PRICE_X64.
    if (aToB) {
      sqrtPriceLimit = new BN("79226673515401279992447579055"); // MAX_SQRT_PRICE_X64
    } else {
      sqrtPriceLimit = new BN("4295048016"); // MIN_SQRT_PRICE_X64
    }
  }

  // Derive the associated token accounts for token A and token B.
  const tokenOwnerAccountA = await getAssociatedTokenAddress(new PublicKey(pool.tokenMintA), wallet.publicKey);
  const tokenOwnerAccountB = await getAssociatedTokenAddress(new PublicKey(pool.tokenMintB), wallet.publicKey);

  // Extract vault addresses directly from the pool data, converting strings to PublicKey.
  const tokenVaultA = new PublicKey(pool.tokenVaultA);
  const tokenVaultB = new PublicKey(pool.tokenVaultB);

  const swapParams = {
    amount,
    otherAmountThreshold,
    sqrtPriceLimit,
    amountSpecifiedIsInput: amountSpecifiedIsInput,
    aToB: aToB,
    whirlpool: poolAddress,
    tokenAuthority: wallet.publicKey,
    tokenOwnerAccountA,
    tokenVaultA,
    tokenOwnerAccountB,
    tokenVaultB,
    tickArray0,
    tickArray1,
    tickArray2,
    oracle,
  };

  console.log('Building swap transaction...');
  const txBuilder = whirlpoolClient.swapTx(swapParams);

  console.log('Fetching latest blockhash...');
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const swapPayload = await txBuilder.build();
  const transaction = swapPayload.transaction;
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.publicKey;

  console.log('Signing transaction...');
  const signedTx = await wallet.signTransaction(transaction);
  const serializedTx = signedTx.serialize();

  console.log('Sending swap transaction...');
  const txId = await connection.sendRawTransaction(serializedTx, { skipPreflight: true });

  await connection.confirmTransaction({
    signature: txId,
    blockhash,
    lastValidBlockHeight
  }, 'confirmed');

  console.log(`Swap executed successfully. Transaction ID: ${txId}`);
}

main().catch(err => {
  console.error('Error executing swap:', err);
  process.exit(1);
}); 