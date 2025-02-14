import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../../target/types/tokenized_vault";
import { Strategy } from "../../../target/types/strategy";
import { AccessControl } from "../../../target/types/access_control";
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as borsh from 'borsh';
import * as fs from 'fs';
import * as path from 'path';
import { PublicKey } from "@solana/web3.js";
import * as dotenv from 'dotenv';
import { OrcaStrategyConfig, OrcaStrategyConfigSchema } from "../../../tests/utils/schemas";

dotenv.config();

// const ADDRESSES_FILE = path.join(__dirname, '..', 'deployment_addresses', 'add_addresses.json');
// const ADDRESSES_FILE = path.join(__dirname, '..', 'deployment_addresses', 'addresses.json');
// const ADDRESSES_FILE = path.join(__dirname, '..', 'deployment_addresses', 'share_price_test.json');
const ADDRESSES_FILE = path.join(__dirname, '..', 'deployment_addresses', 'add_addresses2.json');
// const ADDRESSES_FILE = path.join(__dirname, '..', 'deployment_addresses', 'add_addresses3.json');

const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';
const CONFIG = ADDRESSES[ENV];

if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

const underlyingMint = new PublicKey(CONFIG.mints.underlying.address);

// Add this function before main()
function getSecretKeyPath(): string {
  const ENV = process.env.CLUSTER || 'devnet';
  const filename = ENV === 'mainnet' ? 'mainnet.json' : 'id.json';
  return path.resolve(process.env.HOME!, '.config/solana', filename);
}

async function main() {
  try {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;

    // Update the admin keypair loading
    const secretKeyPath = getSecretKeyPath();
    const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log(`Adding new strategy on ${ENV}`);
    console.log("Admin Public Key:", admin.publicKey.toBase58());
    console.log("Strategy Program ID:", strategyProgram.programId.toBase58());
    console.log("Vault Program ID:", vaultProgram.programId.toBase58());
    console.log("Access Control Program ID:", accessControlProgram.programId.toBase58());

    // Get the latest vault index from config
    const configPDA = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      vaultProgram.programId
    )[0];
    
    const vaultConfig = await vaultProgram.account.config.fetch(configPDA);
    // const vaultIndex = vaultConfig.nextVaultIndex.toNumber() - 1;
    const vaultIndex = 1;
    
    if (vaultIndex < 0) {
      throw new Error("No vaults have been created yet");
    }

    console.log("Using latest Vault Index:", vaultIndex);
    console.log("Admin Public Key:", admin.publicKey.toBase58());

    // Calculate vault PDA
    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vaultIndex)]).buffer))
      ],
      vaultProgram.programId
    );
    console.log("Vault PDA:", vault.toBase58());

    // Verify admin has STRATEGIES_MANAGER role
    const [roles] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_role"),
        admin.publicKey.toBuffer(),
        Buffer.from([3]) // Role::StrategiesManager = 3
      ],
      accessControlProgram.programId
    );

    const [config_pda_accessControl] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("config"),
      ],
      accessControlProgram.programId
    );

    const config_accessControl = await accessControlProgram.account.config.fetch(config_pda_accessControl);
    console.log("Config owner:", config_accessControl.owner.toBase58());

    // // Verify the role exists
    // const role = await accessControlProgram.account.userRole.fetch(roles);
    // console.log("Role:", role);

    // Define the fixed order of assets for mainnet with their corresponding indices
    // strategy indices for vaultIndex = 1
    const assets = [
      { name: "wBTC", index: 2 },
      { name: "whETH", index: 3 },
      { name: "SOL", index: 4 }
    ];

    // strategy indices for vaultIndex = 2
    //     const assets = [
    //   { name: "BONK", index: 5 },
    //   { name: "PENGU", index: 6 },
    //   { name: "WIF", index: 7 }
    // ];

    // Specify which asset to initialize
    const assetToInitialize = assets[0]; // Change index to 0, 1, or 2 to select wBTC, whETH, or SOL
    const assetName = assetToInitialize.name;
    const strategyIndex = assetToInitialize.index;
    
    console.log(`Initializing strategy for ${assetName} (index: ${strategyIndex})...`);

    const strategyType = { orca: {} };

    if (!CONFIG.mints.assets[assetName]) {
      throw new Error(`Asset ${assetName} not found in config`);
    }

    const strategyConfig = new OrcaStrategyConfig({
      depositLimit: new BN(2_000_000_000),
      performanceFee: new BN(0),
      feeManager: admin.publicKey,
      whirlpoolId: new PublicKey(CONFIG.mints.assets[assetName].pool.id),
      assetMint: new PublicKey(CONFIG.mints.assets[assetName].address),
      assetDecimals: CONFIG.mints.assets[assetName].decimals,
      aToBForPurchase: CONFIG.mints.assets[assetName].investment_config.a_to_b_for_purchase,
    });

    // Serialize Strategy Configuration
    const configBytes = Buffer.from(borsh.serialize(OrcaStrategyConfigSchema, strategyConfig));
    console.log("Strategy Config Bytes:", configBytes);

    // Calculate strategy PDA using the new index (3, 4, or 5)
    const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
      [vault.toBuffer(), 
        new BN(strategyIndex).toArrayLike(Buffer, 'le', 8)
      ],
      strategyProgram.programId
    );
    console.log("Strategy PDA:", strategy.toBase58());

    // Initialize Strategy
    console.log("Initializing Strategy...");
    await strategyProgram.methods.initStrategy(strategyType, configBytes)
      .accounts({
        underlyingMint,
        vault,
        signer: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();
    console.log("Strategy initialized");

    await vaultProgram.methods.addStrategy(new BN(2000000000000))
    .accounts({
        vault,
        strategy,
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Strategy added to Vault");

    console.log("\nStrategy Initialization Summary:");
    console.log("Asset Name:", assetName);
    console.log("Strategy Index:", strategyIndex);
    console.log("Vault Address:", vault.toBase58());
    console.log("Strategy Address:", strategy.toBase58());

  } catch (error) {
    console.error("Error occurred:", error);
    throw error;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}); 