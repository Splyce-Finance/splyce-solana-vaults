import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { Strategy } from "../../target/types/strategy";
import { AccessControl } from "../../target/types/access_control";
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as borsh from 'borsh';
import * as fs from 'fs';
import * as path from 'path';
import { PublicKey } from "@solana/web3.js";
import * as dotenv from 'dotenv';
import { OrcaStrategyConfig, OrcaStrategyConfigSchema } from "../../tests/utils/schemas";

dotenv.config();

const ADDRESSES_FILE = path.join(__dirname, 'deployment_addresses', 'add_addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';
const CONFIG = ADDRESSES[ENV];

if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

const underlyingMint = new PublicKey(CONFIG.mints.underlying.address);

async function main() {
  try {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;

    // Load Admin Keypair
    const secretKeyPath = path.resolve(process.env.HOME, '.config/solana/id.json');
    const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log(`Adding new strategy on ${ENV}`);
    console.log("Admin Public Key:", admin.publicKey.toBase58());
    console.log("Strategy Program ID:", strategyProgram.programId.toBase58());

    // Get the latest vault index from config
    const configPDA = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      vaultProgram.programId
    )[0];
    
    const vaultConfig = await vaultProgram.account.config.fetch(configPDA);
    const vaultIndex = vaultConfig.nextVaultIndex.toNumber() - 1;
    
    if (vaultIndex < 0) {
      throw new Error("No vaults have been created yet");
    }

    console.log("Using latest Vault Index:", vaultIndex);

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

    // Verify the role exists
    try {
      await accessControlProgram.account.userRole.fetch(roles);
    } catch (error) {
      throw new Error("Admin does not have STRATEGIES_MANAGER role");
    }

    // Define Strategy Configuration
    const strategyType = { orca: {} };
    const strategyConfig = new OrcaStrategyConfig({
      depositLimit: new BN(CONFIG.vault_config.deposit_limit),
      depositPeriodEnds: new BN(Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)), // 1 year from now
      lockPeriodEnds: new BN(Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)), // 1 week from now
      performanceFee: new BN(50),
      feeManager: admin.publicKey,
    });

    // Serialize Strategy Configuration
    const configBytes = Buffer.from(borsh.serialize(OrcaStrategyConfigSchema, strategyConfig));
    console.log("Strategy Config Bytes:", configBytes);

    // Calculate strategy PDA
    const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
      [vault.toBuffer(), 
        new BN(0).toArrayLike(Buffer, 'le', 8)
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

    // Add Strategy to Vault
    console.log("Adding Strategy to Vault...");
    await vaultProgram.methods.addStrategy(new BN(1000000000))
      .accounts({
        vault,
        strategy,
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Strategy added to Vault");

    console.log("Strategy initialization complete!");
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