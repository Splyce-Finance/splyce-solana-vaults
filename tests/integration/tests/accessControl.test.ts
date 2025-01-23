import * as anchor from "@coral-xyz/anchor";
import {
  accessControlProgram,
  configOwner,
  connection,
} from "../setups/globalSetup";
import { assert, expect } from "chai";
import { errorStrings, ROLES, ROLES_BUFFER } from "../../utils/constants";
import { BN } from "@coral-xyz/anchor";
import { airdrop } from "../../utils/helpers";

const { ROLES_ADMIN, ...ROLES_SUCCESS_DATA } = ROLES;

describe("Access Control Tests", () => {
  it("Initalizing access control program with super configOwner when it is already initialized should revert", async function () {
    try {
      await accessControlProgram.methods
        .initialize()
        .accounts({
          admin: configOwner.publicKey,
        })
        .signers([configOwner])
        .rpc();
      assert.fail("Error was not thrown");
    } catch {
      assert.isTrue(true);
    }
  });

  it("Initalizing access control program with another account when it is already initialized should revert", async function () {
    const anotherconfigOwner = anchor.web3.Keypair.generate();
    try {
      await accessControlProgram.methods
        .initialize()
        .accounts({
          admin: anotherconfigOwner.publicKey,
        })
        .signers([anotherconfigOwner])
        .rpc();
      assert.fail("Error was not thrown");
    } catch {
      assert.isTrue(true);
    }
  });

  it("Setting Role Manager for any role with signer not being the config owner should revert", async function () {
    const vaultAdminInner = anchor.web3.Keypair.generate();
    await accessControlProgram.methods
      .setRole(ROLES.VAULTS_ADMIN, vaultAdminInner.publicKey)
      .accounts({
        signer: configOwner.publicKey,
      })
      .signers([configOwner])
      .rpc();
    try {
      await accessControlProgram.methods
        .setRoleManager(ROLES.VAULTS_ADMIN, ROLES.ROLES_ADMIN)
        .accounts({
          signer: vaultAdminInner.publicKey,
        })
        .signers([vaultAdminInner])
        .rpc();
      assert.fail("Error was not thrown");
    } catch (err) {
      expect(err.message).contains(errorStrings.addressConstraintViolated);
    }
  });

  it("Setting role manager with invalid role id should revert", async function () {
    try {
      await accessControlProgram.methods
        .setRoleManager(new BN(10), ROLES.ROLES_ADMIN)
        .accounts({
          signer: configOwner.publicKey,
        })
        .signers([configOwner])
        .rpc();
      assert.fail("Error was not thrown");
    } catch (err) {
      expect(err.message).contains(errorStrings.roleIdInvalid);
    }
  });

  it("Setting role manager with invalid manager role id should revert", async function () {
    try {
      await accessControlProgram.methods
        .setRoleManager(ROLES.VAULTS_ADMIN, new BN(10))
        .accounts({
          signer: configOwner.publicKey,
        })
        .signers([configOwner])
        .rpc();
      assert.fail("Error was not thrown");
    } catch (err) {
      expect(err.message).contains(errorStrings.roleIdInvalid);
    }
  });

  it("Setting ROLES_ADMIN role via set role method by the config owner should revert", async function () {
    const roleReceiver = anchor.web3.Keypair.generate();
    try {
      await accessControlProgram.methods
        .setRole(ROLES.ROLES_ADMIN, roleReceiver.publicKey)
        .accounts({
          signer: configOwner.publicKey,
        })
        .signers([configOwner])
        .rpc();
      assert.fail("Error was not thrown");
    } catch (err) {
      expect(err.message).contains(
        errorStrings.setRoleAdminMustBeCalledByOwner
      );
    }
  });

  for (const role in ROLES_SUCCESS_DATA) {
    it(`Setting ${role} role with signer being the corresponding role manager account is successful`, async function () {
      const roleReceiver = anchor.web3.Keypair.generate();
      if (role === "KYC_VERIFIED") {
        // Set KYC Provider role to kycProvider account
        const kycProvider = anchor.web3.Keypair.generate();
        await airdrop({
          connection,
          publicKey: kycProvider.publicKey,
          amount: 10e9,
        });
        await accessControlProgram.methods
          .setRole(ROLES.KYC_PROVIDER, kycProvider.publicKey)
          .accounts({
            signer: configOwner.publicKey,
          })
          .signers([configOwner])
          .rpc();

        // Then only set KYC Verified user
        await accessControlProgram.methods
          .setRole(ROLES[role], roleReceiver.publicKey)
          .accounts({
            signer: kycProvider.publicKey,
          })
          .signers([kycProvider])
          .rpc();
      } else {
        await accessControlProgram.methods
          .setRole(ROLES[role], roleReceiver.publicKey)
          .accounts({
            signer: configOwner.publicKey,
          })
          .signers([configOwner])
          .rpc();
      }

      const roleReceiverCorrespondingRole =
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("user_role"),
            roleReceiver.publicKey.toBuffer(),
            ROLES_BUFFER[role],
          ],
          accessControlProgram.programId
        )[0];

      const roleReceiverCorrespondingRoleAccount =
        await accessControlProgram.account.userRole.fetch(
          roleReceiverCorrespondingRole
        );

      assert.isTrue(roleReceiverCorrespondingRoleAccount.hasRole);
    });
  }

  it("Setting multiple roles to the same account by corresponding role manager account is successful", async function () {
    const roleReceiver = anchor.web3.Keypair.generate();
    for (const role in ROLES_SUCCESS_DATA) {
      if (role === "KYC_VERIFIED") {
        // Set KYC Provider role to kycProvider account
        const kycProvider = anchor.web3.Keypair.generate();
        await airdrop({
          connection,
          publicKey: kycProvider.publicKey,
          amount: 10e9,
        });
        await accessControlProgram.methods
          .setRole(ROLES.KYC_PROVIDER, kycProvider.publicKey)
          .accounts({
            signer: configOwner.publicKey,
          })
          .signers([configOwner])
          .rpc();

        // Then only set KYC Verified user
        await accessControlProgram.methods
          .setRole(ROLES[role], roleReceiver.publicKey)
          .accounts({
            signer: kycProvider.publicKey,
          })
          .signers([kycProvider])
          .rpc();
      } else {
        await accessControlProgram.methods
          .setRole(ROLES[role], roleReceiver.publicKey)
          .accounts({
            signer: configOwner.publicKey,
          })
          .signers([configOwner])
          .rpc();
      }
    }

    for (const role in ROLES_SUCCESS_DATA) {
      const roleReceiverCorrespondingRole =
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("user_role"),
            roleReceiver.publicKey.toBuffer(),
            ROLES_BUFFER[role],
          ],
          accessControlProgram.programId
        )[0];

      const roleReceiverCorrespondingRoleAccount =
        await accessControlProgram.account.userRole.fetch(
          roleReceiverCorrespondingRole
        );

      assert.isTrue(roleReceiverCorrespondingRoleAccount.hasRole);
    }
  });

  it("Setting a role via set role method by non role manager account should revert", async function () {
    const roleReceiver = anchor.web3.Keypair.generate();
    // KYC VERIFIED user's role manager is KYC_PROVIDER role, not ROLES_ADMIN
    try {
      await accessControlProgram.methods
        .setRole(ROLES.KYC_VERIFIED, roleReceiver.publicKey)
        .accounts({
          signer: configOwner.publicKey,
        })
        .signers([configOwner])
        .rpc();
      assert.fail("Error was not thrown");
    } catch (err) {
      expect(err.message).contains(
        errorStrings.accountExpectedToAlreadyBeInitialized
      );
    }
  });

  for (const role in ROLES_SUCCESS_DATA) {
    it(`Revoking ${role} role with signer being the corresponding role manager account is successful`, async function () {
      const roleReceiver = anchor.web3.Keypair.generate();
      if (role === "KYC_VERIFIED") {
        // Set KYC Provider role to kycProvider account
        const kycProvider = anchor.web3.Keypair.generate();
        await airdrop({
          connection,
          publicKey: kycProvider.publicKey,
          amount: 10e9,
        });
        await accessControlProgram.methods
          .setRole(ROLES.KYC_PROVIDER, kycProvider.publicKey)
          .accounts({
            signer: configOwner.publicKey,
          })
          .signers([configOwner])
          .rpc();

        // Set KYC Verified user
        await accessControlProgram.methods
          .setRole(ROLES[role], roleReceiver.publicKey)
          .accounts({
            signer: kycProvider.publicKey,
          })
          .signers([kycProvider])
          .rpc();
        // Revoke Role
        await accessControlProgram.methods
          .revokeRole(ROLES[role], roleReceiver.publicKey)
          .accounts({
            signer: kycProvider.publicKey,
            recipient: configOwner.publicKey,
          })
          .signers([kycProvider])
          .rpc();
      } else {
        await accessControlProgram.methods
          .setRole(ROLES[role], roleReceiver.publicKey)
          .accounts({
            signer: configOwner.publicKey,
          })
          .signers([configOwner])
          .rpc();
        // Revoke Role
        await accessControlProgram.methods
          .revokeRole(ROLES[role], roleReceiver.publicKey)
          .accounts({
            signer: configOwner.publicKey,
            recipient: configOwner.publicKey,
          })
          .signers([configOwner])
          .rpc();
      }

      const roleReceiverCorrespondingRole =
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("user_role"),
            roleReceiver.publicKey.toBuffer(),
            ROLES_BUFFER[role],
          ],
          accessControlProgram.programId
        )[0];

      try {
        await accessControlProgram.account.userRole.fetch(
          roleReceiverCorrespondingRole
        );
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).contains("Account does not exist or has no data");
      }
    });
  }

  it("Revoking a role that account did not have, with signer being the corresponding role manager should revert", async function () {
    const roleReceiver = anchor.web3.Keypair.generate();
    // Set Role
    await accessControlProgram.methods
      .setRole(ROLES.VAULTS_ADMIN, roleReceiver.publicKey)
      .accounts({
        signer: configOwner.publicKey,
      })
      .signers([configOwner])
      .rpc();
    // Revoke Role
    try {
      await accessControlProgram.methods
        .revokeRole(ROLES.STRATEGIES_MANAGER, roleReceiver.publicKey)
        .accounts({
          signer: configOwner.publicKey,
          recipient: configOwner.publicKey,
        })
        .signers([configOwner])
        .rpc();
      assert.fail("Error was not thrown.");
    } catch (err) {
      expect(err.message).contains(
        errorStrings.accountExpectedToAlreadyBeInitialized
      );
    }
    // Still has the existing role
    const roleReceiverVaultsAdminRole =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          roleReceiver.publicKey.toBuffer(),
          ROLES_BUFFER.VAULTS_ADMIN,
        ],
        accessControlProgram.programId
      )[0];

    const roleReceiverVaultsAdminRoleAccount =
      await accessControlProgram.account.userRole.fetch(
        roleReceiverVaultsAdminRole
      );

    assert.isTrue(roleReceiverVaultsAdminRoleAccount.hasRole);

    // Does not have the non-existing revoked role
    const roleReceiverStrategiesManagerRole =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          roleReceiver.publicKey.toBuffer(),
          ROLES_BUFFER.STRATEGIES_MANAGER,
        ],
        accessControlProgram.programId
      )[0];

    try {
      await accessControlProgram.account.userRole.fetch(
        roleReceiverStrategiesManagerRole
      );
      assert.fail("Error was not thrown");
    } catch (err) {
      expect(err.message).contains("Account does not exist or has no data");
    }
  });

  it("Revoking role with invalid role_id with signer being the corresponding role manager is successful", async function () {
    const roleReceiver = anchor.web3.Keypair.generate();
    // Set Role
    await accessControlProgram.methods
      .setRole(ROLES.VAULTS_ADMIN, roleReceiver.publicKey)
      .accounts({
        signer: configOwner.publicKey,
      })
      .signers([configOwner])
      .rpc();
    // Revoke Role
    try {
      await accessControlProgram.methods
        .revokeRole(new BN(10), roleReceiver.publicKey)
        .accounts({
          signer: configOwner.publicKey,
          recipient: configOwner.publicKey,
        })
        .signers([configOwner])
        .rpc();
      assert.fail("Error was not thrown.");
    } catch (err) {
      assert.isTrue(true);
    }

    // Still has the role
    const roleReceiverVaultsAdminRole =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          roleReceiver.publicKey.toBuffer(),
          ROLES_BUFFER.VAULTS_ADMIN,
        ],
        accessControlProgram.programId
      )[0];

    const roleReceiverVaultsAdminRoleAccount =
      await accessControlProgram.account.userRole.fetch(
        roleReceiverVaultsAdminRole
      );

    assert.isTrue(roleReceiverVaultsAdminRoleAccount.hasRole);
  });

  it("Revoking one role from account that has multiple roles and signer being the corresponding role manager is successful", async function () {
    const roleReceiver = anchor.web3.Keypair.generate();
    // Set Role One
    await accessControlProgram.methods
      .setRole(ROLES.VAULTS_ADMIN, roleReceiver.publicKey)
      .accounts({
        signer: configOwner.publicKey,
      })
      .signers([configOwner])
      .rpc();
    // Set Role Two
    await accessControlProgram.methods
      .setRole(ROLES.STRATEGIES_MANAGER, roleReceiver.publicKey)
      .accounts({
        signer: configOwner.publicKey,
      })
      .signers([configOwner])
      .rpc();

    // Revoke Role One
    await accessControlProgram.methods
      .revokeRole(ROLES.VAULTS_ADMIN, roleReceiver.publicKey)
      .accounts({
        signer: configOwner.publicKey,
        recipient: configOwner.publicKey,
      })
      .signers([configOwner])
      .rpc();

    // Doesn't have role one
    const roleReceiverVaultsAdminRole =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          roleReceiver.publicKey.toBuffer(),
          ROLES_BUFFER.VAULTS_ADMIN,
        ],
        accessControlProgram.programId
      )[0];

    try {
      await accessControlProgram.account.userRole.fetch(
        roleReceiverVaultsAdminRole
      );
      assert.fail("Error was not thrown");
    } catch (err) {
      expect(err.message).contains("Account does not exist or has no data");
    }

    // Still Has Role Two
    const roleReceiverStrategiesManagerRole =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          roleReceiver.publicKey.toBuffer(),
          ROLES_BUFFER.STRATEGIES_MANAGER,
        ],
        accessControlProgram.programId
      )[0];

    const roleReceiverStrategiesManagerRoleAccount =
      await accessControlProgram.account.userRole.fetch(
        roleReceiverStrategiesManagerRole
      );

    assert.isTrue(roleReceiverStrategiesManagerRoleAccount.hasRole);
  });
});
