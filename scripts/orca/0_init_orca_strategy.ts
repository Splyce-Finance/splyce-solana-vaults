import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { Strategy } from "../../target/types/strategy";
import { Accountant } from "../../target/types/accountant";
import { OrcaStrategyConfig, OrcaStrategyConfigSchema } from "../../tests/utils/schemas";
import { BN } from "@coral-xyz/anchor";
import * as token from "@solana/spl-token";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as borsh from 'borsh';
import * as fs from 'fs';
import * as path from 'path';
import { AccessControl } from "../../target/types/access_control";
import { PublicKey } from "@solana/web3.js";
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Load deployment addresses based on environment
const ADDRESSES_FILE = path.join(__dirname, 'deployment_addresses', 'addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';
const CONFIG = ADDRESSES[ENV];

if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

const METADATA_SEED = "metadata";
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(CONFIG.programs.token_metadata_program);
const underlyingMint = new PublicKey(CONFIG.mints.underlying.address);
const REPORT_BOT = new PublicKey(CONFIG.roles.report_bot);
const accountantType = { generic: {} };

function getSecretKeyPath(): string {
  const ENV = process.env.CLUSTER || 'devnet';
  const filename = ENV === 'mainnet' ? 'mainnet.json' : 'id.json';
  return path.resolve(process.env.HOME!, '.config/solana', filename);
}

async function main() {
  try {
    // 1. Setup Provider and Programs
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const strategyProgram = anchor.workspace.Strategy as Program<Strategy>;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;
    const accountantProgram = anchor.workspace.Accountant as Program<Accountant>;

    // 2. Load Admin Keypair
    const secretKeyPath = getSecretKeyPath();
    const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log(`Initializing on ${ENV}`);
    console.log("Admin Public Key:", admin.publicKey.toBase58());
    console.log("Vault Program ID:", vaultProgram.programId.toBase58());
    console.log("Strategy Program ID:", strategyProgram.programId.toBase58());
    console.log("Access Control Program ID:", accessControlProgram.programId.toBase58());
    console.log("Accountant Program ID:", accountantProgram.programId.toBase58());

    // 3. Initialize Access Control
    console.log("Initializing Access Control...");
    await accessControlProgram.methods.initialize()
      .accounts({
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Access Control initialized.");

    // 4. Define Roles
    const ROLES = {
      ROLES_ADMIN: new BN(0),
      VAULTS_ADMIN: new BN(1),
      REPORTING_MANAGER: new BN(2),
      STRATEGIES_MANAGER: new BN(3),
      ACCOUNTANT_ADMIN: new BN(4),
      KYC_PROVIDER: new BN(5),
      KYC_VERIFIED: new BN(6),
    };

    // 5. Set Role Managers
    console.log("Setting Role Managers...");
    await accessControlProgram.methods.setRoleManager(ROLES.VAULTS_ADMIN, ROLES.ROLES_ADMIN)
      .accounts({
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Vaults Admin Role Manager set.");

    await accessControlProgram.methods.setRoleManager(ROLES.REPORTING_MANAGER, ROLES.ROLES_ADMIN)
      .accounts({
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Reporting Manager Role Manager set.");

    await accessControlProgram.methods.setRoleManager(ROLES.STRATEGIES_MANAGER, ROLES.ROLES_ADMIN)
      .accounts({
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Strategies Manager Role Manager set.");

    await accessControlProgram.methods.setRoleManager(ROLES.ACCOUNTANT_ADMIN, ROLES.ROLES_ADMIN)
      .accounts({
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Accountant Admin Role Manager set.");

    await accessControlProgram.methods.setRoleManager(ROLES.KYC_PROVIDER, ROLES.ROLES_ADMIN)
      .accounts({
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("KYC Provider Role Manager set.");

    await accessControlProgram.methods.setRoleManager(ROLES.KYC_VERIFIED, ROLES.KYC_PROVIDER)
      .accounts({
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("KYC Verified Role Manager set.");

    // 6. Assign Roles to Admin
    console.log("Assigning Roles to Admin...");
    await accessControlProgram.methods.setRole(ROLES.VAULTS_ADMIN, admin.publicKey)
      .accounts({
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Vaults Admin role assigned to Admin.");

    await accessControlProgram.methods.setRole(ROLES.REPORTING_MANAGER, admin.publicKey)
      .accounts({
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Reporting Manager role assigned to Admin.");

    await accessControlProgram.methods.setRole(ROLES.REPORTING_MANAGER, REPORT_BOT)
      .accounts({
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Reporting Manager role assigned to REPORT_BOT.");

    await accessControlProgram.methods.setRole(ROLES.STRATEGIES_MANAGER, admin.publicKey)
      .accounts({
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Strategies Manager role assigned to Admin.");

    await accessControlProgram.methods.setRole(ROLES.STRATEGIES_MANAGER, REPORT_BOT)
      .accounts({
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Strategies Manager role assigned to REPORT_BOT.");

    await accessControlProgram.methods.setRole(ROLES.VAULTS_ADMIN, REPORT_BOT)
      .accounts({
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Vaults Admin role assigned to REPORT_BOT.");

    await accessControlProgram.methods.setRole(ROLES.ACCOUNTANT_ADMIN, admin.publicKey)
      .accounts({
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Accountant Admin role assigned to Admin.");

    //set up accountant

        // 1. Initialize accountant config
        console.log("Initializing Accountant Config...");
        await accountantProgram.methods
        .initialize()
        .accounts({
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
        console.log("Accountant Config initialized.");

    // 2. Initialize accountant
    console.log("Initializing Accountant...");
    await accountantProgram.methods
      .initAccountant(accountantType)
      .accounts({
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Accountant initialized.");

      //calculate accountant PDA
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(new Uint8Array(new BigUint64Array([BigInt(0)]).buffer))
        ],
        accountantProgram.programId
      )[0];
      console.log("Accountant PDA:", accountant.toBase58());

    // 3. Initialize token account for accountant
    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        signer: admin.publicKey,
        accountant,
        mint:underlyingMint,
      })
      .signers([admin])
      .rpc();
    console.log("Accountant token account initialized.");

      //set fee
      console.log("Setting entry fee...");
      await accountantProgram.methods.setEntryFee(new BN(500))
      .accounts({
        accountant: accountant,
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
      console.log("Entry fee set.");


      //set fee
      console.log("Setting redemption fee...");
      await accountantProgram.methods.setRedemptionFee(new BN(500))
      .accounts({
        accountant: accountant,
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
      console.log("Redemption fee set.");

    // 7. Initialize Vault Config
    console.log("Initializing Vault Config...");
    const configPDA = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      vaultProgram.programId
    )[0];
    console.log("Config PDA:", configPDA.toBase58());
    // Try to initialize the config account
    try {
      console.log("Creating config account");
      await vaultProgram.methods.initialize()
        .accounts({
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
      console.log("Config account initialized");
    } catch (error) {
      console.log("Config account might already exist, continuing...");
    }

    // Simplify the config fetching logic for first vault
    const vaultIndex = 0; // first vault
    console.log("Using Vault Index:", vaultIndex);

    let vault = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(vaultIndex)]).buffer))
      ],
      vaultProgram.programId
    )[0];
    console.log("Vault PDA:", vault.toBase58());

    let sharesMint = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("shares"), vault.toBuffer()],
      vaultProgram.programId
    )[0];

    console.log("Shares Mint:", sharesMint.toBase58());
    
    // 8. Derive Metadata PDA for Vault Shares
    const [metadataAddress] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from(METADATA_SEED),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        sharesMint.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );
    console.log("Metadata Address:", metadataAddress.toBase58());

    // Update the vaultConfig object to match the expected structure
    const vaultConfig = {
        depositLimit: new BN(CONFIG.vault_config.deposit_limit),
        minUserDeposit: new BN(CONFIG.vault_config.min_user_deposit),
        userDepositLimit: new BN(CONFIG.vault_config.user_deposit_limit),
        accountant: accountant,          // Set accountant as accountant
        profitMaxUnlockTime: new BN(CONFIG.vault_config.profit_max_unlock_time), // 1 year in seconds
        kycVerifiedOnly: CONFIG.vault_config.kyc_verified_only,
        directDepositEnabled: CONFIG.vault_config.direct_deposit_enabled,
        whitelistedOnly: CONFIG.vault_config.whitelisted_only,
        directWithdrawEnabled: CONFIG.vault_config.direct_withdraw_enabled,
    };

    // 9. Initialize Vault
    console.log("Initializing Vault...");
    await vaultProgram.methods.initVault(vaultConfig)
      .accounts({
        underlyingMint,
        signer: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();
    console.log("Vault initialized.");
    

    // Whitelist admin for vault operations
    console.log("Whitelisting admin for vault3 operations");
    await vaultProgram.methods.whitelist(admin.publicKey)
      .accounts({
        vault: vault,
      })
      .signers([admin])
      .rpc();

    console.log("Admin whitelisted for vault operations");

    // 10. Initialize Vault Shares
    const sharesConfig = CONFIG.shares_config;
    console.log("Initializing Vault Shares...");
    await vaultProgram.methods.initVaultShares(new BN(vaultIndex), sharesConfig)
      .accounts({
        metadata: metadataAddress,
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Vault Shares initialized.");

    console.log("Initializing Share Token Account...");
    await accountantProgram.methods
    .initTokenAccount()
    .accounts({
      signer: admin.publicKey,
      accountant,
        mint: sharesMint,
      })
      .signers([admin])
      .rpc();
    console.log("Token Account initialized.");


    console.log("Initializing Underlying Token Account..");
    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        signer: admin.publicKey,
        accountant,
        mint:underlyingMint,
      })
      .signers([admin])
      .rpc();
    console.log("Token Account initialized.");


    // Initialize Strategy Program
    console.log("Initializing Strategy Program Config...");
    await strategyProgram.methods.initialize()
      .accounts({
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Strategy Program Config initialized.");

    // 12. Define Strategy Configuration
    const assets = Object.keys(CONFIG.mints.assets);
    console.log(`Initializing ${assets.length} strategies...`);

    const strategyType = { orca: {} };

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      console.log(`\nInitializing strategy for ${asset} (index: ${i})...`);
      
      const strategyConfig = new OrcaStrategyConfig({
        depositLimit: new BN(1_000_000_000),
        performanceFee: new BN(50),
        feeManager: admin.publicKey,
        whirlpoolId: new PublicKey(CONFIG.mints.assets[asset].pool.id),
        assetMint: new PublicKey(CONFIG.mints.assets[asset].address),
        assetDecimals: CONFIG.mints.assets[asset].decimals,
        aToBForPurchase: CONFIG.mints.assets[asset].investment_config.a_to_b_for_purchase,
      });

      // Serialize the config using borsh
      const configBytes = borsh.serialize(OrcaStrategyConfigSchema, strategyConfig);

      // Calculate Strategy PDA for this index
      const [strategy] = anchor.web3.PublicKey.findProgramAddressSync(
        [vault.toBuffer(), 
          new BN(i).toArrayLike(Buffer, 'le', 8)
        ],
        strategyProgram.programId
      );
      console.log(`Strategy ${i} PDA: ${strategy.toBase58()}`);

      console.log("underlyingMint:", underlyingMint);
      console.log("vault:", vault);
      console.log("TOKEN_PROGRAM_ID:", TOKEN_PROGRAM_ID);

      // Initialize Strategy
      await strategyProgram.methods.initStrategy(strategyType, Buffer.from(configBytes))
        .accounts({
          underlyingMint,
          vault,
          signer: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();
      console.log(`Strategy ${i} initialized`);

      // Add Strategy to Vault
      await vaultProgram.methods.addStrategy(new BN(20000000000))
        .accounts({
          vault,
          strategy,
          signer: admin.publicKey,
        })
        .signers([admin])
        .rpc();
      console.log(`Strategy ${i} added to Vault`);
    }

    // Log final summary
    console.log("\nStrategy Initialization Summary:");
    console.log(`Total strategies initialized: ${assets.length}`);
    console.log(`Strategy indices used: 0 to ${assets.length - 1}`);

  } catch (error) {
    console.error("Error occurred:", error);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});