import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Strategy } from "../../target/types/strategy";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { BN } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as dotenv from 'dotenv';
import { publicKey } from "@coral-xyz/anchor/dist/cjs/utils";

// Load environment variables and config
dotenv.config();
const ADDRESSES_FILE = path.join(__dirname, 'deployment_addresses', 'addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';
const CONFIG = ADDRESSES[ENV];

if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

// Add these interfaces near the top after imports
interface Config {
  nextVaultIndex: BN;
  nextWithdrawRequestIndex: BN;
}

interface WithdrawRequest {
  vault: PublicKey;
  user: PublicKey;
  recipient: PublicKey;
  requestedAmount: BN;
  maxLoss: BN;
  lockedShares: BN;
  index: BN;
}

interface AssetConfig {
  address: string;
  decimals: number;
  pool: {
    id: string;
    token_vault_a: string;
    token_vault_b: string;
    oracle: string;
  };
  investment_config: {
    a_to_b_for_purchase: boolean;
    assigned_weight_bps: number;
  };
}

const TICK_ARRAYS_FILE = path.join(__dirname, 'deployment_addresses', 'currentTickArrays.json');
const TICK_ARRAYS = JSON.parse(fs.readFileSync(TICK_ARRAYS_FILE, 'utf8'));

async function main() {
  try {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Load admin keypair
    const secretKeyPath = path.resolve(process.env.HOME!, ".config/solana/id.json");
    const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(secretKeyPath, 'utf8')));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;

    // Get config PDA and data
    const [configPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      vaultProgram.programId
    );
    const configAccount = await vaultProgram.account.config.fetch(configPDA);
    
    // Get vault PDA
    const vaultIndex = 0;
    const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), new BN(vaultIndex).toArrayLike(Buffer, 'le', 8)],
      vaultProgram.programId
    );

    // Get latest withdraw request index from config
    const withdrawRequestIndex = configAccount.nextWithdrawRequestIndex.subn(1); 

    // Get withdraw request PDA and data
    const [withdrawRequestPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("withdraw_request"),
        vaultPDA.toBuffer(),
        admin.publicKey.toBuffer(),
        new BN(withdrawRequestIndex).toArrayLike(Buffer, 'le', 8)
      ],
      vaultProgram.programId
    );
    console.log("Withdraw request PDA:", withdrawRequestPDA.toBase58());
    const withdrawRequest = await vaultProgram.account.withdrawRequest.fetch(withdrawRequestPDA);
    const totalRequestedAmount = withdrawRequest.requestedAmount;

    // Calculate amounts to free for each asset based on weights
    const assets = Object.entries(CONFIG.mints.assets) as [string, AssetConfig][];
    const totalWeight = assets.reduce((sum, [_, asset]) => sum + asset.investment_config.assigned_weight_bps, 0);
    
    for (const [symbol, asset] of assets) {
      try {
        // Get strategy PDA
        const strategyIndex = assets.findIndex(([s]) => s === symbol);
        const [strategy] = PublicKey.findProgramAddressSync(
          [vaultPDA.toBuffer(), new BN(strategyIndex).toArrayLike(Buffer, 'le', 8)],
          strategyProgram.programId
        );

        // Log before state
        const strategyAccountBefore = await strategyProgram.account.orcaStrategy.fetch(strategy);
        console.log(`\n${symbol} Strategy Before:`);
        console.log(`- Asset Amount: ${strategyAccountBefore.assetAmount.toString()}`);
        console.log(`- Idle Underlying: ${strategyAccountBefore.idleUnderlying.toString()}`);
        console.log(`- Total Assets: ${strategyAccountBefore.totalAssets.toString()}`);

        const weight = asset.investment_config.assigned_weight_bps;
        const amountToFree = new BN(totalRequestedAmount.toString())
          .mul(new BN(weight))
          .div(new BN(totalWeight));

        // Get strategy account to check a_to_b_for_purchase
        const strategyAccount = await strategyProgram.account.orcaStrategy.fetch(strategy);

        // Get token accounts
        const assetMint = new PublicKey(asset.address);
        const [strategyAssetAccount] = PublicKey.findProgramAddressSync(
          [Buffer.from("token_account"), assetMint.toBuffer(), strategy.toBuffer()],
          strategyProgram.programId
        );

        const [strategyTokenAccount] = PublicKey.findProgramAddressSync(
          [Buffer.from("underlying"), strategy.toBuffer()],
          strategyProgram.programId
        );

        // Log token balances before
        const assetBalanceBefore = (await provider.connection.getTokenAccountBalance(strategyAssetAccount)).value.amount;
        const tokenBalanceBefore = (await provider.connection.getTokenAccountBalance(strategyTokenAccount)).value.amount;
        console.log(`\n${symbol} Token Balances Before:`);
        console.log(`- Asset Account: ${assetBalanceBefore}`);
        console.log(`- Token Account: ${tokenBalanceBefore}`);

        console.log("aToBForPurchase", strategyAccount.aToBForPurchase);
        console.log("aToBForPurchase from config", asset.investment_config.a_to_b_for_purchase);
        // Then do the ordering
        const [tokenAccountA, tokenAccountB] = strategyAccount.aToBForPurchase
          ? [strategyTokenAccount, strategyAssetAccount]
          : [strategyAssetAccount, strategyTokenAccount];

        // Build remaining accounts with correct order
        const remainingAccounts = [
          { pubkey: new PublicKey(CONFIG.programs.whirlpool_program), isWritable: false, isSigner: false },
          { pubkey: new PublicKey(asset.pool.id), isWritable: true, isSigner: false },
          { pubkey: tokenAccountA, isWritable: true, isSigner: false },
          { pubkey: new PublicKey(asset.pool.token_vault_a), isWritable: true, isSigner: false },
          { pubkey: tokenAccountB, isWritable: true, isSigner: false },
          { pubkey: new PublicKey(asset.pool.token_vault_b), isWritable: true, isSigner: false },
          ...TICK_ARRAYS[ENV].assets[symbol].selling_tick_arrays.slice(0, 3).map(addr => ({
            pubkey: new PublicKey(addr),
            isWritable: true,
            isSigner: false
          })),
          { pubkey: new PublicKey(asset.pool.oracle), isWritable: true, isSigner: false },
        ];

        console.log(`\nFreeing funds for ${symbol}:`);
        console.log(`Amount to free: ${amountToFree.toString()}`);

        // Call free_funds instruction
        await strategyProgram.methods
          .freeFunds(amountToFree)
          .accounts({
            strategy: strategy,
            signer: admin.publicKey,
            underlyingMint: new PublicKey(CONFIG.mints.underlying.address),
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts(remainingAccounts)
          .signers([admin])
          .rpc();

        console.log(`Successfully freed funds for ${symbol}`);

        // Log token balances after
        const assetBalanceAfter = (await provider.connection.getTokenAccountBalance(strategyAssetAccount)).value.amount;
        const tokenBalanceAfter = (await provider.connection.getTokenAccountBalance(strategyTokenAccount)).value.amount;
        console.log(`\n${symbol} Token Balances After:`);
        console.log(`- Asset Account: ${assetBalanceAfter}`);
        console.log(`- Token Account: ${tokenBalanceAfter}`);

        // Log after state
        const strategyAccountAfter = await strategyProgram.account.orcaStrategy.fetch(strategy);
        console.log(`\n${symbol} Strategy After:`);
        console.log(`- Asset Amount: ${strategyAccountAfter.assetAmount.toString()}`);
        console.log(`- Idle Underlying: ${strategyAccountAfter.idleUnderlying.toString()}`);
        console.log(`- Total Assets: ${strategyAccountAfter.totalAssets.toString()}`);
        console.log('------------------------');

      } catch (error) {
        console.error(`Error processing ${symbol}:`, error);
        if ('logs' in error) {
          console.error("Program Logs:", error.logs);
        }
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