import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../../target/types/tokenized_vault";
import { Strategy } from "../../../target/types/strategy";
import * as fs from "fs";
import * as path from "path";
import { PublicKey, Connection, AddressLookupTableProgram } from "@solana/web3.js";
import * as dotenv from "dotenv";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

dotenv.config();

const ADDRESSES_FILE = path.join(__dirname, "..", "deployment_addresses", "abridged_10_assets_addresses.json");
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, "utf8"));
const ENV = process.env.CLUSTER || "devnet";

// We load an existing ALT address from "ALT.json"
const ALT_FILE = path.join(__dirname, "ALT.json");
const ALT_CONFIG = JSON.parse(fs.readFileSync(ALT_FILE, "utf8"));

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
  };
  mints: {
    underlying: {
      address: string;
      decimals: number;
      symbol: string;
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

async function main() {
  try {
    // --------------------------------------------
    // Setup Anchor provider + load keypair
    // --------------------------------------------
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const connection = provider.connection;
    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;

    const secretKeyPath = path.resolve(
      process.env.HOME!,
      `.config/solana/${ENV === "mainnet" ? "mainnet.json" : "id.json"}`
    );
    const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(secretKeyPath, "utf8")));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log(`\nExtending Address Lookup Table for ${ENV} environment.`);
    console.log("ALT Address:", ALT_CONFIG.lookupTableAddress);

    // --------------------------------------------
    // Fetch the existing LUT from chain
    // --------------------------------------------
    const lutPubkey = new PublicKey(ALT_CONFIG.lookupTableAddress);
    const initialLookupTableAccount = (await connection.getAddressLookupTable(lutPubkey)).value;
    if (!initialLookupTableAccount) {
      throw new Error(`Lookup table not found at: ${lutPubkey.toBase58()}`);
    }
    const originalCount = initialLookupTableAccount.state.addresses.length;
    console.log("Current LUT count:", originalCount);

    // --------------------------------------------
    // Derive the same addresses as your "create LUT" script
    // --------------------------------------------
    const vaultIndex = 2; // or 1, etc.
    console.log("Using Vault Index:", vaultIndex);

    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), new anchor.BN(vaultIndex).toArrayLike(Buffer, "le", 8)],
      vaultProgram.programId
    );
    const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
      [vault.toBuffer(), new anchor.BN(vaultIndex).toArrayLike(Buffer, "le", 8)],
      strategyProgram.programId
    );
    const [strategyData] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_data"), vault.toBuffer(), strategy.toBuffer()],
      vaultProgram.programId
    );
    const [strategyTokenAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("underlying"), strategy.toBuffer(), strategy.toBuffer()],
      strategyProgram.programId
    );

    // Gather addresses
    const newAddresses: PublicKey[] = [
      new PublicKey(CONFIG.programs.whirlpool_program),
      TOKEN_PROGRAM_ID,
      vault,
      strategy,
      strategyData,
      strategyTokenAccount,
    ];

    for (const [symbol, asset] of Object.entries(CONFIG.mints.assets)) {
      const assetMint = new PublicKey(asset.address);
      // Pool addresses
      newAddresses.push(
        new PublicKey(asset.pool.id),
        new PublicKey(asset.pool.token_vault_a),
        new PublicKey(asset.pool.token_vault_b),
        new PublicKey(asset.pool.oracle)
      );
      // tick arrays
      asset.pool.tick_arrays.forEach((tickAddr) => {
        newAddresses.push(new PublicKey(tickAddr));
      });
      // strategy PDAs
      const [strategyAssetAccount] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("token_account"), assetMint.toBuffer(), strategy.toBuffer()],
        strategyProgram.programId
      );
      const [investTracker] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("invest_tracker"), assetMint.toBuffer(), strategy.toBuffer()],
        strategyProgram.programId
      );

      console.log(`\nAsset: ${symbol}`);
      console.log("strategyAssetAccount:", strategyAssetAccount.toBase58());
      console.log("investTracker:", investTracker.toBase58());

      newAddresses.push(strategyAssetAccount, investTracker);
    }

    // Filter out duplicates and already in ALT
    const existingSet = new Set(initialLookupTableAccount.state.addresses.map((pk) => pk.toBase58()));
    const dedupSet = new Set<string>();
    const toAddFull: PublicKey[] = [];
    for (const pk of newAddresses) {
      const s = pk.toBase58();
      if (!dedupSet.has(s)) {
        dedupSet.add(s);
        if (!existingSet.has(s)) {
          toAddFull.push(pk);
        }
      }
    }

    if (toAddFull.length === 0) {
      console.log("No new addresses to add! Exiting.");
      return;
    }
    console.log(`\nWe have ${toAddFull.length} addresses missing in the LUT.`);

    // --------------------------------------------
    // Extend the LUT in chunks, with a re-check after any timeouts
    // --------------------------------------------
    const chunkSize = 20;
    let startIndex = 0;
    let chunkNumber = 1;

    // We'll keep a local "toAdd" pointer that we update each chunk
    // in case we need to re-check after a timeout
    while (startIndex < toAddFull.length) {
      // slice out the chunk
      const chunk = toAddFull.slice(startIndex, startIndex + chunkSize);
      const chunkStart = startIndex;
      startIndex += chunk.length;

      console.log(`\nExtending LUT with chunk #${chunkNumber} [size=${chunk.length}] ...`);
      chunkNumber++;

      // We'll keep trying to send this chunk until it's empty or successful
      while (true) {
        // If chunk is empty, skip
        if (chunk.length === 0) {
          console.log("All addresses in this chunk are already added. Moving on.");
          break;
        }

        // build the extend instruction
        const extendIx = AddressLookupTableProgram.extendLookupTable({
          authority: admin.publicKey,
          payer: admin.publicKey,
          lookupTable: lutPubkey,
          addresses: chunk,
        });
        const tx = new anchor.web3.Transaction().add(extendIx);

        try {
          await provider.sendAndConfirm(tx, [admin]);
          console.log(
            `  => Extended with addresses ${chunkStart + 1}..${chunkStart + chunk.length}.`
          );
          break; // success -> go next chunk
        } catch (err: any) {
          if (err.name === "TransactionExpiredTimeoutError") {
            console.error("Tx timed out. Re-checking LUT + waiting 10 seconds...");

            // Wait 10 seconds
            await new Promise((resolve) => setTimeout(resolve, 10_000));

            // Re-fetch LUT from chain
            const altAccount = (await connection.getAddressLookupTable(lutPubkey)).value;
            if (!altAccount) {
              console.error("Failed to refetch LUT? Will keep chunk as is and retry.");
              continue; // try again
            }

            // remove any newly included addresses from chunk
            const altSet = new Set(altAccount.state.addresses.map((pk) => pk.toBase58()));
            const remain: PublicKey[] = [];
            for (const addr of chunk) {
              if (!altSet.has(addr.toBase58())) {
                remain.push(addr);
              } else {
                console.log(`    Skipping ${addr.toBase58()} - already in LUT now.`);
              }
            }
            chunk.length = 0; // clear chunk
            chunk.push(...remain); // re-inject only the still-missing
            console.log(`    Re-trimmed chunk size: ${chunk.length}.`);
            // => loop again
          } else {
            throw err; // some other error -> fatal
          }
        }
      } // end while-true

      // after chunk is done, wait 1 block
      await waitForNewBlock(connection, 1);
    } // end while (startIndex < ...)

    // --------------------------------------------
    // Final check
    // --------------------------------------------
    const finalLookupTableAccount = (await connection.getAddressLookupTable(lutPubkey)).value;
    if (!finalLookupTableAccount) {
      throw new Error("Failed to fetch final LUT after extension!");
    }
    const finalCount = finalLookupTableAccount.state.addresses.length;
    console.log(
      `\nSuccessfully extended LUT. Count: from ${originalCount} -> ${finalCount} addresses.`
    );
    console.log("Done.");
  } catch (error) {
    console.error("Error occurred:", error);
    if ("logs" in error) {
      console.error("Program Logs:", error.logs);
    }
    process.exit(1);
  }
}

// A helper to wait 1 block
async function waitForNewBlock(connection: Connection, blocksToWait: number): Promise<void> {
  console.log(`Waiting for ${blocksToWait} block(s)...`);
  const startSlot = await connection.getSlot();
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      const currentSlot = await connection.getSlot();
      if (currentSlot >= startSlot + blocksToWait) {
        clearInterval(interval);
        console.log(`  => Next slot reached: ${currentSlot}`);
        resolve();
      }
    }, 1000);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});