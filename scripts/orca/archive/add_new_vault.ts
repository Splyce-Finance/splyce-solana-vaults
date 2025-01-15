import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { Accountant } from "../../target/types/accountant";
import { BN } from "@coral-xyz/anchor";
import * as token from "@solana/spl-token";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from 'fs';
import * as path from 'path';
import { PublicKey } from "@solana/web3.js";
import * as dotenv from 'dotenv';
import { AccessControl } from "../../target/types/access_control";

dotenv.config();

const ADDRESSES_FILE = path.join(__dirname, 'deployment_addresses', 'add_addresses.json');
const ADDRESSES = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8'));
const ENV = process.env.CLUSTER || 'devnet';
const CONFIG = ADDRESSES[ENV];

if (!CONFIG) {
  throw new Error(`No configuration found for environment: ${ENV}`);
}

const METADATA_SEED = "metadata";
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(CONFIG.programs.token_metadata_program);
const underlyingMint = new PublicKey(CONFIG.mints.underlying.address);

async function main() {
  try {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const vaultProgram = anchor.workspace.TokenizedVault as Program<TokenizedVault>;
    const accountantProgram = anchor.workspace.Accountant as Program<Accountant>;
    const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;

    // Load Admin Keypair
    const secretKeyPath = path.resolve(process.env.HOME, '.config/solana/id.json');
    const secretKeyString = fs.readFileSync(secretKeyPath, 'utf8');
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const admin = anchor.web3.Keypair.fromSecretKey(secretKey);

    console.log(`Initializing new vault on ${ENV}`);
    console.log("Admin Public Key:", admin.publicKey.toBase58());

    // Get the current vault count
    const configPDA = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      vaultProgram.programId
    )[0];
    
    const config = await vaultProgram.account.config.fetch(configPDA);
    const newVaultIndex = config.nextVaultIndex.toNumber();
    console.log("Creating new vault with index:", newVaultIndex);

    // Calculate vault PDA
    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(newVaultIndex)]).buffer))
      ],
      vaultProgram.programId
    );
    console.log("New Vault PDA:", vault.toBase58());

    // Calculate shares mint PDA
    const [sharesMint] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("shares"), vault.toBuffer()],
      vaultProgram.programId
    );

    // Calculate metadata PDA
    const [metadataAddress] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from(METADATA_SEED),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        sharesMint.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );

    // Get accountant PDA
    const accountant = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(0)]).buffer))
      ],
      accountantProgram.programId
    )[0];

    // Verify admin has VAULTS_ADMIN role before proceeding
    const [roles] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_role"),
        admin.publicKey.toBuffer(),
        Buffer.from([1]) // Role::VaultsAdmin = 1
      ],
      accessControlProgram.programId
    );

    // Create vault config
    const vaultConfig = {
      depositLimit: new BN(CONFIG.vault_config.deposit_limit),
      minUserDeposit: new BN(CONFIG.vault_config.min_user_deposit),
      accountant: accountant,
      profitMaxUnlockTime: new BN(CONFIG.vault_config.profit_max_unlock_time),
      kycVerifiedOnly: CONFIG.vault_config.kyc_verified_only,
      directDepositEnabled: CONFIG.vault_config.direct_deposit_enabled,
      whitelistedOnly: CONFIG.vault_config.whitelisted_only,
    };

    // Initialize new vault
    await vaultProgram.methods.initVault(vaultConfig)
      .accounts({
        underlyingMint,
        signer: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();
    console.log("New vault initialized");

    // Whitelist admin for vault operations
    await vaultProgram.methods.whitelist(admin.publicKey)
      .accounts({
        vault: vault,
      })
      .signers([admin])
      .rpc();
    console.log("Admin whitelisted for vault operations");

    // Initialize vault shares
    const sharesConfig = CONFIG.shares_config;
    await vaultProgram.methods.initVaultShares(new BN(newVaultIndex), sharesConfig)
      .accounts({
        metadata: metadataAddress,
        signer: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    console.log("Vault shares initialized");

    // Initialize accountant token accounts
    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        signer: admin.publicKey,
        accountant,
        underlyingMint: sharesMint,
      })
      .signers([admin])
      .rpc();

    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        signer: admin.publicKey,
        accountant,
        underlyingMint,
      })
      .signers([admin])
      .rpc();

    console.log("Initialization complete!");
    console.log("New Vault Address:", vault.toBase58());
    console.log("Shares Mint Address:", sharesMint.toBase58());

  } catch (error) {
    console.error("Error occurred:", error);
    throw error;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}); 