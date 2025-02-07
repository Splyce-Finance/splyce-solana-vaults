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
} from "../../setups/globalSetup";
import { assert, expect } from "chai";
import { errorStrings, ROLES, ROLES_BUFFER } from "../../../utils/constants";
import { BN } from "@coral-xyz/anchor";
import {
  airdrop,
  initializeSimpleStrategy,
  initializeVault,
  initNextAccountant,
  setUpTestUser,
  setUpTestVaultWithSingleStrategy,
  validateDeposit,
  validateUserTokenAndShareData,
  validateVaultTokenAndShareData,
} from "../../../utils/helpers";
import * as token from "@solana/spl-token";
import { SimpleStrategyConfig } from "../../../utils/schemas";

describe.only("Vault User Operations: Withdrawal Tests", () => {
  let rolesAdmin: anchor.web3.Keypair;
  let generalAdmin: anchor.web3.Keypair;
  let generalAdminTokenAccount: anchor.web3.PublicKey;

  let accountantConfig: anchor.web3.PublicKey;

  let underlyingMint: anchor.web3.PublicKey;
  let underlyingMintOwner: anchor.web3.Keypair;

  before(async () => {
    console.log("-------Before Step Started-------");
    rolesAdmin = configOwner;
    generalAdmin = anchor.web3.Keypair.generate();

    await airdrop({
      connection,
      publicKey: generalAdmin.publicKey,
      amount: 10e9,
    });

    // Create common underlying mint account and set underlying mint owner
    underlyingMintOwner = configOwner;
    underlyingMint = await token.createMint(
      connection,
      underlyingMintOwner,
      underlyingMintOwner.publicKey,
      null,
      9
    );

    generalAdminTokenAccount = await token.createAccount(
      connection,
      generalAdmin,
      underlyingMint,
      generalAdmin.publicKey
    );
    await token.mintTo(
      connection,
      underlyingMintOwner,
      underlyingMint,
      generalAdminTokenAccount,
      underlyingMintOwner.publicKey,
      2000000000
    );

    console.log(
      "Underlying mint owner and underlying mint set up successfully"
    );

    // Set Corresponding Roles
    await accessControlProgram.methods
      .setRole(ROLES.ACCOUNTANT_ADMIN, generalAdmin.publicKey)
      .accounts({
        signer: rolesAdmin.publicKey,
      })
      .signers([rolesAdmin])
      .rpc();
    await accessControlProgram.methods
      .setRole(ROLES.STRATEGIES_MANAGER, generalAdmin.publicKey)
      .accounts({
        signer: rolesAdmin.publicKey,
      })
      .signers([rolesAdmin])
      .rpc();
    await accessControlProgram.methods
      .setRole(ROLES.VAULTS_ADMIN, generalAdmin.publicKey)
      .accounts({
        signer: rolesAdmin.publicKey,
      })
      .signers([rolesAdmin])
      .rpc();
    await accessControlProgram.methods
      .setRole(ROLES.REPORTING_MANAGER, generalAdmin.publicKey)
      .accounts({
        signer: rolesAdmin.publicKey,
      })
      .signers([rolesAdmin])
      .rpc();
    await accessControlProgram.methods
      .setRole(ROLES.KYC_PROVIDER, generalAdmin.publicKey)
      .accounts({
        signer: rolesAdmin.publicKey,
      })
      .signers([rolesAdmin])
      .rpc();

    console.log("Set all roles successfully");

    // Set up global accountant config
    accountantConfig = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      accountantProgram.programId
    )[0];

    console.log("-------Before Step Finished-------");
  });

  it("Withdrawing partially from the vault with fully non-allocted funds is successful", async () => {
    const userMintAmount = 2000000000;
    const depositAmount = 100000000;
    const withdrawalAmount = 50000000;

    const accountant = await initNextAccountant({
      accountantConfig,
      admin: generalAdmin,
    });

    const vaultConfig = {
      depositLimit: new BN(100000000000),
      minUserDeposit: new BN(100000000),
      accountant: accountant,
      profitMaxUnlockTime: new BN(0),
      kycVerifiedOnly: false,
      directDepositEnabled: true,
      whitelistedOnly: false,
      directWithdrawEnabled: true,
    };

    const strategyConfig = new SimpleStrategyConfig({
      depositLimit: new BN(100000000000),
      performanceFee: new BN(1000),
      feeManager: generalAdmin.publicKey,
    });

    const {
      vault,
      strategy,
      vaultTokenAccount,
      strategyTokenAccount,
      sharesMint,
    } = await setUpTestVaultWithSingleStrategy({
      admin: generalAdmin,
      accountant: accountant,
      vaultConfig: vaultConfig,
      underlyingMint: underlyingMint,
      strategyConfig: strategyConfig,
      strategyMaxDebt: 100000000000,
    });

    const { user, userTokenAccount } = await setUpTestUser({
      underlyingMint,
      underlyingMintOwner,
      mintAmount: 2000000000,
    });

    const userSharesAccount = await token.createAccount(
      provider.connection,
      user,
      sharesMint,
      user.publicKey
    );

    // Set up initial expected values
    let userCurrentTokenAmount = userMintAmount;
    let userSharesCurrentAmount = 0;
    let vaultTokenAccountCurrentAmount = 0;
    let vaultTotalSharesCurrentAmount = 0;
    let vaultTotalIdleCurrentAmount = 0;
    let vaultTotalDebtCurrentAmount = 0;

    await vaultProgram.methods
      .deposit(new BN(depositAmount))
      .accounts({
        vault: vault,
        accountant: accountant,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        userSharesAccount: userSharesAccount,
        underlyingMint: underlyingMint,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    userCurrentTokenAmount -= depositAmount;
    userSharesCurrentAmount += depositAmount;
    vaultTokenAccountCurrentAmount += depositAmount;
    vaultTotalSharesCurrentAmount += depositAmount;
    vaultTotalIdleCurrentAmount += depositAmount;

    const remainingAccountsMap = {
      accountsMap: [
        {
          strategyAcc: new BN(0),
          strategyTokenAccount: new BN(1),
          strategyData: new BN(2),
          remainingAccounts: [new BN(0)],
        },
      ],
    };

    const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_data"), vault.toBuffer(), strategy.toBuffer()],
      vaultProgram.programId
    )[0];

    await vaultProgram.methods
      .withdraw(new BN(withdrawalAmount), new BN(0), remainingAccountsMap)
      .accounts({
        vault: vault,
        underlyingMint,
        accountant: accountant,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        userSharesAccount: userSharesAccount,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: strategy, isWritable: true, isSigner: false },
        {
          pubkey: strategyTokenAccount,
          isWritable: true,
          isSigner: false,
        },
        { pubkey: strategyData, isWritable: true, isSigner: false },
      ])
      .signers([user])
      .rpc();

    userCurrentTokenAmount += withdrawalAmount;
    userSharesCurrentAmount -= withdrawalAmount;
    vaultTokenAccountCurrentAmount -= withdrawalAmount;
    vaultTotalSharesCurrentAmount -= withdrawalAmount;
    vaultTotalIdleCurrentAmount -= withdrawalAmount;

    await validateUserTokenAndShareData({
      userTokenAccount,
      userSharesAccount,
      userCurrentTokenAmount,
      userSharesCurrentAmount,
    });

    await validateVaultTokenAndShareData({
      vaultTokenAccount,
      vault,
      vaultTokenAccountCurrentAmount,
      vaultTotalDebtCurrentAmount,
      vaultTotalIdleCurrentAmount,
      vaultTotalSharesCurrentAmount,
    });
  });

  it("Withdrawing full amount from the vault with fully non-allocated funds is successful", async () => {
    const userMintAmount = 2000000000;
    const depositAmount = 100000000;
    const withdrawalAmount = 100000000;

    const accountant = await initNextAccountant({
      accountantConfig,
      admin: generalAdmin,
    });

    const vaultConfig = {
      depositLimit: new BN(100000000000),
      minUserDeposit: new BN(100000000),
      accountant: accountant,
      profitMaxUnlockTime: new BN(0),
      kycVerifiedOnly: false,
      directDepositEnabled: true,
      whitelistedOnly: false,
      directWithdrawEnabled: true,
    };

    const strategyConfig = new SimpleStrategyConfig({
      depositLimit: new BN(100000000000),
      performanceFee: new BN(1000),
      feeManager: generalAdmin.publicKey,
    });

    const {
      vault,
      strategy,
      vaultTokenAccount,
      strategyTokenAccount,
      sharesMint,
    } = await setUpTestVaultWithSingleStrategy({
      admin: generalAdmin,
      accountant: accountant,
      vaultConfig: vaultConfig,
      underlyingMint: underlyingMint,
      strategyConfig: strategyConfig,
      strategyMaxDebt: 100000000000,
    });

    const { user, userTokenAccount } = await setUpTestUser({
      underlyingMint,
      underlyingMintOwner,
      mintAmount: 2000000000,
    });

    const userSharesAccount = await token.createAccount(
      provider.connection,
      user,
      sharesMint,
      user.publicKey
    );

    // Set up initial expected values
    let userCurrentTokenAmount = userMintAmount;
    let userSharesCurrentAmount = 0;
    let vaultTokenAccountCurrentAmount = 0;
    let vaultTotalSharesCurrentAmount = 0;
    let vaultTotalIdleCurrentAmount = 0;
    let vaultTotalDebtCurrentAmount = 0;

    await vaultProgram.methods
      .deposit(new BN(depositAmount))
      .accounts({
        vault: vault,
        accountant: accountant,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        userSharesAccount: userSharesAccount,
        underlyingMint: underlyingMint,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    userCurrentTokenAmount -= depositAmount;
    userSharesCurrentAmount += depositAmount;
    vaultTokenAccountCurrentAmount += depositAmount;
    vaultTotalSharesCurrentAmount += depositAmount;
    vaultTotalIdleCurrentAmount += depositAmount;

    const remainingAccountsMap = {
      accountsMap: [
        {
          strategyAcc: new BN(0),
          strategyTokenAccount: new BN(1),
          strategyData: new BN(2),
          remainingAccounts: [new BN(0)],
        },
      ],
    };

    const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_data"), vault.toBuffer(), strategy.toBuffer()],
      vaultProgram.programId
    )[0];

    await vaultProgram.methods
      .withdraw(new BN(withdrawalAmount), new BN(0), remainingAccountsMap)
      .accounts({
        vault: vault,
        underlyingMint,
        accountant: accountant,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        userSharesAccount: userSharesAccount,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: strategy, isWritable: true, isSigner: false },
        {
          pubkey: strategyTokenAccount,
          isWritable: true,
          isSigner: false,
        },
        { pubkey: strategyData, isWritable: true, isSigner: false },
      ])
      .signers([user])
      .rpc();

    userCurrentTokenAmount += withdrawalAmount;
    userSharesCurrentAmount -= withdrawalAmount;
    vaultTokenAccountCurrentAmount -= withdrawalAmount;
    vaultTotalSharesCurrentAmount -= withdrawalAmount;
    vaultTotalIdleCurrentAmount -= withdrawalAmount;

    await validateUserTokenAndShareData({
      userTokenAccount,
      userSharesAccount,
      userCurrentTokenAmount,
      userSharesCurrentAmount,
    });

    await validateVaultTokenAndShareData({
      vaultTokenAccount,
      vault,
      vaultTokenAccountCurrentAmount,
      vaultTotalDebtCurrentAmount,
      vaultTotalIdleCurrentAmount,
      vaultTotalSharesCurrentAmount,
    });
  });

  it("Withdrawing full amount from the vault with partially allocated funds is successful", async () => {
    const userMintAmount = 2000000000;
    const depositAmount = 100000000;
    const withdrawalAmount = 100000000;
    const updateDebtAmount = 60000000;

    const accountant = await initNextAccountant({
      accountantConfig,
      admin: generalAdmin,
    });

    const vaultConfig = {
      depositLimit: new BN(100000000000),
      minUserDeposit: new BN(100000000),
      accountant: accountant,
      profitMaxUnlockTime: new BN(0),
      kycVerifiedOnly: false,
      directDepositEnabled: true,
      whitelistedOnly: false,
      directWithdrawEnabled: true,
    };

    const strategyConfig = new SimpleStrategyConfig({
      depositLimit: new BN(100000000000),
      performanceFee: new BN(1000),
      feeManager: generalAdmin.publicKey,
    });

    const {
      vault,
      strategy,
      vaultTokenAccount,
      strategyTokenAccount,
      sharesMint,
    } = await setUpTestVaultWithSingleStrategy({
      admin: generalAdmin,
      accountant: accountant,
      vaultConfig: vaultConfig,
      underlyingMint: underlyingMint,
      strategyConfig: strategyConfig,
      strategyMaxDebt: 100000000000,
    });

    const { user, userTokenAccount } = await setUpTestUser({
      underlyingMint,
      underlyingMintOwner,
      mintAmount: 2000000000,
    });

    const userSharesAccount = await token.createAccount(
      provider.connection,
      user,
      sharesMint,
      user.publicKey
    );

    // Set up initial expected values
    let userCurrentTokenAmount = userMintAmount;
    let userSharesCurrentAmount = 0;
    let vaultTokenAccountCurrentAmount = 0;
    let vaultTotalSharesCurrentAmount = 0;
    let vaultTotalIdleCurrentAmount = 0;
    let vaultTotalDebtCurrentAmount = 0;

    await vaultProgram.methods
      .deposit(new BN(depositAmount))
      .accounts({
        vault: vault,
        accountant: accountant,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        userSharesAccount: userSharesAccount,
        underlyingMint: underlyingMint,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    userCurrentTokenAmount -= depositAmount;
    userSharesCurrentAmount += depositAmount;
    vaultTokenAccountCurrentAmount += depositAmount;
    vaultTotalSharesCurrentAmount += depositAmount;
    vaultTotalIdleCurrentAmount += depositAmount;

    await vaultProgram.methods
      .updateDebt(new BN(updateDebtAmount))
      .accounts({
        vault: vault,
        strategy: strategy,
        underlyingMint,
        signer: generalAdmin.publicKey,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .signers([generalAdmin])
      .rpc();

    vaultTokenAccountCurrentAmount -= updateDebtAmount;
    vaultTotalIdleCurrentAmount -= updateDebtAmount;
    vaultTotalDebtCurrentAmount += updateDebtAmount;

    const remainingAccountsMap = {
      accountsMap: [
        {
          strategyAcc: new BN(0),
          strategyTokenAccount: new BN(1),
          strategyData: new BN(2),
          remainingAccounts: [new BN(0)],
        },
      ],
    };

    const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_data"), vault.toBuffer(), strategy.toBuffer()],
      vaultProgram.programId
    )[0];

    await vaultProgram.methods
      .withdraw(new BN(withdrawalAmount), new BN(0), remainingAccountsMap)
      .accounts({
        vault: vault,
        underlyingMint,
        accountant: accountant,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        userSharesAccount: userSharesAccount,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: strategy, isWritable: true, isSigner: false },
        {
          pubkey: strategyTokenAccount,
          isWritable: true,
          isSigner: false,
        },
        { pubkey: strategyData, isWritable: true, isSigner: false },
      ])
      .signers([user])
      .rpc();

    userCurrentTokenAmount += withdrawalAmount;
    userSharesCurrentAmount -= withdrawalAmount;
    vaultTokenAccountCurrentAmount -= withdrawalAmount - updateDebtAmount;
    vaultTotalSharesCurrentAmount -= withdrawalAmount;
    vaultTotalIdleCurrentAmount -= withdrawalAmount - updateDebtAmount;
    vaultTotalDebtCurrentAmount -= updateDebtAmount;

    await validateUserTokenAndShareData({
      userTokenAccount,
      userSharesAccount,
      userCurrentTokenAmount,
      userSharesCurrentAmount,
    });

    await validateVaultTokenAndShareData({
      vaultTokenAccount,
      vault,
      vaultTokenAccountCurrentAmount,
      vaultTotalDebtCurrentAmount,
      vaultTotalIdleCurrentAmount,
      vaultTotalSharesCurrentAmount,
    });
  });

  it("Withdrawing full amount from the vault with fully allocated funds is successful", async () => {
    const userMintAmount = 2000000000;
    const depositAmount = 100000000;
    const withdrawalAmount = 100000000;
    const updateDebtAmount = 100000000;

    const accountant = await initNextAccountant({
      accountantConfig,
      admin: generalAdmin,
    });

    const vaultConfig = {
      depositLimit: new BN(100000000000),
      minUserDeposit: new BN(100000000),
      accountant: accountant,
      profitMaxUnlockTime: new BN(0),
      kycVerifiedOnly: false,
      directDepositEnabled: true,
      whitelistedOnly: false,
      directWithdrawEnabled: true,
    };

    const strategyConfig = new SimpleStrategyConfig({
      depositLimit: new BN(100000000000),
      performanceFee: new BN(1000),
      feeManager: generalAdmin.publicKey,
    });

    const {
      vault,
      strategy,
      vaultTokenAccount,
      strategyTokenAccount,
      sharesMint,
    } = await setUpTestVaultWithSingleStrategy({
      admin: generalAdmin,
      accountant: accountant,
      vaultConfig: vaultConfig,
      underlyingMint: underlyingMint,
      strategyConfig: strategyConfig,
      strategyMaxDebt: 100000000000,
    });

    const { user, userTokenAccount } = await setUpTestUser({
      underlyingMint,
      underlyingMintOwner,
      mintAmount: 2000000000,
    });

    const userSharesAccount = await token.createAccount(
      provider.connection,
      user,
      sharesMint,
      user.publicKey
    );

    // Set up initial expected values
    let userCurrentTokenAmount = userMintAmount;
    let userSharesCurrentAmount = 0;
    let vaultTokenAccountCurrentAmount = 0;
    let vaultTotalSharesCurrentAmount = 0;
    let vaultTotalIdleCurrentAmount = 0;
    let vaultTotalDebtCurrentAmount = 0;

    await vaultProgram.methods
      .deposit(new BN(depositAmount))
      .accounts({
        vault: vault,
        accountant: accountant,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        userSharesAccount: userSharesAccount,
        underlyingMint: underlyingMint,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    userCurrentTokenAmount -= depositAmount;
    userSharesCurrentAmount += depositAmount;
    vaultTokenAccountCurrentAmount += depositAmount;
    vaultTotalSharesCurrentAmount += depositAmount;
    vaultTotalIdleCurrentAmount += depositAmount;

    await vaultProgram.methods
      .updateDebt(new BN(updateDebtAmount))
      .accounts({
        vault: vault,
        strategy: strategy,
        underlyingMint,
        signer: generalAdmin.publicKey,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .signers([generalAdmin])
      .rpc();

    vaultTokenAccountCurrentAmount -= updateDebtAmount;
    vaultTotalIdleCurrentAmount -= updateDebtAmount;
    vaultTotalDebtCurrentAmount += updateDebtAmount;

    const remainingAccountsMap = {
      accountsMap: [
        {
          strategyAcc: new BN(0),
          strategyTokenAccount: new BN(1),
          strategyData: new BN(2),
          remainingAccounts: [new BN(0)],
        },
      ],
    };

    const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_data"), vault.toBuffer(), strategy.toBuffer()],
      vaultProgram.programId
    )[0];

    await vaultProgram.methods
      .withdraw(new BN(withdrawalAmount), new BN(0), remainingAccountsMap)
      .accounts({
        vault: vault,
        underlyingMint,
        accountant: accountant,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        userSharesAccount: userSharesAccount,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: strategy, isWritable: true, isSigner: false },
        {
          pubkey: strategyTokenAccount,
          isWritable: true,
          isSigner: false,
        },
        { pubkey: strategyData, isWritable: true, isSigner: false },
      ])
      .signers([user])
      .rpc();

    userCurrentTokenAmount += withdrawalAmount;
    userSharesCurrentAmount -= withdrawalAmount;
    vaultTokenAccountCurrentAmount -= withdrawalAmount - updateDebtAmount;
    vaultTotalSharesCurrentAmount -= withdrawalAmount;
    vaultTotalIdleCurrentAmount -= withdrawalAmount - updateDebtAmount;
    vaultTotalDebtCurrentAmount -= updateDebtAmount;

    await validateUserTokenAndShareData({
      userTokenAccount,
      userSharesAccount,
      userCurrentTokenAmount,
      userSharesCurrentAmount,
    });

    await validateVaultTokenAndShareData({
      vaultTokenAccount,
      vault,
      vaultTokenAccountCurrentAmount,
      vaultTotalDebtCurrentAmount,
      vaultTotalIdleCurrentAmount,
      vaultTotalSharesCurrentAmount,
    });
  });

  it("Withdrawing more amount than it is available in the vault should revert", async () => {
    const userMintAmount = 2000000000;
    const depositAmount = 100000000;
    const withdrawalAmount = 100000001;

    const accountant = await initNextAccountant({
      accountantConfig,
      admin: generalAdmin,
    });

    const vaultConfig = {
      depositLimit: new BN(100000000000),
      minUserDeposit: new BN(100000000),
      accountant: accountant,
      profitMaxUnlockTime: new BN(0),
      kycVerifiedOnly: false,
      directDepositEnabled: true,
      whitelistedOnly: false,
      directWithdrawEnabled: true,
    };

    const strategyConfig = new SimpleStrategyConfig({
      depositLimit: new BN(100000000000),
      performanceFee: new BN(1000),
      feeManager: generalAdmin.publicKey,
    });

    const {
      vault,
      strategy,
      vaultTokenAccount,
      strategyTokenAccount,
      sharesMint,
    } = await setUpTestVaultWithSingleStrategy({
      admin: generalAdmin,
      accountant: accountant,
      vaultConfig: vaultConfig,
      underlyingMint: underlyingMint,
      strategyConfig: strategyConfig,
      strategyMaxDebt: 100000000000,
    });

    const { user, userTokenAccount } = await setUpTestUser({
      underlyingMint,
      underlyingMintOwner,
      mintAmount: 2000000000,
    });

    const userSharesAccount = await token.createAccount(
      provider.connection,
      user,
      sharesMint,
      user.publicKey
    );

    // Set up initial expected values
    let userCurrentTokenAmount = userMintAmount;
    let userSharesCurrentAmount = 0;
    let vaultTokenAccountCurrentAmount = 0;
    let vaultTotalSharesCurrentAmount = 0;
    let vaultTotalIdleCurrentAmount = 0;
    let vaultTotalDebtCurrentAmount = 0;

    await vaultProgram.methods
      .deposit(new BN(depositAmount))
      .accounts({
        vault: vault,
        accountant: accountant,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        userSharesAccount: userSharesAccount,
        underlyingMint: underlyingMint,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    userCurrentTokenAmount -= depositAmount;
    userSharesCurrentAmount += depositAmount;
    vaultTokenAccountCurrentAmount += depositAmount;
    vaultTotalSharesCurrentAmount += depositAmount;
    vaultTotalIdleCurrentAmount += depositAmount;

    const remainingAccountsMap = {
      accountsMap: [
        {
          strategyAcc: new BN(0),
          strategyTokenAccount: new BN(1),
          strategyData: new BN(2),
          remainingAccounts: [new BN(0)],
        },
      ],
    };

    const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_data"), vault.toBuffer(), strategy.toBuffer()],
      vaultProgram.programId
    )[0];

    try {
      await vaultProgram.methods
        .withdraw(new BN(withdrawalAmount), new BN(0), remainingAccountsMap)
        .accounts({
          vault: vault,
          underlyingMint,
          accountant: accountant,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          userSharesAccount: userSharesAccount,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: strategy, isWritable: true, isSigner: false },
          {
            pubkey: strategyTokenAccount,
            isWritable: true,
            isSigner: false,
          },
          { pubkey: strategyData, isWritable: true, isSigner: false },
        ])
        .signers([user])
        .rpc();
      assert.fail("Error was not thrown");
    } catch (err) {
      expect(err.message).to.contain(errorStrings.insufficientShares);
    }

    await validateUserTokenAndShareData({
      userTokenAccount,
      userSharesAccount,
      userCurrentTokenAmount,
      userSharesCurrentAmount,
    });

    await validateVaultTokenAndShareData({
      vaultTokenAccount,
      vault,
      vaultTokenAccountCurrentAmount,
      vaultTotalDebtCurrentAmount,
      vaultTotalIdleCurrentAmount,
      vaultTotalSharesCurrentAmount,
    });
  });

  it("Withdrawing 0 amount from the vault should revert", async () => {
    const userMintAmount = 2000000000;
    const depositAmount = 100000000;
    const withdrawalAmount = 0;

    const accountant = await initNextAccountant({
      accountantConfig,
      admin: generalAdmin,
    });

    const vaultConfig = {
      depositLimit: new BN(100000000000),
      minUserDeposit: new BN(100000000),
      accountant: accountant,
      profitMaxUnlockTime: new BN(0),
      kycVerifiedOnly: false,
      directDepositEnabled: true,
      whitelistedOnly: false,
      directWithdrawEnabled: true,
    };

    const strategyConfig = new SimpleStrategyConfig({
      depositLimit: new BN(100000000000),
      performanceFee: new BN(1000),
      feeManager: generalAdmin.publicKey,
    });

    const {
      vault,
      strategy,
      vaultTokenAccount,
      strategyTokenAccount,
      sharesMint,
    } = await setUpTestVaultWithSingleStrategy({
      admin: generalAdmin,
      accountant: accountant,
      vaultConfig: vaultConfig,
      underlyingMint: underlyingMint,
      strategyConfig: strategyConfig,
      strategyMaxDebt: 100000000000,
    });

    const { user, userTokenAccount } = await setUpTestUser({
      underlyingMint,
      underlyingMintOwner,
      mintAmount: 2000000000,
    });

    const userSharesAccount = await token.createAccount(
      provider.connection,
      user,
      sharesMint,
      user.publicKey
    );

    // Set up initial expected values
    let userCurrentTokenAmount = userMintAmount;
    let userSharesCurrentAmount = 0;
    let vaultTokenAccountCurrentAmount = 0;
    let vaultTotalSharesCurrentAmount = 0;
    let vaultTotalIdleCurrentAmount = 0;
    let vaultTotalDebtCurrentAmount = 0;

    await vaultProgram.methods
      .deposit(new BN(depositAmount))
      .accounts({
        vault: vault,
        accountant: accountant,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        userSharesAccount: userSharesAccount,
        underlyingMint: underlyingMint,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    userCurrentTokenAmount -= depositAmount;
    userSharesCurrentAmount += depositAmount;
    vaultTokenAccountCurrentAmount += depositAmount;
    vaultTotalSharesCurrentAmount += depositAmount;
    vaultTotalIdleCurrentAmount += depositAmount;

    const remainingAccountsMap = {
      accountsMap: [
        {
          strategyAcc: new BN(0),
          strategyTokenAccount: new BN(1),
          strategyData: new BN(2),
          remainingAccounts: [new BN(0)],
        },
      ],
    };

    const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_data"), vault.toBuffer(), strategy.toBuffer()],
      vaultProgram.programId
    )[0];

    try {
      await vaultProgram.methods
        .withdraw(new BN(withdrawalAmount), new BN(0), remainingAccountsMap)
        .accounts({
          vault: vault,
          underlyingMint,
          accountant: accountant,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          userSharesAccount: userSharesAccount,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: strategy, isWritable: true, isSigner: false },
          {
            pubkey: strategyTokenAccount,
            isWritable: true,
            isSigner: false,
          },
          { pubkey: strategyData, isWritable: true, isSigner: false },
        ])
        .signers([user])
        .rpc();
      assert.fail("Error was not thrown");
    } catch (err) {
      expect(err.message).to.contain(errorStrings.zeroValue);
    }

    await validateUserTokenAndShareData({
      userTokenAccount,
      userSharesAccount,
      userCurrentTokenAmount,
      userSharesCurrentAmount,
    });

    await validateVaultTokenAndShareData({
      vaultTokenAccount,
      vault,
      vaultTokenAccountCurrentAmount,
      vaultTotalDebtCurrentAmount,
      vaultTotalIdleCurrentAmount,
      vaultTotalSharesCurrentAmount,
    });
  });

  it("Withdrawing valid amount from the vault with direct withdraw disabled should revert", async () => {
    const userMintAmount = 2000000000;
    const depositAmount = 100000000;
    const withdrawalAmount = 100000000;

    const accountant = await initNextAccountant({
      accountantConfig,
      admin: generalAdmin,
    });

    const vaultConfig = {
      depositLimit: new BN(100000000000),
      minUserDeposit: new BN(100000000),
      accountant: accountant,
      profitMaxUnlockTime: new BN(0),
      kycVerifiedOnly: false,
      directDepositEnabled: true,
      whitelistedOnly: false,
      directWithdrawEnabled: false,
    };

    const strategyConfig = new SimpleStrategyConfig({
      depositLimit: new BN(100000000000),
      performanceFee: new BN(1000),
      feeManager: generalAdmin.publicKey,
    });

    const {
      vault,
      strategy,
      vaultTokenAccount,
      strategyTokenAccount,
      sharesMint,
    } = await setUpTestVaultWithSingleStrategy({
      admin: generalAdmin,
      accountant: accountant,
      vaultConfig: vaultConfig,
      underlyingMint: underlyingMint,
      strategyConfig: strategyConfig,
      strategyMaxDebt: 100000000000,
    });

    const { user, userTokenAccount } = await setUpTestUser({
      underlyingMint,
      underlyingMintOwner,
      mintAmount: 2000000000,
    });

    const userSharesAccount = await token.createAccount(
      provider.connection,
      user,
      sharesMint,
      user.publicKey
    );

    // Set up initial expected values
    let userCurrentTokenAmount = userMintAmount;
    let userSharesCurrentAmount = 0;
    let vaultTokenAccountCurrentAmount = 0;
    let vaultTotalSharesCurrentAmount = 0;
    let vaultTotalIdleCurrentAmount = 0;
    let vaultTotalDebtCurrentAmount = 0;

    await vaultProgram.methods
      .deposit(new BN(depositAmount))
      .accounts({
        vault: vault,
        accountant: accountant,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        userSharesAccount: userSharesAccount,
        underlyingMint: underlyingMint,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    userCurrentTokenAmount -= depositAmount;
    userSharesCurrentAmount += depositAmount;
    vaultTokenAccountCurrentAmount += depositAmount;
    vaultTotalSharesCurrentAmount += depositAmount;
    vaultTotalIdleCurrentAmount += depositAmount;

    const remainingAccountsMap = {
      accountsMap: [
        {
          strategyAcc: new BN(0),
          strategyTokenAccount: new BN(1),
          strategyData: new BN(2),
          remainingAccounts: [new BN(0)],
        },
      ],
    };

    const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_data"), vault.toBuffer(), strategy.toBuffer()],
      vaultProgram.programId
    )[0];

    try {
      await vaultProgram.methods
        .withdraw(new BN(withdrawalAmount), new BN(0), remainingAccountsMap)
        .accounts({
          vault: vault,
          underlyingMint,
          accountant: accountant,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          userSharesAccount: userSharesAccount,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: strategy, isWritable: true, isSigner: false },
          {
            pubkey: strategyTokenAccount,
            isWritable: true,
            isSigner: false,
          },
          { pubkey: strategyData, isWritable: true, isSigner: false },
        ])
        .signers([user])
        .rpc();
      assert.fail("Error was not thrown");
    } catch (err) {
      expect(err.message).to.contain(errorStrings.directWithdrawDisabled);
    }

    await validateUserTokenAndShareData({
      userTokenAccount,
      userSharesAccount,
      userCurrentTokenAmount,
      userSharesCurrentAmount,
    });

    await validateVaultTokenAndShareData({
      vaultTokenAccount,
      vault,
      vaultTokenAccountCurrentAmount,
      vaultTotalDebtCurrentAmount,
      vaultTotalIdleCurrentAmount,
      vaultTotalSharesCurrentAmount,
    });
  });

  it("Withdrawing valid amount in case max loss is exceeded should revert", async () => {
    const userMintAmount = 2000000000;
    const depositAmount = 100000000;
    const withdrawalAmount = 1000000;
    const updateDebtAmount = 100000000;

    const accountant = await initNextAccountant({
      accountantConfig,
      admin: generalAdmin,
    });

    const vaultConfig = {
      depositLimit: new BN(100000000000),
      minUserDeposit: new BN(100000000),
      accountant: accountant,
      profitMaxUnlockTime: new BN(0),
      kycVerifiedOnly: false,
      directDepositEnabled: true,
      whitelistedOnly: false,
      directWithdrawEnabled: true,
    };

    const strategyConfig = new SimpleStrategyConfig({
      depositLimit: new BN(100000000000),
      performanceFee: new BN(1000),
      feeManager: generalAdmin.publicKey,
    });

    const {
      vault,
      strategy,
      vaultTokenAccount,
      strategyTokenAccount,
      sharesMint,
    } = await setUpTestVaultWithSingleStrategy({
      admin: generalAdmin,
      accountant: accountant,
      vaultConfig: vaultConfig,
      underlyingMint: underlyingMint,
      strategyConfig: strategyConfig,
      strategyMaxDebt: 100000000000,
    });

    const { user, userTokenAccount } = await setUpTestUser({
      underlyingMint,
      underlyingMintOwner,
      mintAmount: 2000000000,
    });

    const userSharesAccount = await token.createAccount(
      provider.connection,
      user,
      sharesMint,
      user.publicKey
    );

    // Set up initial expected values
    let userCurrentTokenAmount = userMintAmount;
    let userSharesCurrentAmount = 0;
    let vaultTokenAccountCurrentAmount = 0;
    let vaultTotalSharesCurrentAmount = 0;
    let vaultTotalIdleCurrentAmount = 0;
    let vaultTotalDebtCurrentAmount = 0;

    await vaultProgram.methods
      .deposit(new BN(depositAmount))
      .accounts({
        vault: vault,
        accountant: accountant,
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        userSharesAccount: userSharesAccount,
        underlyingMint: underlyingMint,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    userCurrentTokenAmount -= depositAmount;
    userSharesCurrentAmount += depositAmount;
    vaultTokenAccountCurrentAmount += depositAmount;
    vaultTotalSharesCurrentAmount += depositAmount;
    vaultTotalIdleCurrentAmount += depositAmount;

    await vaultProgram.methods
      .updateDebt(new BN(updateDebtAmount))
      .accounts({
        vault: vault,
        strategy: strategy,
        underlyingMint,
        signer: generalAdmin.publicKey,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .signers([generalAdmin])
      .rpc();

    vaultTokenAccountCurrentAmount -= updateDebtAmount;
    vaultTotalIdleCurrentAmount -= updateDebtAmount;
    vaultTotalDebtCurrentAmount += updateDebtAmount;

    // Report Loss
    await strategyProgram.methods
      .reportLoss(new BN(5))
      .accounts({
        strategy,
        underlyingMint,
        signer: generalAdmin.publicKey,
        tokenProgram: token.TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        {
          pubkey: generalAdminTokenAccount,
          isWritable: true,
          isSigner: false,
        },
      ])
      .signers([generalAdmin])
      .rpc();

    const remainingAccountsMap = {
      accountsMap: [
        {
          strategyAcc: new BN(0),
          strategyTokenAccount: new BN(1),
          strategyData: new BN(2),
          remainingAccounts: [new BN(0)],
        },
      ],
    };

    const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("strategy_data"), vault.toBuffer(), strategy.toBuffer()],
      vaultProgram.programId
    )[0];

    const vaultAccount = await vaultProgram.account.vault.fetch(vault);
    console.log(vaultAccount.totalIdle.toString());
    console.log(vaultAccount.totalDebt.toString());

    try {
      await vaultProgram.methods
        .withdraw(new BN(withdrawalAmount), new BN(0), remainingAccountsMap)
        .accounts({
          vault: vault,
          underlyingMint,
          accountant: accountant,
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          userSharesAccount: userSharesAccount,
          tokenProgram: token.TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: strategy, isWritable: true, isSigner: false },
          {
            pubkey: strategyTokenAccount,
            isWritable: true,
            isSigner: false,
          },
          { pubkey: strategyData, isWritable: true, isSigner: false },
        ])
        .signers([user])
        .rpc();
      assert.fail("Error was not thrown");
    } catch (err) {
      console.log(err.message);
    }

    await validateUserTokenAndShareData({
      userTokenAccount,
      userSharesAccount,
      userCurrentTokenAmount,
      userSharesCurrentAmount,
    });

    await validateVaultTokenAndShareData({
      vaultTokenAccount,
      vault,
      vaultTokenAccountCurrentAmount,
      vaultTotalDebtCurrentAmount,
      vaultTotalIdleCurrentAmount,
      vaultTotalSharesCurrentAmount,
    });
  });
});
