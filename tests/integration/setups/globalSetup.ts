import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Strategy } from "../../../target/types/strategy";
import { TokenizedVault } from "../../../target/types/tokenized_vault";
import { airdrop } from "../../utils/helpers";
import { AccessControl } from "../../../target/types/access_control";
import { Accountant } from "../../../target/types/accountant";
import { assert } from "chai";
import { ROLES, ROLES_BUFFER } from "../../utils/constants";

anchor.setProvider(anchor.AnchorProvider.env());
export const provider = anchor.AnchorProvider.env();
export const workspace = anchor.workspace;
export const connection = provider.connection;
export let configOwner: anchor.web3.Keypair;

export const accessControlProgram =
  workspace.AccessControl as Program<AccessControl>;
export const vaultProgram = workspace.TokenizedVault as Program<TokenizedVault>;
export const strategyProgram = workspace.Strategy as Program<Strategy>;
export const accountantProgram = workspace.Accountant as Program<Accountant>;

export const TOKEN_METADATA_PROGRAM_ID = new anchor.web3.PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);
export const METADATA_SEED = "metadata";

export async function mochaGlobalSetup() {
  console.log("-------Global Setup Started-------");
  configOwner = anchor.web3.Keypair.generate();
  console.log("Super Admin public key:", configOwner.publicKey.toBase58());

  await airdrop({
    connection,
    publicKey: configOwner.publicKey,
    amount: 100e9,
  });

  await accessControlProgram.methods
    .initialize()
    .accounts({
      admin: configOwner.publicKey,
    })
    .signers([configOwner])
    .rpc();

  const config = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    accessControlProgram.programId
  )[0];

  const roleManagerRolesAdminRole =
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("role_manager"), ROLES_BUFFER.ROLES_ADMIN],
      accessControlProgram.programId
    )[0];

  const configOwnerRolesAdminRole =
    anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_role"),
        configOwner.publicKey.toBuffer(),
        ROLES_BUFFER.ROLES_ADMIN,
      ],
      accessControlProgram.programId
    )[0];

  const configAccount = await accessControlProgram.account.config.fetch(config);

  const roleManageRolesAdminRoleAccount =
    await accessControlProgram.account.roleManager.fetch(
      roleManagerRolesAdminRole
    );

  const configOwnerRolesAdminRoleAccount =
    await accessControlProgram.account.userRole.fetch(
      configOwnerRolesAdminRole
    );

  assert.equal(
    configAccount.owner.toString(),
    configOwner.publicKey.toString()
  );
  assert.equal(
    Number(roleManageRolesAdminRoleAccount.managerRoleId),
    Number(ROLES.ROLES_ADMIN)
  );
  assert.isTrue(configOwnerRolesAdminRoleAccount.hasRole);

  console.log(
    "Access Control program and Super Admin initialized successfully"
  );

  await accessControlProgram.methods
    .setRoleManager(ROLES.VAULTS_ADMIN, ROLES.ROLES_ADMIN)
    .accounts({
      signer: configOwner.publicKey,
    })
    .signers([configOwner])
    .rpc();

  await accessControlProgram.methods
    .setRoleManager(ROLES.STRATEGIES_MANAGER, ROLES.ROLES_ADMIN)
    .accounts({
      signer: configOwner.publicKey,
    })
    .signers([configOwner])
    .rpc();

  await accessControlProgram.methods
    .setRoleManager(ROLES.ACCOUNTANT_ADMIN, ROLES.ROLES_ADMIN)
    .accounts({
      signer: configOwner.publicKey,
    })
    .signers([configOwner])
    .rpc();

  await accessControlProgram.methods
    .setRoleManager(ROLES.REPORTING_MANAGER, ROLES.ROLES_ADMIN)
    .accounts({
      signer: configOwner.publicKey,
    })
    .signers([configOwner])
    .rpc();

  await accessControlProgram.methods
    .setRoleManager(ROLES.KYC_PROVIDER, ROLES.ROLES_ADMIN)
    .accounts({
      signer: configOwner.publicKey,
    })
    .signers([configOwner])
    .rpc();

  await accessControlProgram.methods
    .setRoleManager(ROLES.KYC_VERIFIED, ROLES.KYC_PROVIDER)
    .accounts({
      signer: configOwner.publicKey,
    })
    .signers([configOwner])
    .rpc();

  console.log("Setting role managers for all roles successfully");

  await vaultProgram.methods
    .initialize()
    .accounts({
      admin: configOwner.publicKey,
    })
    .signers([configOwner])
    .rpc();

  console.log("Vault program initialized successfully");

  await strategyProgram.methods
    .initialize()
    .accounts({
      admin: configOwner.publicKey,
    })
    .signers([configOwner])
    .rpc();

  console.log("Strategy program initialized successfully");

  await accountantProgram.methods
    .initialize()
    .accounts({
      admin: configOwner.publicKey,
    })
    .signers([configOwner])
    .rpc();

  console.log("Accountant program initalized successfully");

  console.log("-------Global Setup Finished-------");
}
