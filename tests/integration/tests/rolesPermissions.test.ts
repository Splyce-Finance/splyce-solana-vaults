import * as anchor from "@coral-xyz/anchor";
import {
  accessControlProgram,
  accountantProgram,
  configOwner,
  connection,
  provider,
  strategyProgram,
  vaultProgram,
  METADATA_SEED,
  TOKEN_METADATA_PROGRAM_ID,
} from "../setups/globalSetup";
import { assert, expect } from "chai";
import { errorStrings, ROLES, ROLES_BUFFER } from "../../utils/constants";
import { BN } from "@coral-xyz/anchor";
import {
  airdrop,
  initializeSimpleStrategy,
  initializeVault,
} from "../../utils/helpers";
import * as token from "@solana/spl-token";
import { SimpleStrategyConfig } from "../../utils/schemas";

describe("Roles and Permissions Tests", () => {
  // Test Role Accounts
  let rolesAdmin: anchor.web3.Keypair;
  let accountantAdmin: anchor.web3.Keypair;
  let strategiesManager: anchor.web3.Keypair;
  let vaultsAdmin: anchor.web3.Keypair;
  let reportingManager: anchor.web3.Keypair;
  let kycProvider: anchor.web3.Keypair;
  let kycVerifiedUser: anchor.web3.Keypair;
  let nonVerifiedUser: anchor.web3.Keypair;

  // Accountant vars
  let accountantConfig: anchor.web3.PublicKey;
  let accountantConfigAccount: { nextAccountantIndex: BN };
  const accountantType = { generic: {} };

  // Common underlying mint and owner
  let underlyingMint: anchor.web3.PublicKey;
  let underlyingMintOwner: anchor.web3.Keypair;

  // User token and shares accounts
  let kycVerifiedUserTokenAccount: anchor.web3.PublicKey;
  let kycVerifiedUserSharesAccountVaultOne: anchor.web3.PublicKey;
  let kycVerifiedUserCurrentAmount: number;
  let strategiesManagerOneTokenAccount: anchor.web3.PublicKey;
  let strategiesManagerCurrentAmount: number;
  let nonVerifiedUserTokenAccount: anchor.web3.PublicKey;
  let nonVerifiedUserCurrentAmount: number;

  // First Test Vault
  let vaultOne: anchor.web3.PublicKey;
  let sharesMintOne: anchor.web3.PublicKey;
  let metadataAccountOne: anchor.web3.PublicKey;
  let vaultTokenAccountOne: anchor.web3.PublicKey;
  let strategyOne: anchor.web3.PublicKey;
  let strategyTokenAccountOne: anchor.web3.PublicKey;
  let accountantOne: anchor.web3.PublicKey;
  let feeRecipientOne: anchor.web3.Keypair;
  let feeRecipientSharesAccountOne: anchor.web3.PublicKey;
  let feeRecipientTokenAccountOne: anchor.web3.PublicKey;

  before(async () => {
    console.log("-------Before Step Started-------");
    // Generate Test Role Accounts
    rolesAdmin = configOwner;
    accountantAdmin = anchor.web3.Keypair.generate();
    strategiesManager = anchor.web3.Keypair.generate();
    vaultsAdmin = anchor.web3.Keypair.generate();
    reportingManager = anchor.web3.Keypair.generate();
    kycProvider = anchor.web3.Keypair.generate();
    kycVerifiedUser = anchor.web3.Keypair.generate();
    nonVerifiedUser = anchor.web3.Keypair.generate();
    feeRecipientOne = anchor.web3.Keypair.generate();

    // Airdrop to all accounts
    const publicKeysList = [
      accountantAdmin.publicKey,
      strategiesManager.publicKey,
      vaultsAdmin.publicKey,
      reportingManager.publicKey,
      kycProvider.publicKey,
      kycVerifiedUser.publicKey,
      nonVerifiedUser.publicKey,
      feeRecipientOne.publicKey,
    ];
    for (const publicKey of publicKeysList) {
      await airdrop({
        connection,
        publicKey,
        amount: 10e9,
      });
    }

    console.log(
      "Generate keypairs and airdrop to all test accounts successfully"
    );

    // Create common underlying mint account and set underlying mint owner
    underlyingMintOwner = configOwner;
    underlyingMint = await token.createMint(
      connection,
      underlyingMintOwner,
      underlyingMintOwner.publicKey,
      null,
      9
    );

    console.log(
      "Underlying mint owner and underlying mint set up successfully"
    );

    // Set Corresponding Roles
    await accessControlProgram.methods
      .setRole(ROLES.ACCOUNTANT_ADMIN, accountantAdmin.publicKey)
      .accounts({
        signer: rolesAdmin.publicKey,
      })
      .signers([rolesAdmin])
      .rpc();
    await accessControlProgram.methods
      .setRole(ROLES.STRATEGIES_MANAGER, strategiesManager.publicKey)
      .accounts({
        signer: rolesAdmin.publicKey,
      })
      .signers([rolesAdmin])
      .rpc();
    await accessControlProgram.methods
      .setRole(ROLES.VAULTS_ADMIN, vaultsAdmin.publicKey)
      .accounts({
        signer: rolesAdmin.publicKey,
      })
      .signers([rolesAdmin])
      .rpc();
    await accessControlProgram.methods
      .setRole(ROLES.REPORTING_MANAGER, reportingManager.publicKey)
      .accounts({
        signer: rolesAdmin.publicKey,
      })
      .signers([rolesAdmin])
      .rpc();
    await accessControlProgram.methods
      .setRole(ROLES.KYC_PROVIDER, kycProvider.publicKey)
      .accounts({
        signer: rolesAdmin.publicKey,
      })
      .signers([rolesAdmin])
      .rpc();
    await accessControlProgram.methods
      .setRole(ROLES.KYC_VERIFIED, kycVerifiedUser.publicKey)
      .accounts({
        signer: kycProvider.publicKey,
      })
      .signers([kycProvider])
      .rpc();
    console.log("Set all roles successfully");

    // Set up accountant config
    accountantConfig = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      accountantProgram.programId
    )[0];

    // Set up test vaults and strategies
    // Vault One
    accountantConfigAccount = await accountantProgram.account.config.fetch(
      accountantConfig
    );
    accountantOne = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from(
          new Uint8Array(
            new BigUint64Array([
              BigInt(accountantConfigAccount.nextAccountantIndex.toNumber()),
            ]).buffer
          )
        ),
      ],
      accountantProgram.programId
    )[0];

    await accountantProgram.methods
      .initAccountant(accountantType)
      .accounts({
        signer: accountantAdmin.publicKey,
      })
      .signers([accountantAdmin])
      .rpc();

    const vaultConfigOne = {
      depositLimit: new BN(1000000000),
      minUserDeposit: new BN(0),
      accountant: accountantOne,
      profitMaxUnlockTime: new BN(0),
      kycVerifiedOnly: true,
      directDepositEnabled: false,
      whitelistedOnly: false,
    };

    const sharesConfigOne = {
      name: "Test Roles and Permissions One",
      symbol: "TRPV1",
      uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
    };

    [vaultOne, sharesMintOne, metadataAccountOne, vaultTokenAccountOne] =
      await initializeVault({
        vaultProgram,
        underlyingMint,
        signer: vaultsAdmin,
        vaultConfig: vaultConfigOne,
        sharesConfig: sharesConfigOne,
      });

    feeRecipientSharesAccountOne = await token.createAccount(
      provider.connection,
      feeRecipientOne,
      sharesMintOne,
      feeRecipientOne.publicKey
    );
    feeRecipientTokenAccountOne = await token.createAccount(
      provider.connection,
      feeRecipientOne,
      underlyingMint,
      feeRecipientOne.publicKey
    );

    const strategyConfigOne = new SimpleStrategyConfig({
      depositLimit: new BN(1000),
      performanceFee: new BN(1000),
      feeManager: strategiesManager.publicKey,
    });

    [strategyOne, strategyTokenAccountOne] = await initializeSimpleStrategy({
      strategyProgram,
      vault: vaultOne,
      underlyingMint,
      signer: strategiesManager,
      config: strategyConfigOne,
    });

    await vaultProgram.methods
      .addStrategy(new BN(1000000000))
      .accounts({
        vault: vaultOne,
        strategy: strategyOne,
        signer: vaultsAdmin.publicKey,
      })
      .signers([vaultsAdmin])
      .rpc();

    console.log("Initialized vaults and strategies successfully");

    // Create token accounts and mint underlying tokens
    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        accountant: accountantOne,
        signer: accountantAdmin.publicKey,
        mint: sharesMintOne,
      })
      .signers([accountantAdmin])
      .rpc();

    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        accountant: accountantOne,
        signer: accountantAdmin.publicKey,
        mint: underlyingMint,
      })
      .signers([accountantAdmin])
      .rpc();

    kycVerifiedUserTokenAccount = await token.createAccount(
      connection,
      kycVerifiedUser,
      underlyingMint,
      kycVerifiedUser.publicKey
    );

    kycVerifiedUserSharesAccountVaultOne = await token.createAccount(
      provider.connection,
      kycVerifiedUser,
      sharesMintOne,
      kycVerifiedUser.publicKey
    );

    strategiesManagerOneTokenAccount = await token.createAccount(
      connection,
      strategiesManager,
      underlyingMint,
      strategiesManager.publicKey
    );

    nonVerifiedUserTokenAccount = await token.createAccount(
      connection,
      nonVerifiedUser,
      underlyingMint,
      nonVerifiedUser.publicKey
    );

    console.log("Token accounts and shares accounts created successfully");

    const mintAmount = 1000;

    await token.mintTo(
      connection,
      underlyingMintOwner,
      underlyingMint,
      kycVerifiedUserTokenAccount,
      underlyingMintOwner.publicKey,
      mintAmount
    );

    await token.mintTo(
      connection,
      underlyingMintOwner,
      underlyingMint,
      strategiesManagerOneTokenAccount,
      underlyingMintOwner.publicKey,
      mintAmount
    );

    await token.mintTo(
      connection,
      underlyingMintOwner,
      underlyingMint,
      nonVerifiedUserTokenAccount,
      underlyingMintOwner.publicKey,
      mintAmount
    );

    kycVerifiedUserCurrentAmount = mintAmount;
    strategiesManagerCurrentAmount = mintAmount;
    nonVerifiedUserCurrentAmount = mintAmount;

    console.log("Minted underlying token to all users successfully");

    console.log("-------Before Step Finished-------");
  });

  describe("Accountant Admin Role Tests", () => {
    it("Accountant Admin - Init accountant is successful", async function () {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const nextAccountantIndexBefore =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      await accountantProgram.methods
        .initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const nextAccountantIndexAfter =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      assert.strictEqual(
        nextAccountantIndexAfter,
        nextAccountantIndexBefore + 1
      );
    });

    it("Accountant Admin - Calling set fee method is successful", async function () {
      await accountantProgram.methods
        .setPerformanceFee(new BN(500))
        .accounts({
          accountant: accountantOne,
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      let genericAccountant =
        await accountantProgram.account.genericAccountant.fetch(accountantOne);
      assert.strictEqual(genericAccountant.performanceFee.toNumber(), 500);
    });

    it("Accountant Admin - Calling distribute method is successful", async function () {
      try {
        await accountantProgram.methods
          .distribute()
          .accounts({
            recipient: feeRecipientSharesAccountOne,
            accountant: accountantOne,
            underlyingMint: sharesMintOne,
            signer: accountantAdmin.publicKey,
          })
          .signers([accountantAdmin])
          .rpc();
        assert.isTrue(true);
      } catch {
        assert.fail("Error was thrown");
      }
    });

    it("Accountant Admin - Calling init strategy method should revert", async () => {
      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1),
        feeManager: strategiesManager.publicKey,
      });

      try {
        await initializeSimpleStrategy({
          strategyProgram,
          vault: vaultOne,
          underlyingMint,
          signer: accountantAdmin,
          config: strategyConfig,
        });
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });

    it("Accountant Admin - Calling add strategy method should revert", async () => {
      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vaultOne,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      try {
        await vaultProgram.methods
          .addStrategy(new BN(1000000000))
          .accounts({
            vault: vaultOne,
            strategy,
            signer: accountantAdmin.publicKey,
          })
          .signers([accountantAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_data"),
          vaultOne.toBuffer(),
          strategy.toBuffer(),
        ],
        vaultProgram.programId
      )[0];

      const strategyDataAccount =
        await vaultProgram.account.strategyData.fetchNullable(strategyData);
      assert.isNull(strategyDataAccount);
    });

    it("Accountant Admin - Calling remove strategy method should revert", async () => {
      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vaultOne,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      await vaultProgram.methods
        .addStrategy(new BN(1000000000))
        .accounts({
          vault: vaultOne,
          strategy,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const strategyDataBefore = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_data"),
          vaultOne.toBuffer(),
          strategy.toBuffer(),
        ],
        vaultProgram.programId
      )[0];

      try {
        await vaultProgram.methods
          .removeStrategy(strategy, false)
          .accounts({
            vault: vaultOne,
            strategyData: strategyDataBefore,
            recipient: vaultsAdmin.publicKey,
            signer: accountantAdmin.publicKey,
          })
          .signers([accountantAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const strategyDataAfter = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_data"),
          vaultOne.toBuffer(),
          strategy.toBuffer(),
        ],
        vaultProgram.programId
      )[0];

      const strategyDataAccount =
        await vaultProgram.account.strategyData.fetchNullable(
          strategyDataAfter
        );
      assert.isNotNull(strategyDataAccount);
    });

    it("Accountant Admin - Calling init vault method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      try {
        await vaultProgram.methods
          .initVault(vaultConfig)
          .accounts({
            underlyingMint,
            signer: accountantAdmin.publicKey,
            tokenProgram: token.TOKEN_PROGRAM_ID,
          })
          .signers([accountantAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });

    it("Accountant Admin - Calling init vault shares method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      await vaultProgram.methods
        .initVault(vaultConfig)
        .accounts({
          underlyingMint,
          signer: vaultsAdmin.publicKey,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([vaultsAdmin])
        .rpc();

      const config = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        vaultProgram.programId
      )[0];

      let configAccount = await vaultProgram.account.config.fetch(config);

      const nextVaultIndex = configAccount.nextVaultIndex.toNumber();

      const vault = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("vault"),
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(nextVaultIndex)]).buffer)
          ),
        ],
        vaultProgram.programId
      )[0];

      const sharesMint = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("shares"), vault.toBuffer()],
        vaultProgram.programId
      )[0];

      const [metadataAddress] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(METADATA_SEED),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          sharesMint.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );

      const sharesConfig = {
        name: "Localnet Tests Token",
        symbol: "LTT1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      try {
        await vaultProgram.methods
          .initVaultShares(new BN(nextVaultIndex), sharesConfig)
          .accounts({
            metadata: metadataAddress,
            signer: accountantAdmin.publicKey,
          })
          .signers([accountantAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let configAccountAfter = await vaultProgram.account.config.fetch(config);

      assert.strictEqual(
        configAccountAfter.nextVaultIndex.toNumber(),
        nextVaultIndex
      );

      // initVaultShares successfully to avoid conflicts in following tests
      await vaultProgram.methods
        .initVaultShares(new BN(nextVaultIndex), sharesConfig)
        .accounts({
          metadata: metadataAddress,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();
    });

    it("Accountant Admin - Calling shutdown vault method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      try {
        await vaultProgram.methods
          .shutdownVault()
          .accounts({ vault, signer: accountantAdmin.publicKey })
          .signers([accountantAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(vaultAccount.isShutdown, false);
      assert.strictEqual(vaultAccount.depositLimit.toNumber(), 1000000000);
    });

    it("Accountant Admin - Calling close vault method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      await vaultProgram.methods
        .shutdownVault()
        .accounts({ vault, signer: vaultsAdmin.publicKey })
        .signers([vaultsAdmin])
        .rpc();

      try {
        await vaultProgram.methods
          .closeVault()
          .accounts({
            vault,
            signer: accountantAdmin.publicKey,
            recipient: accountantAdmin.publicKey,
          })
          .signers([accountantAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultAccount = await vaultProgram.account.vault.fetchNullable(vault);
      assert.isNotNull(vaultAccount);
    });

    it("Accountant Admin - Calling update debt method should revert", async () => {
      const depositAmount = 100;
      const allocationAmount = 100;

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1000),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vault,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      await vaultProgram.methods
        .addStrategy(new BN(1000000000))
        .accounts({
          vault: vault,
          strategy: strategy,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const kycVerifiedUserSharesAccount = await token.createAccount(
        provider.connection,
        kycVerifiedUser,
        sharesMint,
        kycVerifiedUser.publicKey
      );

      const kycVerified = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          kycVerifiedUser.publicKey.toBuffer(),
          ROLES_BUFFER.KYC_VERIFIED,
        ],
        accessControlProgram.programId
      )[0];

      const accountantType = { generic: {} };

      await accountantProgram.methods.initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      await accountantProgram.methods.initTokenAccount()
        .accounts({
          accountant: accountant,
          signer: accountantAdmin.publicKey,
          mint: sharesMint,
        })
        .signers([accountantAdmin])
        .rpc();

      await vaultProgram.methods
        .deposit(new BN(depositAmount))
        .accounts({
          vault: vault,
          accountant: accountant,
          user: kycVerifiedUser.publicKey,
          userTokenAccount: kycVerifiedUserTokenAccount,
          userSharesAccount: kycVerifiedUserSharesAccount,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([kycVerifiedUser])
        .remainingAccounts([
          { pubkey: kycVerified, isWritable: false, isSigner: false },
        ])
        .rpc();

      kycVerifiedUserCurrentAmount -= depositAmount;

      try {
        await vaultProgram.methods
          .updateDebt(new BN(allocationAmount))
          .accounts({
            vault: vault,
            strategy: strategy,
            signer: accountantAdmin.publicKey,
            underlyingMint: underlyingMint,
            tokenProgram: token.TOKEN_PROGRAM_ID,
          })
          .signers([accountantAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultTokenAccountInfo = await token.getAccount(
        provider.connection,
        vaultTokenAccount
      );
      assert.strictEqual(
        vaultTokenAccountInfo.amount.toString(),
        depositAmount.toString()
      );

      let strategyTokenAccountInfo = await token.getAccount(
        provider.connection,
        strategyTokenAccount
      );
      assert.strictEqual(strategyTokenAccountInfo.amount.toString(), "0");

      let strategyAccount = await strategyProgram.account.simpleStrategy.fetch(
        strategy
      );
      assert.strictEqual(strategyAccount.totalAssets.toString(), "0");

      const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("strategy_data"), vault.toBuffer(), strategy.toBuffer()],
        vaultProgram.programId
      )[0];
      const strategyDataAccount = await vaultProgram.account.strategyData.fetch(
        strategyData
      );

      assert.strictEqual(strategyDataAccount.currentDebt.toString(), "0");

      const vaultAccount = await vaultProgram.account.vault.fetch(vault);

      assert.strictEqual(vaultAccount.totalDebt.toString(), "0");
      assert.strictEqual(
        vaultAccount.totalIdle.toString(),
        depositAmount.toString()
      );
    });

    it("Accountant Admin - Calling set deposit limit method should revert", async () => {
      const newDepositLimit = new BN(2000000000);

      try {
        await vaultProgram.methods
          .setDepositLimit(newDepositLimit)
          .accounts({
            vault: vaultOne,
            signer: accountantAdmin.publicKey,
          })
          .signers([accountantAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultAccount = await vaultProgram.account.vault.fetch(vaultOne);
      assert.strictEqual(vaultAccount.depositLimit.toString(), "1000000000");
    });

    it("Accountant Admin - Calling set min user deposit method should revert", async () => {
      const newMinUserDeposit = 100;

      try {
        await vaultProgram.methods
          .setMinUserDeposit(new BN(newMinUserDeposit))
          .accounts({
            vault: vaultOne,
            signer: accountantAdmin.publicKey,
          })
          .signers([accountantAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const vaultAccount = await vaultProgram.account.vault.fetch(vaultOne);
      assert.strictEqual(vaultAccount.minUserDeposit.toString(), "0");
    });

    it("Accountant Admin - Calling set profit max unlock time method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const newProfitMaxUnlockTime = 1;

      try {
        await vaultProgram.methods
          .setProfitMaxUnlockTime(new BN(newProfitMaxUnlockTime))
          .accounts({
            vault: vault,
            signer: accountantAdmin.publicKey,
          })
          .signers([accountantAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(vaultAccount.profitMaxUnlockTime.toString(), "0");
    });

    it("Accountant Admin - Calling set min total idle method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const newMinTotalIdle = 1;

      try {
        await vaultProgram.methods
          .setMinTotalIdle(new BN(1))
          .accounts({
            vault: vault,
            signer: accountantAdmin.publicKey,
          })
          .signers([accountantAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(vaultAccount.minimumTotalIdle.toString(), "0");
    });

    it("Accountant Admin - Calling process report method should revert", async () => {
      const depositAmount = 100;
      const allocationAmount = 100;

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1000),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vault,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      await vaultProgram.methods
        .addStrategy(new BN(1000000000))
        .accounts({
          vault: vault,
          strategy: strategy,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const kycVerifiedUserSharesAccount = await token.createAccount(
        provider.connection,
        kycVerifiedUser,
        sharesMint,
        kycVerifiedUser.publicKey
      );

      const kycVerified = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          kycVerifiedUser.publicKey.toBuffer(),
          ROLES_BUFFER.KYC_VERIFIED,
        ],
        accessControlProgram.programId
      )[0];

      const accountantType = { generic: {} };

      await accountantProgram.methods.initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      await accountantProgram.methods.initTokenAccount()
        .accounts({
          accountant: accountant,
          signer: accountantAdmin.publicKey,
          mint: sharesMint,
        })
        .signers([accountantAdmin])
        .rpc();

      await vaultProgram.methods
        .deposit(new BN(depositAmount))
        .accounts({
          vault: vault,
          accountant: accountant,
          user: kycVerifiedUser.publicKey,
          userTokenAccount: kycVerifiedUserTokenAccount,
          userSharesAccount: kycVerifiedUserSharesAccount,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([kycVerifiedUser])
        .remainingAccounts([
          { pubkey: kycVerified, isWritable: false, isSigner: false },
        ])
        .rpc();

      kycVerifiedUserCurrentAmount -= depositAmount;

      await vaultProgram.methods
        .updateDebt(new BN(allocationAmount))
        .accounts({
          vault: vault,
          strategy: strategy,
          signer: vaultsAdmin.publicKey,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([vaultsAdmin])
        .rpc();

      await strategyProgram.methods
        .reportProfit(new BN(10))
        .accounts({
          strategy: strategyOne,
          signer: strategiesManager.publicKey,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          {
            pubkey: strategiesManagerOneTokenAccount,
            isWritable: true,
            isSigner: false,
          },
        ])
        .signers([strategiesManager])
        .rpc();

      try {
        await vaultProgram.methods
          .processReport()
          .accounts({
            vault: vaultOne,
            strategy: strategyOne,
            signer: accountantAdmin.publicKey,
            accountant: accountantOne,
          })
          .signers([accountantAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });

    it("Accountant Admin - Calling deposit method for kyc verified only vault should revert", async () => {
      const depositAmount = 50;

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const sharesAccount = await token.createAccount(
        provider.connection,
        accountantAdmin,
        sharesMint,
        accountantAdmin.publicKey
      );

      const tokenAccount = await token.createAccount(
        connection,
        accountantAdmin,
        underlyingMint,
        accountantAdmin.publicKey
      );

      const mintAmount = 1000;

      await token.mintTo(
        connection,
        underlyingMintOwner,
        underlyingMint,
        tokenAccount,
        underlyingMintOwner.publicKey,
        mintAmount
      );

      const kycVerified = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          accountantAdmin.publicKey.toBuffer(),
          ROLES_BUFFER.KYC_VERIFIED,
        ],
        accessControlProgram.programId
      )[0];

      const accountantType = { generic: {} };

      await accountantProgram.methods.initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      await accountantProgram.methods.initTokenAccount()
        .accounts({
          accountant: accountant,
          signer: accountantAdmin.publicKey,
          mint: sharesMint,
        })
        .signers([accountantAdmin])
        .rpc();

      try {
        await vaultProgram.methods
          .deposit(new BN(depositAmount))
          .accounts({
            vault: vault,
            accountant: accountant,
            user: accountantAdmin.publicKey,
            userTokenAccount: tokenAccount,
            userSharesAccount: sharesAccount,
            underlyingMint: underlyingMint,
            tokenProgram: token.TOKEN_PROGRAM_ID,
          })
          .signers([accountantAdmin])
          .remainingAccounts([
            {
              pubkey: kycVerified,
              isWritable: false,
              isSigner: false,
            },
          ])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(errorStrings.kycRequired);
      }

      let vaultTokenAccountInfo = await token.getAccount(
        provider.connection,
        vaultTokenAccount
      );

      assert.strictEqual(vaultTokenAccountInfo.amount.toString(), "0");

      let userTokenAccountInfo = await token.getAccount(
        provider.connection,
        nonVerifiedUserTokenAccount
      );
      assert.strictEqual(
        userTokenAccountInfo.amount.toString(),
        nonVerifiedUserCurrentAmount.toString()
      );

      let userSharesAccountInfo = await token.getAccount(
        provider.connection,
        sharesAccount
      );
      assert.strictEqual(userSharesAccountInfo.amount.toString(), "0");
    });
  });

  describe("Strategies Manager Role Tests", () => {
    it("Strategies Manager - Calling init strategy method is successful", async () => {
      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vaultOne,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      const strategyAccount =
        await strategyProgram.account.simpleStrategy.fetch(strategy);
      expect(strategyAccount.manager.toString()).to.equal(
        strategiesManager.publicKey.toBase58()
      );
    });

    it("Strategies Manager - Init accountant should revert", async function () {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const nextAccountantIndexBefore =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      try {
        await accountantProgram.methods
          .initAccountant(accountantType)
          .accounts({
            signer: strategiesManager.publicKey,
          })
          .signers([strategiesManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const nextAccountantIndexAfter =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      assert.strictEqual(nextAccountantIndexAfter, nextAccountantIndexBefore);
    });

    it("Strategies Manager - Calling set fee method should revert", async function () {
      try {
        await accountantProgram.methods
          .setPerformanceFee(new BN(100))
          .accounts({
            accountant: accountantOne,
            signer: strategiesManager.publicKey,
          })
          .signers([strategiesManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let genericAccountant =
        await accountantProgram.account.genericAccountant.fetch(accountantOne);
      assert.strictEqual(genericAccountant.performanceFee.toNumber(), 500);
    });

    it("Strategies Manager - Calling distribute method should revert", async function () {
      try {
        await accountantProgram.methods
          .distribute()
          .accounts({
            recipient: feeRecipientSharesAccountOne,
            accountant: accountantOne,
            underlyingMint: sharesMintOne,
            signer: strategiesManager.publicKey,
          })
          .signers([strategiesManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });

    it("Strategies Manager - Calling add strategy method should revert", async () => {
      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vaultOne,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      try {
        await vaultProgram.methods
          .addStrategy(new BN(1000000000))
          .accounts({
            vault: vaultOne,
            strategy,
            signer: strategiesManager.publicKey,
          })
          .signers([strategiesManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_data"),
          vaultOne.toBuffer(),
          strategy.toBuffer(),
        ],
        vaultProgram.programId
      )[0];

      const strategyDataAccount =
        await vaultProgram.account.strategyData.fetchNullable(strategyData);
      assert.isNull(strategyDataAccount);
    });

    it("Strategies Manager - Calling remove strategy method should revert", async () => {
      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vaultOne,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      await vaultProgram.methods
        .addStrategy(new BN(1000000000))
        .accounts({
          vault: vaultOne,
          strategy,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const strategyDataBefore = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_data"),
          vaultOne.toBuffer(),
          strategy.toBuffer(),
        ],
        vaultProgram.programId
      )[0];

      try {
        await vaultProgram.methods
          .removeStrategy(strategy, false)
          .accounts({
            vault: vaultOne,
            strategyData: strategyDataBefore,
            recipient: vaultsAdmin.publicKey,
            signer: strategiesManager.publicKey,
          })
          .signers([strategiesManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const strategyDataAfter = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_data"),
          vaultOne.toBuffer(),
          strategy.toBuffer(),
        ],
        vaultProgram.programId
      )[0];

      const strategyDataAccount =
        await vaultProgram.account.strategyData.fetchNullable(
          strategyDataAfter
        );
      assert.isNotNull(strategyDataAccount);
    });

    it("Strategies Manager - Calling init vault method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      try {
        await vaultProgram.methods
          .initVault(vaultConfig)
          .accounts({
            underlyingMint,
            signer: strategiesManager.publicKey,
            tokenProgram: token.TOKEN_PROGRAM_ID,
          })
          .signers([strategiesManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });

    it("Strategies Manager - Calling init vault shares method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      await vaultProgram.methods
        .initVault(vaultConfig)
        .accounts({
          underlyingMint,
          signer: vaultsAdmin.publicKey,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([vaultsAdmin])
        .rpc();

      const config = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        vaultProgram.programId
      )[0];

      let configAccount = await vaultProgram.account.config.fetch(config);

      const nextVaultIndex = configAccount.nextVaultIndex.toNumber();

      const vault = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("vault"),
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(nextVaultIndex)]).buffer)
          ),
        ],
        vaultProgram.programId
      )[0];

      const sharesMint = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("shares"), vault.toBuffer()],
        vaultProgram.programId
      )[0];

      const [metadataAddress] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(METADATA_SEED),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          sharesMint.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );

      const sharesConfig = {
        name: "Localnet Tests Token",
        symbol: "LTT1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      try {
        await vaultProgram.methods
          .initVaultShares(new BN(nextVaultIndex), sharesConfig)
          .accounts({
            metadata: metadataAddress,
            signer: strategiesManager.publicKey,
          })
          .signers([strategiesManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let configAccountAfter = await vaultProgram.account.config.fetch(config);

      assert.strictEqual(
        configAccountAfter.nextVaultIndex.toNumber(),
        nextVaultIndex
      );

      // initVaultShares successfully to avoid conflicts in following tests
      await vaultProgram.methods
        .initVaultShares(new BN(nextVaultIndex), sharesConfig)
        .accounts({
          metadata: metadataAddress,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();
    });

    it("Strategies Manager - Calling shutdown vault method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      try {
        await vaultProgram.methods
          .shutdownVault()
          .accounts({ vault, signer: strategiesManager.publicKey })
          .signers([strategiesManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(vaultAccount.isShutdown, false);
      assert.strictEqual(vaultAccount.depositLimit.toNumber(), 1000000000);
    });

    it("Strategies Manager - Calling close vault method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      await vaultProgram.methods
        .shutdownVault()
        .accounts({ vault, signer: vaultsAdmin.publicKey })
        .signers([vaultsAdmin])
        .rpc();

      try {
        await vaultProgram.methods
          .closeVault()
          .accounts({
            vault,
            signer: strategiesManager.publicKey,
            recipient: accountantAdmin.publicKey,
          })
          .signers([strategiesManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultAccount = await vaultProgram.account.vault.fetchNullable(vault);
      assert.isNotNull(vaultAccount);
    });

    it("Strategies Manager - Calling update debt method should revert", async () => {
      const depositAmount = 100;
      const allocationAmount = 100;

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1000),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vault,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      await vaultProgram.methods
        .addStrategy(new BN(1000000000))
        .accounts({
          vault: vault,
          strategy: strategy,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const kycVerifiedUserSharesAccount = await token.createAccount(
        provider.connection,
        kycVerifiedUser,
        sharesMint,
        kycVerifiedUser.publicKey
      );

      const kycVerified = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          kycVerifiedUser.publicKey.toBuffer(),
          ROLES_BUFFER.KYC_VERIFIED,
        ],
        accessControlProgram.programId
      )[0];

      const accountantType = { generic: {} };

      await accountantProgram.methods.initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      await accountantProgram.methods.initTokenAccount()
        .accounts({
          accountant: accountant,
          signer: accountantAdmin.publicKey,
          mint: sharesMint,
        })
        .signers([accountantAdmin])
        .rpc();

      await vaultProgram.methods
        .deposit(new BN(depositAmount))
        .accounts({
          vault: vault,
          accountant: accountant,
          user: kycVerifiedUser.publicKey,
          userTokenAccount: kycVerifiedUserTokenAccount,
          userSharesAccount: kycVerifiedUserSharesAccount,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([kycVerifiedUser])
        .remainingAccounts([
          { pubkey: kycVerified, isWritable: false, isSigner: false },
        ])
        .rpc();

      kycVerifiedUserCurrentAmount -= depositAmount;

      try {
        await vaultProgram.methods
          .updateDebt(new BN(allocationAmount))
          .accounts({
            vault: vault,
            strategy: strategy,
            signer: strategiesManager.publicKey,
            underlyingMint: underlyingMint,
            tokenProgram: token.TOKEN_PROGRAM_ID,
          })
          .signers([strategiesManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultTokenAccountInfo = await token.getAccount(
        provider.connection,
        vaultTokenAccount
      );
      assert.strictEqual(
        vaultTokenAccountInfo.amount.toString(),
        depositAmount.toString()
      );

      let strategyTokenAccountInfo = await token.getAccount(
        provider.connection,
        strategyTokenAccount
      );
      assert.strictEqual(strategyTokenAccountInfo.amount.toString(), "0");

      let strategyAccount = await strategyProgram.account.simpleStrategy.fetch(
        strategy
      );
      assert.strictEqual(strategyAccount.totalAssets.toString(), "0");

      const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("strategy_data"), vault.toBuffer(), strategy.toBuffer()],
        vaultProgram.programId
      )[0];
      const strategyDataAccount = await vaultProgram.account.strategyData.fetch(
        strategyData
      );

      assert.strictEqual(strategyDataAccount.currentDebt.toString(), "0");

      const vaultAccount = await vaultProgram.account.vault.fetch(vault);

      assert.strictEqual(vaultAccount.totalDebt.toString(), "0");
      assert.strictEqual(
        vaultAccount.totalIdle.toString(),
        depositAmount.toString()
      );
    });

    it("Strategies Manager - Calling set deposit limit method should revert", async () => {
      const newDepositLimit = new BN(2000000000);

      try {
        await vaultProgram.methods
          .setDepositLimit(newDepositLimit)
          .accounts({
            vault: vaultOne,
            signer: strategiesManager.publicKey,
          })
          .signers([strategiesManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultAccount = await vaultProgram.account.vault.fetch(vaultOne);
      assert.strictEqual(vaultAccount.depositLimit.toString(), "1000000000");
    });

    it("Strategies Manager - Calling set min user deposit method should revert", async () => {
      const newMinUserDeposit = 100;

      try {
        await vaultProgram.methods
          .setMinUserDeposit(new BN(newMinUserDeposit))
          .accounts({
            vault: vaultOne,
            signer: strategiesManager.publicKey,
          })
          .signers([strategiesManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const vaultAccount = await vaultProgram.account.vault.fetch(vaultOne);
      assert.strictEqual(vaultAccount.minUserDeposit.toString(), "0");
    });

    it("Strategies Manager - Calling set profit max unlock time method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const newProfitMaxUnlockTime = 1;

      try {
        await vaultProgram.methods
          .setProfitMaxUnlockTime(new BN(newProfitMaxUnlockTime))
          .accounts({
            vault: vault,
            signer: strategiesManager.publicKey,
          })
          .signers([strategiesManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(vaultAccount.profitMaxUnlockTime.toString(), "0");
    });

    it("Strategies Manager - Calling set min total idle method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const newMinTotalIdle = 1;

      try {
        await vaultProgram.methods
          .setMinTotalIdle(new BN(1))
          .accounts({
            vault: vault,
            signer: strategiesManager.publicKey,
          })
          .signers([strategiesManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(vaultAccount.minimumTotalIdle.toString(), "0");
    });

    it("Strategies Manager - Calling process report method should revert", async () => {
      const depositAmount = 100;
      const allocationAmount = 100;

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1000),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vault,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      await vaultProgram.methods
        .addStrategy(new BN(1000000000))
        .accounts({
          vault: vault,
          strategy: strategy,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const kycVerifiedUserSharesAccount = await token.createAccount(
        provider.connection,
        kycVerifiedUser,
        sharesMint,
        kycVerifiedUser.publicKey
      );

      const kycVerified = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          kycVerifiedUser.publicKey.toBuffer(),
          ROLES_BUFFER.KYC_VERIFIED,
        ],
        accessControlProgram.programId
      )[0];

      const accountantType = { generic: {} };

      await accountantProgram.methods.initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      await accountantProgram.methods.initTokenAccount()
        .accounts({
          accountant: accountant,
          signer: accountantAdmin.publicKey,
          mint: sharesMint,
        })
        .signers([accountantAdmin])
        .rpc();

      await vaultProgram.methods
        .deposit(new BN(depositAmount))
        .accounts({
          vault: vault,
          accountant: accountant,
          user: kycVerifiedUser.publicKey,
          userTokenAccount: kycVerifiedUserTokenAccount,
          userSharesAccount: kycVerifiedUserSharesAccount,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([kycVerifiedUser])
        .remainingAccounts([
          { pubkey: kycVerified, isWritable: false, isSigner: false },
        ])
        .rpc();

      kycVerifiedUserCurrentAmount -= depositAmount;

      await vaultProgram.methods
        .updateDebt(new BN(allocationAmount))
        .accounts({
          vault: vault,
          strategy: strategy,
          signer: vaultsAdmin.publicKey,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([vaultsAdmin])
        .rpc();

      await strategyProgram.methods
        .reportProfit(new BN(10))
        .accounts({
          strategy: strategyOne,
          signer: strategiesManager.publicKey,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          {
            pubkey: strategiesManagerOneTokenAccount,
            isWritable: true,
            isSigner: false,
          },
        ])
        .signers([strategiesManager])
        .rpc();

      try {
        await vaultProgram.methods
          .processReport()
          .accounts({
            vault: vaultOne,
            strategy: strategyOne,
            signer: strategiesManager.publicKey,
            accountant: accountantOne,
          })
          .signers([strategiesManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });

    it("Strategies Manager - Calling deposit method for kyc verified only vault should revert", async () => {
      const depositAmount = 50;

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const sharesAccount = await token.createAccount(
        provider.connection,
        strategiesManager,
        sharesMint,
        strategiesManager.publicKey
      );

      const mintAmount = 1000;

      await token.mintTo(
        connection,
        underlyingMintOwner,
        underlyingMint,
        strategiesManagerOneTokenAccount,
        underlyingMintOwner.publicKey,
        mintAmount
      );

      const kycVerified = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          strategiesManager.publicKey.toBuffer(),
          ROLES_BUFFER.KYC_VERIFIED,
        ],
        accessControlProgram.programId
      )[0];

      const accountantType = { generic: {} };

      await accountantProgram.methods.initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      await accountantProgram.methods.initTokenAccount()
        .accounts({
          accountant: accountant,
          signer: accountantAdmin.publicKey,
          mint: sharesMint,
        })
        .signers([accountantAdmin])
        .rpc();

      try {
        await vaultProgram.methods
          .deposit(new BN(depositAmount))
          .accounts({
            vault: vault,
            accountant: accountant,
            user: strategiesManager.publicKey,
            userTokenAccount: strategiesManagerOneTokenAccount,
            userSharesAccount: sharesAccount,
            underlyingMint: underlyingMint,
            tokenProgram: token.TOKEN_PROGRAM_ID,
          })
          .signers([strategiesManager])
          .remainingAccounts([
            {
              pubkey: kycVerified,
              isWritable: false,
              isSigner: false,
            },
          ])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(errorStrings.kycRequired);
      }

      let vaultTokenAccountInfo = await token.getAccount(
        provider.connection,
        vaultTokenAccount
      );

      assert.strictEqual(vaultTokenAccountInfo.amount.toString(), "0");

      let userTokenAccountInfo = await token.getAccount(
        provider.connection,
        nonVerifiedUserTokenAccount
      );
      assert.strictEqual(
        userTokenAccountInfo.amount.toString(),
        nonVerifiedUserCurrentAmount.toString()
      );

      let userSharesAccountInfo = await token.getAccount(
        provider.connection,
        sharesAccount
      );
      assert.strictEqual(userSharesAccountInfo.amount.toString(), "0");
    });
  });

  describe("Vaults Admin Role Tests", () => {
    it("Vaults Admin - Calling add strategy method is successful", async () => {
      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vaultOne,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      await vaultProgram.methods
        .addStrategy(new BN(1000000000))
        .accounts({
          vault: vaultOne,
          strategy,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_data"),
          vaultOne.toBuffer(),
          strategy.toBuffer(),
        ],
        vaultProgram.programId
      )[0];

      const strategyDataAccount =
        await vaultProgram.account.strategyData.fetchNullable(strategyData);
      assert.isNotNull(strategyDataAccount);
    });

    it("Vaults Admin - Calling remove strategy method is successful", async () => {
      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vaultOne,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      await vaultProgram.methods
        .addStrategy(new BN(1000000000))
        .accounts({
          vault: vaultOne,
          strategy,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const strategyDataBefore = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_data"),
          vaultOne.toBuffer(),
          strategy.toBuffer(),
        ],
        vaultProgram.programId
      )[0];

      await vaultProgram.methods
        .removeStrategy(strategy, false)
        .accounts({
          vault: vaultOne,
          strategyData: strategyDataBefore,
          recipient: vaultsAdmin.publicKey,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const strategyDataAfter = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_data"),
          vaultOne.toBuffer(),
          strategy.toBuffer(),
        ],
        vaultProgram.programId
      )[0];

      const strategyDataAccount =
        await vaultProgram.account.strategyData.fetchNullable(
          strategyDataAfter
        );
      assert.isNull(strategyDataAccount);
    });

    it("Vaults Admin - Calling init vault method is successful", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const config = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        vaultProgram.programId
      )[0];

      let configAccount = await vaultProgram.account.config.fetch(config);

      const nextVaultIndex = configAccount.nextVaultIndex.toNumber();

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      await vaultProgram.methods
        .initVault(vaultConfig)
        .accounts({
          underlyingMint,
          signer: vaultsAdmin.publicKey,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([vaultsAdmin])
        .rpc();

      const vault = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("vault"),
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(nextVaultIndex)]).buffer)
          ),
        ],
        vaultProgram.programId
      )[0];

      let vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(vaultAccount.isShutdown, false);
      assert.strictEqual(vaultAccount.depositLimit.toNumber(), 1000000000);
      assert.strictEqual(vaultAccount.minUserDeposit.toNumber(), 0);
      assert.strictEqual(
        vaultAccount.accountant.toString(),
        accountant.toBase58()
      );
      assert.strictEqual(vaultAccount.profitMaxUnlockTime.toNumber(), 0);
      assert.strictEqual(vaultAccount.kycVerifiedOnly, true);
      assert.strictEqual(vaultAccount.directDepositEnabled, false);
    });

    it("Vaults Admin - Calling init vault shares method is successful", async () => {
      const config = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        vaultProgram.programId
      )[0];

      let configAccount = await vaultProgram.account.config.fetch(config);

      const nextVaultIndex = configAccount.nextVaultIndex.toNumber();

      const vault = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("vault"),
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(nextVaultIndex)]).buffer)
          ),
        ],
        vaultProgram.programId
      )[0];

      const sharesMint = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("shares"), vault.toBuffer()],
        vaultProgram.programId
      )[0];

      const [metadataAddress] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(METADATA_SEED),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          sharesMint.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );

      const sharesConfig = {
        name: "Localnet Tests Token",
        symbol: "LTT1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      await vaultProgram.methods
        .initVaultShares(new BN(1), sharesConfig)
        .accounts({
          metadata: metadataAddress,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      let configAccountAfter = await vaultProgram.account.config.fetch(config);

      assert.strictEqual(
        configAccountAfter.nextVaultIndex.toNumber(),
        nextVaultIndex + 1
      );
    });

    it("Vaults Admin - Calling shutdown vault method is successful", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      await vaultProgram.methods
        .shutdownVault()
        .accounts({ vault, signer: vaultsAdmin.publicKey })
        .signers([vaultsAdmin])
        .rpc();

      let vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(vaultAccount.isShutdown, true);
      assert.strictEqual(vaultAccount.depositLimit.toNumber(), 0);
    });

    it("Vaults Admin - Calling close vault method is successful", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      await vaultProgram.methods
        .shutdownVault()
        .accounts({ vault, signer: vaultsAdmin.publicKey })
        .signers([vaultsAdmin])
        .rpc();

      await vaultProgram.methods
        .closeVault()
        .accounts({
          vault,
          signer: vaultsAdmin.publicKey,
          recipient: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      let vaultAccount = await vaultProgram.account.vault.fetchNullable(vault);
      assert.isNull(vaultAccount);
    });

    it("Vaults Admin - Calling update debt method is successful", async () => {
      const depositAmount = 100;
      const allocationAmount = 100;
      const kycVerified = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          kycVerifiedUser.publicKey.toBuffer(),
          ROLES_BUFFER.KYC_VERIFIED,
        ],
        accessControlProgram.programId
      )[0];

      const accountantType = { generic: {} };

      await accountantProgram.methods.initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();


      await vaultProgram.methods
        .deposit(new BN(depositAmount))
        .accounts({
          vault: vaultOne,
          accountant: accountantOne,
          user: kycVerifiedUser.publicKey,
          userTokenAccount: kycVerifiedUserTokenAccount,
          userSharesAccount: kycVerifiedUserSharesAccountVaultOne,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([kycVerifiedUser])
        .remainingAccounts([
          { pubkey: kycVerified, isWritable: false, isSigner: false },
        ])
        .rpc();

      kycVerifiedUserCurrentAmount -= depositAmount;

      await vaultProgram.methods
        .updateDebt(new BN(allocationAmount))
        .accounts({
          vault: vaultOne,
          strategy: strategyOne,
          signer: vaultsAdmin.publicKey,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([vaultsAdmin])
        .rpc();

      let vaultTokenAccountInfo = await token.getAccount(
        provider.connection,
        vaultTokenAccountOne
      );

      assert.strictEqual(
        vaultTokenAccountInfo.amount.toString(),
        (depositAmount - allocationAmount).toString()
      );

      const vaultAccount = await vaultProgram.account.vault.fetch(vaultOne);

      assert.strictEqual(
        vaultAccount.totalDebt.toString(),
        allocationAmount.toString()
      );
      assert.strictEqual(
        vaultAccount.totalIdle.toString(),
        (depositAmount - allocationAmount).toString()
      );
    });

    it("Vaults Admin - Calling set deposit limit method is successful", async () => {
      const newDepositLimit = new BN(2000000000);

      await vaultProgram.methods
        .setDepositLimit(newDepositLimit)
        .accounts({
          vault: vaultOne,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      let vaultAccount = await vaultProgram.account.vault.fetch(vaultOne);
      assert.strictEqual(
        vaultAccount.depositLimit.toString(),
        newDepositLimit.toString()
      );
    });

    it("Vaults Admin - Calling set min user deposit method is successful", async () => {
      const newMinUserDeposit = 100;
      await vaultProgram.methods
        .setMinUserDeposit(new BN(newMinUserDeposit))
        .accounts({
          vault: vaultOne,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const vaultAccount = await vaultProgram.account.vault.fetch(vaultOne);
      assert.strictEqual(
        vaultAccount.minUserDeposit.toString(),
        newMinUserDeposit.toString()
      );
    });

    it("Vaults Admin - Calling set profit max unlock time method is successful", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const newProfitMaxUnlockTime = 1;
      await vaultProgram.methods
        .setProfitMaxUnlockTime(new BN(newProfitMaxUnlockTime))
        .accounts({
          vault: vault,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(
        vaultAccount.profitMaxUnlockTime.toString(),
        newProfitMaxUnlockTime.toString()
      );
    });

    it("Vaults Admin - Calling set min total idle method is successful", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const newMinTotalIdle = 1;
      await vaultProgram.methods
        .setMinTotalIdle(new BN(1))
        .accounts({
          vault: vault,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(
        vaultAccount.minimumTotalIdle.toString(),
        newMinTotalIdle.toString()
      );
    });

    it("Vaults Admin - Init accountant should revert", async function () {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const nextAccountantIndexBefore =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      try {
        await accountantProgram.methods
          .initAccountant(accountantType)
          .accounts({
            signer: vaultsAdmin.publicKey,
          })
          .signers([vaultsAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const nextAccountantIndexAfter =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      assert.strictEqual(nextAccountantIndexAfter, nextAccountantIndexBefore);
    });

    it("Vaults Admin - Calling set fee method should revert", async function () {
      try {
        await accountantProgram.methods
          .setPerformanceFee(new BN(100))
          .accounts({
            accountant: accountantOne,
            signer: vaultsAdmin.publicKey,
          })
          .signers([vaultsAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let genericAccountant =
        await accountantProgram.account.genericAccountant.fetch(accountantOne);
      assert.strictEqual(genericAccountant.performanceFee.toNumber(), 500);
    });

    it("Vaults Admin - Calling distribute method should revert", async function () {
      try {
        await accountantProgram.methods
          .distribute()
          .accounts({
            recipient: feeRecipientSharesAccountOne,
            accountant: accountantOne,
            underlyingMint: sharesMintOne,
            signer: vaultsAdmin.publicKey,
          })
          .signers([vaultsAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });

    it("Vaults Admin - Calling init strategy method should revert", async () => {
      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1),
        feeManager: strategiesManager.publicKey,
      });

      try {
        await initializeSimpleStrategy({
          strategyProgram,
          vault: vaultOne,
          underlyingMint,
          signer: vaultsAdmin,
          config: strategyConfig,
        });
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });

    it("Vaults Admin - Calling process report method should revert", async () => {
      const depositAmount = 100;
      const allocationAmount = 100;

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1000),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vault,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      await vaultProgram.methods
        .addStrategy(new BN(1000000000))
        .accounts({
          vault: vault,
          strategy: strategy,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const kycVerifiedUserSharesAccount = await token.createAccount(
        provider.connection,
        kycVerifiedUser,
        sharesMint,
        kycVerifiedUser.publicKey
      );

      const kycVerified = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          kycVerifiedUser.publicKey.toBuffer(),
          ROLES_BUFFER.KYC_VERIFIED,
        ],
        accessControlProgram.programId
      )[0];

      const accountantType = { generic: {} };

      await accountantProgram.methods.initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      await accountantProgram.methods.initTokenAccount()
        .accounts({
          accountant: accountant,
          signer: accountantAdmin.publicKey,
          mint: sharesMint,
        })
        .signers([accountantAdmin])
        .rpc();

      await vaultProgram.methods
        .deposit(new BN(depositAmount))
        .accounts({
          vault: vault,
          accountant: accountant,
          user: kycVerifiedUser.publicKey,
          userTokenAccount: kycVerifiedUserTokenAccount,
          userSharesAccount: kycVerifiedUserSharesAccount,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([kycVerifiedUser])
        .remainingAccounts([
          { pubkey: kycVerified, isWritable: false, isSigner: false },
        ])
        .rpc();

      kycVerifiedUserCurrentAmount -= depositAmount;

      await vaultProgram.methods
        .updateDebt(new BN(allocationAmount))
        .accounts({
          vault: vault,
          strategy: strategy,
          signer: vaultsAdmin.publicKey,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([vaultsAdmin])
        .rpc();

      await strategyProgram.methods
        .reportProfit(new BN(10))
        .accounts({
          strategy: strategyOne,
          signer: strategiesManager.publicKey,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          {
            pubkey: strategiesManagerOneTokenAccount,
            isWritable: true,
            isSigner: false,
          },
        ])
        .signers([strategiesManager])
        .rpc();

      try {
        await vaultProgram.methods
          .processReport()
          .accounts({
            vault: vaultOne,
            strategy: strategyOne,
            signer: vaultsAdmin.publicKey,
            accountant: accountantOne,
          })
          .signers([vaultsAdmin])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });

    it("Vaults Admin - Calling deposit method for kyc verified only vault should revert", async () => {
      const depositAmount = 50;

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const sharesAccount = await token.createAccount(
        provider.connection,
        vaultsAdmin,
        sharesMint,
        vaultsAdmin.publicKey
      );

      const tokenAccount = await token.createAccount(
        connection,
        vaultsAdmin,
        underlyingMint,
        vaultsAdmin.publicKey
      );

      const mintAmount = 1000;

      await token.mintTo(
        connection,
        underlyingMintOwner,
        underlyingMint,
        tokenAccount,
        underlyingMintOwner.publicKey,
        mintAmount
      );

      const kycVerified = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          vaultsAdmin.publicKey.toBuffer(),
          ROLES_BUFFER.KYC_VERIFIED,
        ],
        accessControlProgram.programId
      )[0];

      const accountantType = { generic: {} };

      await accountantProgram.methods.initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      await accountantProgram.methods.initTokenAccount()
        .accounts({
          accountant: accountant,
          signer: accountantAdmin.publicKey,
          mint: sharesMint,
        })
        .signers([accountantAdmin])
        .rpc();

      try {
        await vaultProgram.methods
          .deposit(new BN(depositAmount))
          .accounts({
            vault: vault,
            accountant: accountant,
            user: vaultsAdmin.publicKey,
            userTokenAccount: tokenAccount,
            userSharesAccount: sharesAccount,
            underlyingMint: underlyingMint,
            tokenProgram: token.TOKEN_PROGRAM_ID,
          })
          .signers([vaultsAdmin])
          .remainingAccounts([
            {
              pubkey: kycVerified,
              isWritable: false,
              isSigner: false,
            },
          ])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(errorStrings.kycRequired);
      }

      let vaultTokenAccountInfo = await token.getAccount(
        provider.connection,
        vaultTokenAccount
      );

      assert.strictEqual(vaultTokenAccountInfo.amount.toString(), "0");

      let userTokenAccountInfo = await token.getAccount(
        provider.connection,
        nonVerifiedUserTokenAccount
      );
      assert.strictEqual(
        userTokenAccountInfo.amount.toString(),
        nonVerifiedUserCurrentAmount.toString()
      );

      let userSharesAccountInfo = await token.getAccount(
        provider.connection,
        sharesAccount
      );
      assert.strictEqual(userSharesAccountInfo.amount.toString(), "0");
    });
  });

  describe("Reporting Manager Role Tests", () => {
    it("Reporting Manager - Calling process report method is successful", async () => {
      await strategyProgram.methods
        .reportProfit(new BN(10))
        .accounts({
          strategy: strategyOne,
          signer: strategiesManager.publicKey,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          {
            pubkey: strategiesManagerOneTokenAccount,
            isWritable: true,
            isSigner: false,
          },
        ])
        .signers([strategiesManager])
        .rpc();

      await vaultProgram.methods
        .processReport()
        .accounts({
          vault: vaultOne,
          strategy: strategyOne,
          signer: reportingManager.publicKey,
          accountant: accountantOne,
        })
        .signers([reportingManager])
        .rpc();

      let strategyAccount = await strategyProgram.account.simpleStrategy.fetch(
        strategyOne
      );
      expect(strategyAccount.feeData.feeBalance.toNumber()).greaterThan(0);

      let vaultTokenAccountInfo = await token.getAccount(
        provider.connection,
        vaultTokenAccountOne
      );
      assert.strictEqual(vaultTokenAccountInfo.amount.toString(), "0");
    });

    it("Reporting Manager - Calling init strategy method should revert", async () => {
      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1),
        feeManager: strategiesManager.publicKey,
      });

      try {
        await initializeSimpleStrategy({
          strategyProgram,
          vault: vaultOne,
          underlyingMint,
          signer: reportingManager,
          config: strategyConfig,
        });
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });

    it("Reporting Manager - Init accountant should revert", async function () {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const nextAccountantIndexBefore =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      try {
        await accountantProgram.methods
          .initAccountant(accountantType)
          .accounts({
            signer: reportingManager.publicKey,
          })
          .signers([reportingManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const nextAccountantIndexAfter =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      assert.strictEqual(nextAccountantIndexAfter, nextAccountantIndexBefore);
    });

    it("Reporting Manager - Calling set fee method should revert", async function () {
      try {
        await accountantProgram.methods
          .setPerformanceFee(new BN(100))
          .accounts({
            accountant: accountantOne,
            signer: reportingManager.publicKey,
          })
          .signers([reportingManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let genericAccountant =
        await accountantProgram.account.genericAccountant.fetch(accountantOne);
      assert.strictEqual(genericAccountant.performanceFee.toNumber(), 500);
    });

    it("Reporting Manager - Calling distribute method should revert", async function () {
      try {
        await accountantProgram.methods
          .distribute()
          .accounts({
            recipient: feeRecipientSharesAccountOne,
            accountant: accountantOne,
            underlyingMint: sharesMintOne,
            signer: reportingManager.publicKey,
          })
          .signers([reportingManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });

    it("Reporting Manager - Calling add strategy method should revert", async () => {
      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vaultOne,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      try {
        await vaultProgram.methods
          .addStrategy(new BN(1000000000))
          .accounts({
            vault: vaultOne,
            strategy,
            signer: reportingManager.publicKey,
          })
          .signers([reportingManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_data"),
          vaultOne.toBuffer(),
          strategy.toBuffer(),
        ],
        vaultProgram.programId
      )[0];

      const strategyDataAccount =
        await vaultProgram.account.strategyData.fetchNullable(strategyData);
      assert.isNull(strategyDataAccount);
    });

    it("Reporting Manager - Calling remove strategy method should revert", async () => {
      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vaultOne,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      await vaultProgram.methods
        .addStrategy(new BN(1000000000))
        .accounts({
          vault: vaultOne,
          strategy,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const strategyDataBefore = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_data"),
          vaultOne.toBuffer(),
          strategy.toBuffer(),
        ],
        vaultProgram.programId
      )[0];

      try {
        await vaultProgram.methods
          .removeStrategy(strategy, false)
          .accounts({
            vault: vaultOne,
            strategyData: strategyDataBefore,
            recipient: strategiesManager.publicKey,
            signer: reportingManager.publicKey,
          })
          .signers([reportingManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const strategyDataAfter = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_data"),
          vaultOne.toBuffer(),
          strategy.toBuffer(),
        ],
        vaultProgram.programId
      )[0];

      const strategyDataAccount =
        await vaultProgram.account.strategyData.fetchNullable(
          strategyDataAfter
        );
      assert.isNotNull(strategyDataAccount);
    });

    it("Reporting Manager - Calling init vault method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      try {
        await vaultProgram.methods
          .initVault(vaultConfig)
          .accounts({
            underlyingMint,
            signer: reportingManager.publicKey,
            tokenProgram: token.TOKEN_PROGRAM_ID,
          })
          .signers([reportingManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });

    it("Reporting Manager - Calling init vault shares method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      await vaultProgram.methods
        .initVault(vaultConfig)
        .accounts({
          underlyingMint,
          signer: vaultsAdmin.publicKey,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([vaultsAdmin])
        .rpc();

      const config = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        vaultProgram.programId
      )[0];

      let configAccount = await vaultProgram.account.config.fetch(config);

      const nextVaultIndex = configAccount.nextVaultIndex.toNumber();

      const vault = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("vault"),
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(nextVaultIndex)]).buffer)
          ),
        ],
        vaultProgram.programId
      )[0];

      const sharesMint = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("shares"), vault.toBuffer()],
        vaultProgram.programId
      )[0];

      const [metadataAddress] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(METADATA_SEED),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          sharesMint.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );

      const sharesConfig = {
        name: "Localnet Tests Token",
        symbol: "LTT1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      try {
        await vaultProgram.methods
          .initVaultShares(new BN(nextVaultIndex), sharesConfig)
          .accounts({
            metadata: metadataAddress,
            signer: reportingManager.publicKey,
          })
          .signers([reportingManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let configAccountAfter = await vaultProgram.account.config.fetch(config);

      assert.strictEqual(
        configAccountAfter.nextVaultIndex.toNumber(),
        nextVaultIndex
      );

      // initVaultShares successfully to avoid conflicts in following tests
      await vaultProgram.methods
        .initVaultShares(new BN(nextVaultIndex), sharesConfig)
        .accounts({
          metadata: metadataAddress,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();
    });

    it("Reporting Manager - Calling shutdown vault method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      try {
        await vaultProgram.methods
          .shutdownVault()
          .accounts({ vault, signer: reportingManager.publicKey })
          .signers([reportingManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(vaultAccount.isShutdown, false);
      assert.strictEqual(vaultAccount.depositLimit.toNumber(), 1000000000);
    });

    it("Reporting Manager - Calling close vault method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      await vaultProgram.methods
        .shutdownVault()
        .accounts({ vault, signer: vaultsAdmin.publicKey })
        .signers([vaultsAdmin])
        .rpc();

      try {
        await vaultProgram.methods
          .closeVault()
          .accounts({
            vault,
            signer: reportingManager.publicKey,
            recipient: vaultsAdmin.publicKey,
          })
          .signers([reportingManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultAccount = await vaultProgram.account.vault.fetchNullable(vault);
      assert.isNotNull(vaultAccount);
    });

    it("Reporting Manager - Calling update debt method should revert", async () => {
      const depositAmount = 100;
      const allocationAmount = 100;

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1000),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vault,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      await vaultProgram.methods
        .addStrategy(new BN(1000000000))
        .accounts({
          vault: vault,
          strategy: strategy,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const kycVerifiedUserSharesAccount = await token.createAccount(
        provider.connection,
        kycVerifiedUser,
        sharesMint,
        kycVerifiedUser.publicKey
      );

      const kycVerified = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          kycVerifiedUser.publicKey.toBuffer(),
          ROLES_BUFFER.KYC_VERIFIED,
        ],
        accessControlProgram.programId
      )[0];

      const accountantType = { generic: {} };

      await accountantProgram.methods.initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      await accountantProgram.methods.initTokenAccount()
        .accounts({
          accountant: accountant,
          signer: accountantAdmin.publicKey,
          mint: sharesMint,
        })
        .signers([accountantAdmin])
        .rpc();

      await vaultProgram.methods
        .deposit(new BN(depositAmount))
        .accounts({
          vault: vault,
          accountant: accountant,
          user: kycVerifiedUser.publicKey,
          userTokenAccount: kycVerifiedUserTokenAccount,
          userSharesAccount: kycVerifiedUserSharesAccount,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([kycVerifiedUser])
        .remainingAccounts([
          { pubkey: kycVerified, isWritable: false, isSigner: false },
        ])
        .rpc();

      kycVerifiedUserCurrentAmount -= depositAmount;

      try {
        await vaultProgram.methods
          .updateDebt(new BN(allocationAmount))
          .accounts({
            vault: vault,
            strategy: strategy,
            signer: reportingManager.publicKey,
            underlyingMint: underlyingMint,
            tokenProgram: token.TOKEN_PROGRAM_ID,
          })
          .signers([reportingManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultTokenAccountInfo = await token.getAccount(
        provider.connection,
        vaultTokenAccount
      );
      assert.strictEqual(
        vaultTokenAccountInfo.amount.toString(),
        depositAmount.toString()
      );

      let strategyTokenAccountInfo = await token.getAccount(
        provider.connection,
        strategyTokenAccount
      );
      assert.strictEqual(strategyTokenAccountInfo.amount.toString(), "0");

      let strategyAccount = await strategyProgram.account.simpleStrategy.fetch(
        strategy
      );
      assert.strictEqual(strategyAccount.totalAssets.toString(), "0");

      const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("strategy_data"), vault.toBuffer(), strategy.toBuffer()],
        vaultProgram.programId
      )[0];
      const strategyDataAccount = await vaultProgram.account.strategyData.fetch(
        strategyData
      );

      assert.strictEqual(strategyDataAccount.currentDebt.toString(), "0");

      const vaultAccount = await vaultProgram.account.vault.fetch(vault);

      assert.strictEqual(vaultAccount.totalDebt.toString(), "0");
      assert.strictEqual(
        vaultAccount.totalIdle.toString(),
        depositAmount.toString()
      );
    });

    it("Reporting Manager - Calling set deposit limit method should revert", async () => {
      const newDepositLimit = new BN(1);

      try {
        await vaultProgram.methods
          .setDepositLimit(newDepositLimit)
          .accounts({
            vault: vaultOne,
            signer: reportingManager.publicKey,
          })
          .signers([reportingManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultAccount = await vaultProgram.account.vault.fetch(vaultOne);
      expect(vaultAccount.depositLimit.toString()).not.equal(
        newDepositLimit.toString()
      );
    });

    it("Reporting Manager - Calling set min user deposit method should revert", async () => {
      const newMinUserDeposit = 1;

      try {
        await vaultProgram.methods
          .setMinUserDeposit(new BN(newMinUserDeposit))
          .accounts({
            vault: vaultOne,
            signer: reportingManager.publicKey,
          })
          .signers([reportingManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const vaultAccount = await vaultProgram.account.vault.fetch(vaultOne);
      expect(vaultAccount.minUserDeposit.toString()).not.equal(
        newMinUserDeposit.toString()
      );
    });

    it("Reporting Manager - Calling set profit max unlock time method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const newProfitMaxUnlockTime = 1;

      try {
        await vaultProgram.methods
          .setProfitMaxUnlockTime(new BN(newProfitMaxUnlockTime))
          .accounts({
            vault: vault,
            signer: reportingManager.publicKey,
          })
          .signers([reportingManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(vaultAccount.profitMaxUnlockTime.toString(), "0");
    });

    it("Reporting Manager - Calling set min total idle method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const newMinTotalIdle = 1;

      try {
        await vaultProgram.methods
          .setMinTotalIdle(new BN(1))
          .accounts({
            vault: vault,
            signer: reportingManager.publicKey,
          })
          .signers([reportingManager])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(vaultAccount.minimumTotalIdle.toString(), "0");
    });

    it("Reporting Manager - Calling deposit method for kyc verified only vault should revert", async () => {
      const depositAmount = 50;

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const sharesAccount = await token.createAccount(
        provider.connection,
        reportingManager,
        sharesMint,
        reportingManager.publicKey
      );

      const tokenAccount = await token.createAccount(
        connection,
        reportingManager,
        underlyingMint,
        reportingManager.publicKey
      );

      const mintAmount = 1000;

      await token.mintTo(
        connection,
        underlyingMintOwner,
        underlyingMint,
        tokenAccount,
        underlyingMintOwner.publicKey,
        mintAmount
      );

      const kycVerified = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          reportingManager.publicKey.toBuffer(),
          ROLES_BUFFER.KYC_VERIFIED,
        ],
        accessControlProgram.programId
      )[0];

      const accountantType = { generic: {} };

      await accountantProgram.methods.initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      await accountantProgram.methods.initTokenAccount()
        .accounts({
          accountant: accountant,
          signer: accountantAdmin.publicKey,
          mint: sharesMint,
        })
        .signers([accountantAdmin])
        .rpc();

      try {
        await vaultProgram.methods
          .deposit(new BN(depositAmount))
          .accounts({
            vault: vault,
            accountant: accountant,
            user: reportingManager.publicKey,
            userTokenAccount: tokenAccount,
            userSharesAccount: sharesAccount,
            underlyingMint: underlyingMint,
            tokenProgram: token.TOKEN_PROGRAM_ID,
          })
          .signers([reportingManager])
          .remainingAccounts([
            {
              pubkey: kycVerified,
              isWritable: false,
              isSigner: false,
            },
          ])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(errorStrings.kycRequired);
      }

      let vaultTokenAccountInfo = await token.getAccount(
        provider.connection,
        vaultTokenAccount
      );

      assert.strictEqual(vaultTokenAccountInfo.amount.toString(), "0");

      let userTokenAccountInfo = await token.getAccount(
        provider.connection,
        nonVerifiedUserTokenAccount
      );
      assert.strictEqual(
        userTokenAccountInfo.amount.toString(),
        nonVerifiedUserCurrentAmount.toString()
      );

      let userSharesAccountInfo = await token.getAccount(
        provider.connection,
        sharesAccount
      );
      assert.strictEqual(userSharesAccountInfo.amount.toString(), "0");
    });
  });

  describe("KYC Verified User Role Tests", () => {
    it("KYC Verified User - Calling deposit method for kyc verified only vault is successful", async () => {
      const depositAmount = 50;

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const userSharesAccount = await token.createAccount(
        provider.connection,
        kycVerifiedUser,
        sharesMint,
        kycVerifiedUser.publicKey
      );

      const kycVerified = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          kycVerifiedUser.publicKey.toBuffer(),
          ROLES_BUFFER.KYC_VERIFIED,
        ],
        accessControlProgram.programId
      )[0];

      const accountantType = { generic: {} };

      await accountantProgram.methods.initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      await accountantProgram.methods.initTokenAccount()
        .accounts({
          accountant: accountant,
          signer: accountantAdmin.publicKey,
          mint: sharesMint,
        })
        .signers([accountantAdmin])
        .rpc();

      await vaultProgram.methods
        .deposit(new BN(depositAmount))
        .accounts({
          vault: vault,
          accountant: accountant,
          user: kycVerifiedUser.publicKey,
          userTokenAccount: kycVerifiedUserTokenAccount,
          userSharesAccount: userSharesAccount,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([kycVerifiedUser])
        .remainingAccounts([
          { pubkey: kycVerified, isWritable: false, isSigner: false },
        ])
        .rpc();

      kycVerifiedUserCurrentAmount -= depositAmount;

      let vaultTokenAccountInfo = await token.getAccount(
        provider.connection,
        vaultTokenAccount
      );

      assert.strictEqual(
        vaultTokenAccountInfo.amount.toString(),
        depositAmount.toString()
      );

      let userTokenAccountInfo = await token.getAccount(
        provider.connection,
        kycVerifiedUserTokenAccount
      );
      assert.strictEqual(
        userTokenAccountInfo.amount.toString(),
        kycVerifiedUserCurrentAmount.toString()
      );

      let userSharesAccountInfo = await token.getAccount(
        provider.connection,
        userSharesAccount
      );
      assert.strictEqual(
        userSharesAccountInfo.amount.toString(),
        depositAmount.toString()
      );
    });

    it("KYC Verified User - Init accountant should revert", async function () {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const nextAccountantIndexBefore =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      try {
        await accountantProgram.methods
          .initAccountant(accountantType)
          .accounts({
            signer: kycVerifiedUser.publicKey,
          })
          .signers([kycVerifiedUser])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const nextAccountantIndexAfter =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      assert.strictEqual(nextAccountantIndexAfter, nextAccountantIndexBefore);
    });

    it("KYC Verified User - Calling set fee method should revert", async function () {
      try {
        await accountantProgram.methods
          .setPerformanceFee(new BN(100))
          .accounts({
            accountant: accountantOne,
            signer: kycVerifiedUser.publicKey,
          })
          .signers([kycVerifiedUser])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let genericAccountant =
        await accountantProgram.account.genericAccountant.fetch(accountantOne);
      assert.strictEqual(genericAccountant.performanceFee.toNumber(), 500);
    });

    it("KYC Verified User - Calling distribute method should revert", async function () {
      try {
        await accountantProgram.methods
          .distribute()
          .accounts({
            recipient: feeRecipientSharesAccountOne,
            accountant: accountantOne,
            underlyingMint: sharesMintOne,
            signer: kycVerifiedUser.publicKey,
          })
          .signers([kycVerifiedUser])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });

    it("KYC Verified User - Calling init strategy method should revert", async () => {
      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1),
        feeManager: strategiesManager.publicKey,
      });

      try {
        await initializeSimpleStrategy({
          strategyProgram,
          vault: vaultOne,
          underlyingMint,
          signer: kycVerifiedUser,
          config: strategyConfig,
        });
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });

    it("KYC Verified User - Calling add strategy method should revert", async () => {
      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vaultOne,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      try {
        await vaultProgram.methods
          .addStrategy(new BN(1000000000))
          .accounts({
            vault: vaultOne,
            strategy,
            signer: kycVerifiedUser.publicKey,
          })
          .signers([kycVerifiedUser])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_data"),
          vaultOne.toBuffer(),
          strategy.toBuffer(),
        ],
        vaultProgram.programId
      )[0];

      const strategyDataAccount =
        await vaultProgram.account.strategyData.fetchNullable(strategyData);
      assert.isNull(strategyDataAccount);
    });

    it("KYC Verified User - Calling remove strategy method should revert", async () => {
      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vaultOne,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      await vaultProgram.methods
        .addStrategy(new BN(1000000000))
        .accounts({
          vault: vaultOne,
          strategy,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const strategyDataBefore = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_data"),
          vaultOne.toBuffer(),
          strategy.toBuffer(),
        ],
        vaultProgram.programId
      )[0];

      try {
        await vaultProgram.methods
          .removeStrategy(strategy, false)
          .accounts({
            vault: vaultOne,
            strategyData: strategyDataBefore,
            recipient: strategiesManager.publicKey,
            signer: kycVerifiedUser.publicKey,
          })
          .signers([kycVerifiedUser])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const strategyDataAfter = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("strategy_data"),
          vaultOne.toBuffer(),
          strategy.toBuffer(),
        ],
        vaultProgram.programId
      )[0];

      const strategyDataAccount =
        await vaultProgram.account.strategyData.fetchNullable(
          strategyDataAfter
        );
      assert.isNotNull(strategyDataAccount);
    });

    it("KYC Verified User - Calling init vault method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      try {
        await vaultProgram.methods
          .initVault(vaultConfig)
          .accounts({
            underlyingMint,
            signer: kycVerifiedUser.publicKey,
            tokenProgram: token.TOKEN_PROGRAM_ID,
          })
          .signers([kycVerifiedUser])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });

    it("KYC Verified User - Calling init vault shares method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      await vaultProgram.methods
        .initVault(vaultConfig)
        .accounts({
          underlyingMint,
          signer: vaultsAdmin.publicKey,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([vaultsAdmin])
        .rpc();

      const config = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        vaultProgram.programId
      )[0];

      let configAccount = await vaultProgram.account.config.fetch(config);

      const nextVaultIndex = configAccount.nextVaultIndex.toNumber();

      const vault = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("vault"),
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(nextVaultIndex)]).buffer)
          ),
        ],
        vaultProgram.programId
      )[0];

      const sharesMint = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("shares"), vault.toBuffer()],
        vaultProgram.programId
      )[0];

      const [metadataAddress] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(METADATA_SEED),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          sharesMint.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      );

      const sharesConfig = {
        name: "Localnet Tests Token",
        symbol: "LTT1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      try {
        await vaultProgram.methods
          .initVaultShares(new BN(nextVaultIndex), sharesConfig)
          .accounts({
            metadata: metadataAddress,
            signer: kycVerifiedUser.publicKey,
          })
          .signers([kycVerifiedUser])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let configAccountAfter = await vaultProgram.account.config.fetch(config);

      assert.strictEqual(
        configAccountAfter.nextVaultIndex.toNumber(),
        nextVaultIndex
      );

      // initVaultShares successfully to avoid conflicts in following tests
      await vaultProgram.methods
        .initVaultShares(new BN(nextVaultIndex), sharesConfig)
        .accounts({
          metadata: metadataAddress,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();
    });

    it("KYC Verified User - Calling shutdown vault method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      try {
        await vaultProgram.methods
          .shutdownVault()
          .accounts({ vault, signer: kycVerifiedUser.publicKey })
          .signers([kycVerifiedUser])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(vaultAccount.isShutdown, false);
      assert.strictEqual(vaultAccount.depositLimit.toNumber(), 1000000000);
    });

    it("KYC Verified User - Calling close vault method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      await vaultProgram.methods
        .shutdownVault()
        .accounts({ vault, signer: vaultsAdmin.publicKey })
        .signers([vaultsAdmin])
        .rpc();

      try {
        await vaultProgram.methods
          .closeVault()
          .accounts({
            vault,
            signer: kycVerifiedUser.publicKey,
            recipient: accountantAdmin.publicKey,
          })
          .signers([kycVerifiedUser])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultAccount = await vaultProgram.account.vault.fetchNullable(vault);
      assert.isNotNull(vaultAccount);
    });

    it("KYC Verified User - Calling update debt method should revert", async () => {
      const depositAmount = 100;
      const allocationAmount = 100;

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1000),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vault,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      await vaultProgram.methods
        .addStrategy(new BN(1000000000))
        .accounts({
          vault: vault,
          strategy: strategy,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const kycVerifiedUserSharesAccount = await token.createAccount(
        provider.connection,
        kycVerifiedUser,
        sharesMint,
        kycVerifiedUser.publicKey
      );

      const kycVerified = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          kycVerifiedUser.publicKey.toBuffer(),
          ROLES_BUFFER.KYC_VERIFIED,
        ],
        accessControlProgram.programId
      )[0];

      const accountantType = { generic: {} };

      await accountantProgram.methods.initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      await accountantProgram.methods.initTokenAccount()
        .accounts({
          accountant: accountant,
          signer: accountantAdmin.publicKey,
          mint: sharesMint,
        })
        .signers([accountantAdmin])
        .rpc();

      await vaultProgram.methods
        .deposit(new BN(depositAmount))
        .accounts({
          vault: vault,
          accountant: accountant,
          user: kycVerifiedUser.publicKey,
          userTokenAccount: kycVerifiedUserTokenAccount,
          userSharesAccount: kycVerifiedUserSharesAccount,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([kycVerifiedUser])
        .remainingAccounts([
          { pubkey: kycVerified, isWritable: false, isSigner: false },
        ])
        .rpc();

      kycVerifiedUserCurrentAmount -= depositAmount;

      try {
        await vaultProgram.methods
          .updateDebt(new BN(allocationAmount))
          .accounts({
            vault: vault,
            strategy: strategy,
            signer: kycVerifiedUser.publicKey,
            underlyingMint: underlyingMint,
            tokenProgram: token.TOKEN_PROGRAM_ID,
          })
          .signers([kycVerifiedUser])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultTokenAccountInfo = await token.getAccount(
        provider.connection,
        vaultTokenAccount
      );
      assert.strictEqual(
        vaultTokenAccountInfo.amount.toString(),
        depositAmount.toString()
      );

      let strategyTokenAccountInfo = await token.getAccount(
        provider.connection,
        strategyTokenAccount
      );
      assert.strictEqual(strategyTokenAccountInfo.amount.toString(), "0");

      let strategyAccount = await strategyProgram.account.simpleStrategy.fetch(
        strategy
      );
      assert.strictEqual(strategyAccount.totalAssets.toString(), "0");

      const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("strategy_data"), vault.toBuffer(), strategy.toBuffer()],
        vaultProgram.programId
      )[0];
      const strategyDataAccount = await vaultProgram.account.strategyData.fetch(
        strategyData
      );

      assert.strictEqual(strategyDataAccount.currentDebt.toString(), "0");

      const vaultAccount = await vaultProgram.account.vault.fetch(vault);

      assert.strictEqual(vaultAccount.totalDebt.toString(), "0");
      assert.strictEqual(
        vaultAccount.totalIdle.toString(),
        depositAmount.toString()
      );
    });

    it("KYC Verified User - Calling set deposit limit method should revert", async () => {
      const newDepositLimit = new BN(1);

      try {
        await vaultProgram.methods
          .setDepositLimit(newDepositLimit)
          .accounts({
            vault: vaultOne,
            signer: kycVerifiedUser.publicKey,
          })
          .signers([kycVerifiedUser])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      let vaultAccount = await vaultProgram.account.vault.fetch(vaultOne);
      expect(vaultAccount.depositLimit.toNumber()).not.to.equal(
        newDepositLimit
      );
    });

    it("KYC Verified User - Calling set min user deposit method should revert", async () => {
      const newMinUserDeposit = 1;

      try {
        await vaultProgram.methods
          .setMinUserDeposit(new BN(newMinUserDeposit))
          .accounts({
            vault: vaultOne,
            signer: kycVerifiedUser.publicKey,
          })
          .signers([kycVerifiedUser])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const vaultAccount = await vaultProgram.account.vault.fetch(vaultOne);
      expect(vaultAccount.minUserDeposit.toNumber()).not.equal(
        newMinUserDeposit
      );
    });

    it("KYC Verified User - Calling set profit max unlock time method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const newProfitMaxUnlockTime = 1;

      try {
        await vaultProgram.methods
          .setProfitMaxUnlockTime(new BN(newProfitMaxUnlockTime))
          .accounts({
            vault: vault,
            signer: kycVerifiedUser.publicKey,
          })
          .signers([kycVerifiedUser])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(vaultAccount.profitMaxUnlockTime.toString(), "0");
    });

    it("KYC Verified User - Calling set min total idle method should revert", async () => {
      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const newMinTotalIdle = 1;

      try {
        await vaultProgram.methods
          .setMinTotalIdle(new BN(1))
          .accounts({
            vault: vault,
            signer: kycVerifiedUser.publicKey,
          })
          .signers([kycVerifiedUser])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }

      const vaultAccount = await vaultProgram.account.vault.fetch(vault);
      assert.strictEqual(vaultAccount.minimumTotalIdle.toString(), "0");
    });

    it("KYC Verified User - Calling process report method should revert", async () => {
      const depositAmount = 100;
      const allocationAmount = 100;

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();
      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const strategyConfig = new SimpleStrategyConfig({
        depositLimit: new BN(1000),
        performanceFee: new BN(1000),
        feeManager: strategiesManager.publicKey,
      });

      const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
        strategyProgram,
        vault: vault,
        underlyingMint,
        signer: strategiesManager,
        config: strategyConfig,
      });

      await vaultProgram.methods
        .addStrategy(new BN(1000000000))
        .accounts({
          vault: vault,
          strategy: strategy,
          signer: vaultsAdmin.publicKey,
        })
        .signers([vaultsAdmin])
        .rpc();

      const kycVerifiedUserSharesAccount = await token.createAccount(
        provider.connection,
        kycVerifiedUser,
        sharesMint,
        kycVerifiedUser.publicKey
      );

      const kycVerified = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          kycVerifiedUser.publicKey.toBuffer(),
          ROLES_BUFFER.KYC_VERIFIED,
        ],
        accessControlProgram.programId
      )[0];

      const accountantType = { generic: {} };

      await accountantProgram.methods.initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      await accountantProgram.methods.initTokenAccount()
        .accounts({
          accountant: accountant,
          signer: accountantAdmin.publicKey,
          mint: sharesMint,
        })
        .signers([accountantAdmin])
        .rpc();

      await vaultProgram.methods
        .deposit(new BN(depositAmount))
        .accounts({
          vault: vault,
          accountant: accountant,
          user: kycVerifiedUser.publicKey,
          userTokenAccount: kycVerifiedUserTokenAccount,
          userSharesAccount: kycVerifiedUserSharesAccount,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([kycVerifiedUser])
        .remainingAccounts([
          { pubkey: kycVerified, isWritable: false, isSigner: false },
        ])
        .rpc();

      kycVerifiedUserCurrentAmount -= depositAmount;

      await vaultProgram.methods
        .updateDebt(new BN(allocationAmount))
        .accounts({
          vault: vault,
          strategy: strategy,
          signer: vaultsAdmin.publicKey,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .signers([vaultsAdmin])
        .rpc();

      await strategyProgram.methods
        .reportProfit(new BN(10))
        .accounts({
          strategy: strategyOne,
          signer: strategiesManager.publicKey,
          underlyingMint: underlyingMint,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          {
            pubkey: strategiesManagerOneTokenAccount,
            isWritable: true,
            isSigner: false,
          },
        ])
        .signers([strategiesManager])
        .rpc();

      try {
        await vaultProgram.methods
          .processReport()
          .accounts({
            vault: vaultOne,
            strategy: strategyOne,
            signer: kycVerifiedUser.publicKey,
            accountant: accountantOne,
          })
          .signers([kycVerifiedUser])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(
          errorStrings.accountExpectedToAlreadyBeInitialized
        );
      }
    });
  });

  describe("Non-KYC Verified User Role Tests", () => {
    it("Non-KYC Verified User - Calling deposit method for kyc verified only vault should revert", async () => {
      const depositAmount = 50;

      accountantConfigAccount = await accountantProgram.account.config.fetch(
        accountantConfig
      );
      const accountantIndex =
        accountantConfigAccount.nextAccountantIndex.toNumber();

      const accountant = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(
            new Uint8Array(new BigUint64Array([BigInt(accountantIndex)]).buffer)
          ),
        ],
        accountantProgram.programId
      )[0];

      const vaultConfig = {
        depositLimit: new BN(1000000000),
        userDepositLimit: new BN(0),
        minUserDeposit: new BN(0),
        accountant: accountant,
        profitMaxUnlockTime: new BN(0),
        kycVerifiedOnly: true,
        directDepositEnabled: false,
        whitelistedOnly: false,
      };

      const sharesConfig = {
        name: "Test Roles and Permissions One",
        symbol: "TRPV1",
        uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
      };

      const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
        await initializeVault({
          vaultProgram,
          underlyingMint,
          signer: vaultsAdmin,
          vaultConfig: vaultConfig,
          sharesConfig: sharesConfig,
        });

      const userSharesAccount = await token.createAccount(
        provider.connection,
        nonVerifiedUser,
        sharesMint,
        nonVerifiedUser.publicKey
      );

      const kycVerified = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_role"),
          nonVerifiedUser.publicKey.toBuffer(),
          ROLES_BUFFER.KYC_VERIFIED,
        ],
        accessControlProgram.programId
      )[0];

      const accountantType = { generic: {} };

      await accountantProgram.methods.initAccountant(accountantType)
        .accounts({
          signer: accountantAdmin.publicKey,
        })
        .signers([accountantAdmin])
        .rpc();

      await accountantProgram.methods.initTokenAccount()
        .accounts({
          accountant: accountant,
          signer: accountantAdmin.publicKey,
          mint: sharesMint,
        })
        .signers([accountantAdmin])
        .rpc();

      try {
        await vaultProgram.methods
          .deposit(new BN(depositAmount))
          .accounts({
            vault: vault,
            accountant: accountant,
            user: nonVerifiedUser.publicKey,
            userTokenAccount: nonVerifiedUserTokenAccount,
            userSharesAccount: userSharesAccount,
            underlyingMint: underlyingMint,
            tokenProgram: token.TOKEN_PROGRAM_ID,
          })
          .signers([nonVerifiedUser])
          .remainingAccounts([
            {
              pubkey: kycVerified,
              isWritable: false,
              isSigner: false,
            },
          ])
          .rpc();
        assert.fail("Error was not thrown");
      } catch (err) {
        expect(err.message).to.contain(errorStrings.kycRequired);
      }

      let vaultTokenAccountInfo = await token.getAccount(
        provider.connection,
        vaultTokenAccount
      );

      assert.strictEqual(vaultTokenAccountInfo.amount.toString(), "0");

      let userTokenAccountInfo = await token.getAccount(
        provider.connection,
        nonVerifiedUserTokenAccount
      );
      assert.strictEqual(
        userTokenAccountInfo.amount.toString(),
        nonVerifiedUserCurrentAmount.toString()
      );

      let userSharesAccountInfo = await token.getAccount(
        provider.connection,
        userSharesAccount
      );
      assert.strictEqual(userSharesAccountInfo.amount.toString(), "0");
    });
  });
});
