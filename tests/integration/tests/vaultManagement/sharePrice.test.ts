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
  validateDirectDeposit,
} from "../../../utils/helpers";
import * as token from "@solana/spl-token";
import { SimpleStrategyConfig } from "../../../utils/schemas";

describe("Vault Management: Share Price Tests", () => {
  // Test Role Accounts
  let rolesAdmin: anchor.web3.Keypair;
  let generalAdmin: anchor.web3.Keypair;
  let nonVerifiedUser: anchor.web3.Keypair;

  // Accountant vars
  let accountantConfig: anchor.web3.PublicKey;
  let accountantConfigAccount: { nextAccountantIndex: BN };
  const accountantType = { generic: {} };

  // Common underlying mint and owner
  let underlyingMint: anchor.web3.PublicKey;
  let underlyingMintOwner: anchor.web3.Keypair;

  // User token and shares accounts
  let nonVerifiedUserTokenAccount: anchor.web3.PublicKey;
  let nonVerifiedUserCurrentAmount: number;
  let generalAdminTokenAccount: anchor.web3.PublicKey;
  let generalAdminCurrentAmount: number;

  before(async () => {
    console.log("-------Before Step Started-------");
    // Generate Test Role Accounts
    rolesAdmin = configOwner;
    generalAdmin = anchor.web3.Keypair.generate();
    nonVerifiedUser = anchor.web3.Keypair.generate();

    // Airdrop to all accounts
    const publicKeysList = [generalAdmin.publicKey, nonVerifiedUser.publicKey];
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

    // Set up accountant config
    accountantConfig = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      accountantProgram.programId
    )[0];

    nonVerifiedUserTokenAccount = await token.createAccount(
      connection,
      nonVerifiedUser,
      underlyingMint,
      nonVerifiedUser.publicKey
    );

    generalAdminTokenAccount = await token.createAccount(
      connection,
      generalAdmin,
      underlyingMint,
      generalAdmin.publicKey
    );

    console.log("Token accounts and shares accounts created successfully");

    const mintAmount = 200000000000;

    await token.mintTo(
      connection,
      underlyingMintOwner,
      underlyingMint,
      nonVerifiedUserTokenAccount,
      underlyingMintOwner.publicKey,
      mintAmount
    );
    await token.mintTo(
      connection,
      underlyingMintOwner,
      underlyingMint,
      generalAdminTokenAccount,
      underlyingMintOwner.publicKey,
      mintAmount
    );
    nonVerifiedUserCurrentAmount = mintAmount;
    generalAdminCurrentAmount = mintAmount;

    console.log("Minted underlying token to all users successfully");

    console.log("-------Before Step Finished-------");
  });

  it("Simple Strategy Vault: Reporting Profit for vault with non-zero profit max unlock time successfully increases share price", async () => {
    const depositAmount = 10_000000000;

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

    await accountantProgram.methods
      .initAccountant(accountantType)
      .accounts({
        signer: generalAdmin.publicKey,
      })
      .signers([generalAdmin])
      .rpc();

    const feeRecipient = anchor.web3.Keypair.generate();
    await airdrop({
      connection,
      publicKey: feeRecipient.publicKey,
      amount: 10e9,
    });

    const vaultConfig = {
      depositLimit: new BN(100_000000000),
      userDepositLimit: new BN(0),
      minUserDeposit: new BN(1_000000000),
      accountant: accountant,
      profitMaxUnlockTime: new BN(1),
      kycVerifiedOnly: false,
      directDepositEnabled: true,
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
        signer: generalAdmin,
        vaultConfig: vaultConfig,
        sharesConfig: sharesConfig,
      });

    const strategyConfig = new SimpleStrategyConfig({
      depositLimit: new BN(100_000000000),
      performanceFee: new BN(1000),
      feeManager: generalAdmin.publicKey,
    });

    const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
      strategyProgram,
      vault: vault,
      underlyingMint,
      signer: generalAdmin,
      config: strategyConfig,
    });

    await vaultProgram.methods
      .addStrategy(new BN(100_000000000))
      .accounts({
        vault: vault,
        strategy: strategy,
        signer: generalAdmin.publicKey,
      })
      .signers([generalAdmin])
      .rpc();

    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        accountant: accountant,
        signer: generalAdmin.publicKey,
        mint: sharesMint,
      })
      .signers([generalAdmin])
      .rpc();

    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        accountant: accountant,
        signer: generalAdmin.publicKey,
        mint: underlyingMint,
      })
      .signers([generalAdmin])
      .rpc();

    const feeRecipientTokenAccount = await token.createAccount(
      provider.connection,
      feeRecipient,
      underlyingMint,
      feeRecipient.publicKey
    );
    const feeRecipientSharesAccount = await token.createAccount(
      provider.connection,
      feeRecipient,
      sharesMint,
      feeRecipient.publicKey
    );

    const userSharesAccount = await token.createAccount(
      provider.connection,
      nonVerifiedUser,
      sharesMint,
      nonVerifiedUser.publicKey
    );

    // Direct Deposit
    let listener = null;

    // @ts-ignore
    let [event, slot] = await new Promise((resolve, _reject) => {
      listener = vaultProgram.addEventListener(
        "vaultDepositEvent",
        (event, slot) => {
          resolve([event, slot]);
        }
      );
      vaultProgram.methods
        .directDeposit(new BN(depositAmount))
        .accounts({
          vault: vault,
          accountant: accountant,
          user: nonVerifiedUser.publicKey,
          userTokenAccount: nonVerifiedUserTokenAccount,
          userSharesAccount: userSharesAccount,
          underlyingMint: underlyingMint,
          strategy: strategy,
        })
        .signers([nonVerifiedUser])
        .rpc();
    });
    await vaultProgram.removeEventListener(listener);
    console.log("Share Price Before: ", event.sharePrice / 1000000);

    // Report Profit
    await strategyProgram.methods
      .reportProfit(new BN(5_000000000))
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

    // Process Report
    [event, slot] = await new Promise((resolve, _reject) => {
      listener = vaultProgram.addEventListener(
        "strategyReportedEvent",
        (event, slot) => {
          resolve([event, slot]);
        }
      );
      vaultProgram.methods
        .processReport()
        .accounts({
          vault,
          strategy,
          signer: generalAdmin.publicKey,
          accountant,
        })
        .signers([generalAdmin])
        .rpc();
    });
    await vaultProgram.removeEventListener(listener);
    console.log("Share Price After: ", event.sharePrice / 1000000);
  });

  it("Simple Strategy Vault: Reporting Profit for vault with 0 profit max unlock time successfully increases share price", async () => {
    const depositAmount = 10_000000000;

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

    await accountantProgram.methods
      .initAccountant(accountantType)
      .accounts({
        signer: generalAdmin.publicKey,
      })
      .signers([generalAdmin])
      .rpc();

    const feeRecipient = anchor.web3.Keypair.generate();
    await airdrop({
      connection,
      publicKey: feeRecipient.publicKey,
      amount: 10e9,
    });

    const vaultConfig = {
      depositLimit: new BN(100_000000000),
      userDepositLimit: new BN(0),
      minUserDeposit: new BN(1_000000000),
      accountant: accountant,
      profitMaxUnlockTime: new BN(0),
      kycVerifiedOnly: false,
      directDepositEnabled: true,
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
        signer: generalAdmin,
        vaultConfig: vaultConfig,
        sharesConfig: sharesConfig,
      });

    const strategyConfig = new SimpleStrategyConfig({
      depositLimit: new BN(100_000000000),
      performanceFee: new BN(1000),
      feeManager: generalAdmin.publicKey,
    });

    const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
      strategyProgram,
      vault: vault,
      underlyingMint,
      signer: generalAdmin,
      config: strategyConfig,
    });

    await vaultProgram.methods
      .addStrategy(new BN(100_000000000))
      .accounts({
        vault: vault,
        strategy: strategy,
        signer: generalAdmin.publicKey,
      })
      .signers([generalAdmin])
      .rpc();

    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        accountant: accountant,
        signer: generalAdmin.publicKey,
        mint: sharesMint,
      })
      .signers([generalAdmin])
      .rpc();

    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        accountant: accountant,
        signer: generalAdmin.publicKey,
        mint: underlyingMint,
      })
      .signers([generalAdmin])
      .rpc();

    const feeRecipientTokenAccount = await token.createAccount(
      provider.connection,
      feeRecipient,
      underlyingMint,
      feeRecipient.publicKey
    );
    const feeRecipientSharesAccount = await token.createAccount(
      provider.connection,
      feeRecipient,
      sharesMint,
      feeRecipient.publicKey
    );

    const userSharesAccount = await token.createAccount(
      provider.connection,
      nonVerifiedUser,
      sharesMint,
      nonVerifiedUser.publicKey
    );

    // Direct Deposit
    let listener = null;

    // @ts-ignore
    let [event, slot] = await new Promise((resolve, _reject) => {
      listener = vaultProgram.addEventListener(
        "vaultDepositEvent",
        (event, slot) => {
          resolve([event, slot]);
        }
      );
      vaultProgram.methods
        .directDeposit(new BN(depositAmount))
        .accounts({
          vault: vault,
          accountant: accountant,
          user: nonVerifiedUser.publicKey,
          userTokenAccount: nonVerifiedUserTokenAccount,
          userSharesAccount: userSharesAccount,
          underlyingMint: underlyingMint,
          strategy: strategy,
        })
        .signers([nonVerifiedUser])
        .rpc();
    });
    await vaultProgram.removeEventListener(listener);
    const sharePriceBefore = event.sharePrice / 1000000;
    console.log("Share Price Before: ", event.sharePrice / 1000000);

    // Report Profit
    await strategyProgram.methods
      .reportProfit(new BN(5_000000000))
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

    // Process Report
    [event, slot] = await new Promise((resolve, _reject) => {
      listener = vaultProgram.addEventListener(
        "strategyReportedEvent",
        (event, slot) => {
          resolve([event, slot]);
        }
      );
      vaultProgram.methods
        .processReport()
        .accounts({
          vault,
          strategy,
          signer: generalAdmin.publicKey,
          accountant,
        })
        .signers([generalAdmin])
        .rpc();
    });
    await vaultProgram.removeEventListener(listener);
    const sharePriceAfter = event.sharePrice / 1000000;
    console.log("Share Price After: ", event.sharePrice / 1000000);
    expect(sharePriceAfter).to.be.greaterThan(sharePriceBefore);
  });

  it("Simple Strategy Vault: Reporting Loss for vault with non-zero profit max unlock time successfully decreases share price", async () => {
    const depositAmount = 10_000000000;

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

    await accountantProgram.methods
      .initAccountant(accountantType)
      .accounts({
        signer: generalAdmin.publicKey,
      })
      .signers([generalAdmin])
      .rpc();

    const feeRecipient = anchor.web3.Keypair.generate();
    await airdrop({
      connection,
      publicKey: feeRecipient.publicKey,
      amount: 10e9,
    });

    const vaultConfig = {
      depositLimit: new BN(100_000000000),
      userDepositLimit: new BN(0),
      minUserDeposit: new BN(1_000000000),
      accountant: accountant,
      profitMaxUnlockTime: new BN(31536000),
      kycVerifiedOnly: false,
      directDepositEnabled: true,
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
        signer: generalAdmin,
        vaultConfig: vaultConfig,
        sharesConfig: sharesConfig,
      });

    const strategyConfig = new SimpleStrategyConfig({
      depositLimit: new BN(100_000000000),
      performanceFee: new BN(1000),
      feeManager: generalAdmin.publicKey,
    });

    const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
      strategyProgram,
      vault: vault,
      underlyingMint,
      signer: generalAdmin,
      config: strategyConfig,
    });

    await vaultProgram.methods
      .addStrategy(new BN(100_000000000))
      .accounts({
        vault: vault,
        strategy: strategy,
        signer: generalAdmin.publicKey,
      })
      .signers([generalAdmin])
      .rpc();

    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        accountant: accountant,
        signer: generalAdmin.publicKey,
        mint: sharesMint,
      })
      .signers([generalAdmin])
      .rpc();

    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        accountant: accountant,
        signer: generalAdmin.publicKey,
        mint: underlyingMint,
      })
      .signers([generalAdmin])
      .rpc();

    const feeRecipientTokenAccount = await token.createAccount(
      provider.connection,
      feeRecipient,
      underlyingMint,
      feeRecipient.publicKey
    );
    const feeRecipientSharesAccount = await token.createAccount(
      provider.connection,
      feeRecipient,
      sharesMint,
      feeRecipient.publicKey
    );

    const userSharesAccount = await token.createAccount(
      provider.connection,
      nonVerifiedUser,
      sharesMint,
      nonVerifiedUser.publicKey
    );

    // Direct Deposit
    let listener = null;

    // @ts-ignore
    let [event, slot] = await new Promise((resolve, _reject) => {
      listener = vaultProgram.addEventListener(
        "vaultDepositEvent",
        (event, slot) => {
          resolve([event, slot]);
        }
      );
      vaultProgram.methods
        .directDeposit(new BN(depositAmount))
        .accounts({
          vault: vault,
          accountant: accountant,
          user: nonVerifiedUser.publicKey,
          userTokenAccount: nonVerifiedUserTokenAccount,
          userSharesAccount: userSharesAccount,
          underlyingMint: underlyingMint,
          strategy: strategy,
        })
        .signers([nonVerifiedUser])
        .rpc();
    });
    await vaultProgram.removeEventListener(listener);
    const sharePriceBefore = event.sharePrice / 1000000;
    console.log("Share Price Before: ", event.sharePrice / 1000000);

    // Report Profit
    await strategyProgram.methods
      .reportLoss(new BN(5_000000000))
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

    // Process Report
    [event, slot] = await new Promise((resolve, _reject) => {
      listener = vaultProgram.addEventListener(
        "strategyReportedEvent",
        (event, slot) => {
          resolve([event, slot]);
        }
      );
      vaultProgram.methods
        .processReport()
        .accounts({
          vault,
          strategy,
          signer: generalAdmin.publicKey,
          accountant,
        })
        .signers([generalAdmin])
        .rpc();
    });
    await vaultProgram.removeEventListener(listener);
    const sharePriceAfter = event.sharePrice / 1000000;
    console.log("Share Price After: ", event.sharePrice / 1000000);
    expect(sharePriceAfter).to.be.lessThan(sharePriceBefore);
  });

  it("Simple Strategy Vault: Reporting Loss for vault with 0 profit max unlock time successfully decreases share price", async () => {
    const depositAmount = 10_000000000;

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

    await accountantProgram.methods
      .initAccountant(accountantType)
      .accounts({
        signer: generalAdmin.publicKey,
      })
      .signers([generalAdmin])
      .rpc();

    const feeRecipient = anchor.web3.Keypair.generate();
    await airdrop({
      connection,
      publicKey: feeRecipient.publicKey,
      amount: 10e9,
    });

    const vaultConfig = {
      depositLimit: new BN(100_000000000),
      userDepositLimit: new BN(0),
      minUserDeposit: new BN(1_000000000),
      accountant: accountant,
      profitMaxUnlockTime: new BN(0),
      kycVerifiedOnly: false,
      directDepositEnabled: true,
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
        signer: generalAdmin,
        vaultConfig: vaultConfig,
        sharesConfig: sharesConfig,
      });

    const strategyConfig = new SimpleStrategyConfig({
      depositLimit: new BN(100_000000000),
      performanceFee: new BN(1000),
      feeManager: generalAdmin.publicKey,
    });

    const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
      strategyProgram,
      vault: vault,
      underlyingMint,
      signer: generalAdmin,
      config: strategyConfig,
    });

    await vaultProgram.methods
      .addStrategy(new BN(100_000000000))
      .accounts({
        vault: vault,
        strategy: strategy,
        signer: generalAdmin.publicKey,
      })
      .signers([generalAdmin])
      .rpc();

    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        accountant: accountant,
        signer: generalAdmin.publicKey,
        mint: sharesMint,
      })
      .signers([generalAdmin])
      .rpc();

    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        accountant: accountant,
        signer: generalAdmin.publicKey,
        mint: underlyingMint,
      })
      .signers([generalAdmin])
      .rpc();

    const feeRecipientTokenAccount = await token.createAccount(
      provider.connection,
      feeRecipient,
      underlyingMint,
      feeRecipient.publicKey
    );
    const feeRecipientSharesAccount = await token.createAccount(
      provider.connection,
      feeRecipient,
      sharesMint,
      feeRecipient.publicKey
    );

    const userSharesAccount = await token.createAccount(
      provider.connection,
      nonVerifiedUser,
      sharesMint,
      nonVerifiedUser.publicKey
    );

    // Direct Deposit
    let listener = null;

    // @ts-ignore
    let [event, slot] = await new Promise((resolve, _reject) => {
      listener = vaultProgram.addEventListener(
        "vaultDepositEvent",
        (event, slot) => {
          resolve([event, slot]);
        }
      );
      vaultProgram.methods
        .directDeposit(new BN(depositAmount))
        .accounts({
          vault: vault,
          accountant: accountant,
          user: nonVerifiedUser.publicKey,
          userTokenAccount: nonVerifiedUserTokenAccount,
          userSharesAccount: userSharesAccount,
          underlyingMint: underlyingMint,
          strategy: strategy,
        })
        .signers([nonVerifiedUser])
        .rpc();
    });
    await vaultProgram.removeEventListener(listener);
    const sharePriceBefore = event.sharePrice / 1000000;
    console.log("Share Price Before: ", event.sharePrice / 1000000);

    // Report Profit
    await strategyProgram.methods
      .reportLoss(new BN(5_000000000))
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

    // Process Report
    [event, slot] = await new Promise((resolve, _reject) => {
      listener = vaultProgram.addEventListener(
        "strategyReportedEvent",
        (event, slot) => {
          resolve([event, slot]);
        }
      );
      vaultProgram.methods
        .processReport()
        .accounts({
          vault,
          strategy,
          signer: generalAdmin.publicKey,
          accountant,
        })
        .signers([generalAdmin])
        .rpc();
    });
    await vaultProgram.removeEventListener(listener);
    const sharePriceAfter = event.sharePrice / 1000000;
    console.log("Share Price After: ", event.sharePrice / 1000000);
    expect(sharePriceAfter).to.be.lessThan(sharePriceBefore);
  });

  it("Simple Strategy Vault: Reporting Profit for vault with 0 performance fee successfully increases share price", async () => {
    const depositAmount = 10_000000000;

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

    await accountantProgram.methods
      .initAccountant(accountantType)
      .accounts({
        signer: generalAdmin.publicKey,
      })
      .signers([generalAdmin])
      .rpc();

    const feeRecipient = anchor.web3.Keypair.generate();
    await airdrop({
      connection,
      publicKey: feeRecipient.publicKey,
      amount: 10e9,
    });

    const vaultConfig = {
      depositLimit: new BN(100_000000000),
      userDepositLimit: new BN(0),
      minUserDeposit: new BN(1_000000000),
      accountant: accountant,
      profitMaxUnlockTime: new BN(0),
      kycVerifiedOnly: false,
      directDepositEnabled: true,
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
        signer: generalAdmin,
        vaultConfig: vaultConfig,
        sharesConfig: sharesConfig,
      });

    const strategyConfig = new SimpleStrategyConfig({
      depositLimit: new BN(100_000000000),
      performanceFee: new BN(0),
      feeManager: generalAdmin.publicKey,
    });

    const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
      strategyProgram,
      vault: vault,
      underlyingMint,
      signer: generalAdmin,
      config: strategyConfig,
    });

    await vaultProgram.methods
      .addStrategy(new BN(100_000000000))
      .accounts({
        vault: vault,
        strategy: strategy,
        signer: generalAdmin.publicKey,
      })
      .signers([generalAdmin])
      .rpc();

    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        accountant: accountant,
        signer: generalAdmin.publicKey,
        mint: sharesMint,
      })
      .signers([generalAdmin])
      .rpc();

    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        accountant: accountant,
        signer: generalAdmin.publicKey,
        mint: underlyingMint,
      })
      .signers([generalAdmin])
      .rpc();

    const feeRecipientTokenAccount = await token.createAccount(
      provider.connection,
      feeRecipient,
      underlyingMint,
      feeRecipient.publicKey
    );
    const feeRecipientSharesAccount = await token.createAccount(
      provider.connection,
      feeRecipient,
      sharesMint,
      feeRecipient.publicKey
    );

    const userSharesAccount = await token.createAccount(
      provider.connection,
      nonVerifiedUser,
      sharesMint,
      nonVerifiedUser.publicKey
    );

    // Direct Deposit
    let listener = null;

    // @ts-ignore
    let [event, slot] = await new Promise((resolve, _reject) => {
      listener = vaultProgram.addEventListener(
        "vaultDepositEvent",
        (event, slot) => {
          resolve([event, slot]);
        }
      );
      vaultProgram.methods
        .directDeposit(new BN(depositAmount))
        .accounts({
          vault: vault,
          accountant: accountant,
          user: nonVerifiedUser.publicKey,
          userTokenAccount: nonVerifiedUserTokenAccount,
          userSharesAccount: userSharesAccount,
          underlyingMint: underlyingMint,
          strategy: strategy,
        })
        .signers([nonVerifiedUser])
        .rpc();
    });
    await vaultProgram.removeEventListener(listener);
    const sharePriceBefore = event.sharePrice / 1000000;
    console.log("Share Price Before: ", event.sharePrice / 1000000);

    // Report Profit
    await strategyProgram.methods
      .reportProfit(new BN(5_000000000))
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

    // Process Report
    [event, slot] = await new Promise((resolve, _reject) => {
      listener = vaultProgram.addEventListener(
        "strategyReportedEvent",
        (event, slot) => {
          resolve([event, slot]);
        }
      );
      vaultProgram.methods
        .processReport()
        .accounts({
          vault,
          strategy,
          signer: generalAdmin.publicKey,
          accountant,
        })
        .signers([generalAdmin])
        .rpc();
    });
    await vaultProgram.removeEventListener(listener);
    const sharePriceAfter = event.sharePrice / 1000000;
    console.log("Share Price After: ", event.sharePrice / 1000000);
    expect(sharePriceAfter).to.be.greaterThan(sharePriceBefore);
  });

  it("Simple Strategy Vault: Reporting Loss for vault with 0 performance fee successfully decreases share price", async () => {
    const depositAmount = 10_000000000;

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

    await accountantProgram.methods
      .initAccountant(accountantType)
      .accounts({
        signer: generalAdmin.publicKey,
      })
      .signers([generalAdmin])
      .rpc();

    const feeRecipient = anchor.web3.Keypair.generate();
    await airdrop({
      connection,
      publicKey: feeRecipient.publicKey,
      amount: 10e9,
    });

    const vaultConfig = {
      depositLimit: new BN(100_000000000),
      userDepositLimit: new BN(0),
      minUserDeposit: new BN(1_000000000),
      accountant: accountant,
      profitMaxUnlockTime: new BN(0),
      kycVerifiedOnly: false,
      directDepositEnabled: true,
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
        signer: generalAdmin,
        vaultConfig: vaultConfig,
        sharesConfig: sharesConfig,
      });

    const strategyConfig = new SimpleStrategyConfig({
      depositLimit: new BN(100_000000000),
      performanceFee: new BN(0),
      feeManager: generalAdmin.publicKey,
    });

    const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
      strategyProgram,
      vault: vault,
      underlyingMint,
      signer: generalAdmin,
      config: strategyConfig,
    });

    await vaultProgram.methods
      .addStrategy(new BN(100_000000000))
      .accounts({
        vault: vault,
        strategy: strategy,
        signer: generalAdmin.publicKey,
      })
      .signers([generalAdmin])
      .rpc();

    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        accountant: accountant,
        signer: generalAdmin.publicKey,
        mint: sharesMint,
      })
      .signers([generalAdmin])
      .rpc();

    await accountantProgram.methods
      .initTokenAccount()
      .accounts({
        accountant: accountant,
        signer: generalAdmin.publicKey,
        mint: underlyingMint,
      })
      .signers([generalAdmin])
      .rpc();

    const feeRecipientTokenAccount = await token.createAccount(
      provider.connection,
      feeRecipient,
      underlyingMint,
      feeRecipient.publicKey
    );
    const feeRecipientSharesAccount = await token.createAccount(
      provider.connection,
      feeRecipient,
      sharesMint,
      feeRecipient.publicKey
    );

    const userSharesAccount = await token.createAccount(
      provider.connection,
      nonVerifiedUser,
      sharesMint,
      nonVerifiedUser.publicKey
    );

    // Direct Deposit
    let listener = null;

    // @ts-ignore
    let [event, slot] = await new Promise((resolve, _reject) => {
      listener = vaultProgram.addEventListener(
        "vaultDepositEvent",
        (event, slot) => {
          resolve([event, slot]);
        }
      );
      vaultProgram.methods
        .directDeposit(new BN(depositAmount))
        .accounts({
          vault: vault,
          accountant: accountant,
          user: nonVerifiedUser.publicKey,
          userTokenAccount: nonVerifiedUserTokenAccount,
          userSharesAccount: userSharesAccount,
          underlyingMint: underlyingMint,
          strategy: strategy,
        })
        .signers([nonVerifiedUser])
        .rpc();
    });
    await vaultProgram.removeEventListener(listener);
    const sharePriceBefore = event.sharePrice / 1000000;
    console.log("Share Price Before: ", event.sharePrice / 1000000);

    // Report Profit
    await strategyProgram.methods
      .reportLoss(new BN(5_000000000))
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

    // Process Report
    [event, slot] = await new Promise((resolve, _reject) => {
      listener = vaultProgram.addEventListener(
        "strategyReportedEvent",
        (event, slot) => {
          resolve([event, slot]);
        }
      );
      vaultProgram.methods
        .processReport()
        .accounts({
          vault,
          strategy,
          signer: generalAdmin.publicKey,
          accountant,
        })
        .signers([generalAdmin])
        .rpc();
    });
    await vaultProgram.removeEventListener(listener);
    const sharePriceAfter = event.sharePrice / 1000000;
    console.log("Share Price After: ", event.sharePrice / 1000000);
    expect(sharePriceAfter).to.be.lessThan(sharePriceBefore);
  });
});
