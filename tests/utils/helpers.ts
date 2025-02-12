import * as anchor from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { BN, web3 } from "@coral-xyz/anchor";
import { Strategy } from "../../target/types/strategy";
import { SimpleStrategyConfig, SimpleStrategyConfigSchema } from "./schemas";
import * as borsh from "borsh";
import {
  accountantProgram,
  connection,
  METADATA_SEED,
  provider,
  strategyProgram,
  TOKEN_METADATA_PROGRAM_ID,
  vaultProgram,
} from "../integration/setups/globalSetup";
import * as token from "@solana/spl-token";
import { assert } from "chai";

export const airdrop = async ({
  connection,
  publicKey,
  amount,
}: {
  connection: anchor.web3.Connection;
  publicKey: anchor.web3.PublicKey;
  amount: number;
}) => {
  const latestBlockHash = await connection.getLatestBlockhash();
  const airdropSignature = await connection.requestAirdrop(publicKey, amount);
  await connection.confirmTransaction({
    blockhash: latestBlockHash.blockhash,
    lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
    signature: airdropSignature,
  });
};

export const initializeVault = async ({
  vaultProgram,
  underlyingMint,
  signer,
  vaultConfig,
  sharesConfig,
}: {
  vaultProgram: anchor.Program<TokenizedVault>;
  underlyingMint: anchor.web3.PublicKey;
  signer: anchor.web3.Keypair;
  vaultConfig: any;
  sharesConfig: any;
}) => {
  const config = web3.PublicKey.findProgramAddressSync(
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

  const vaultTokenAccount = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("underlying"), vault.toBuffer()],
    vaultProgram.programId
  )[0];

  const [metadataAddress] = web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from(METADATA_SEED),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      sharesMint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  await vaultProgram.methods
    .initVault(vaultConfig)
    .accounts({
      underlyingMint,
      signer: signer.publicKey,
      tokenProgram: token.TOKEN_PROGRAM_ID,
    })
    .signers([signer])
    .rpc();

  await vaultProgram.methods
    .initVaultShares(new BN(nextVaultIndex), sharesConfig)
    .accounts({
      metadata: metadataAddress,
      signer: signer.publicKey,
    })
    .signers([signer])
    .rpc();

  return [vault, sharesMint, metadataAddress, vaultTokenAccount];
};

export const initializeSimpleStrategy = async ({
  strategyProgram,
  vault,
  underlyingMint,
  signer,
  config,
}: {
  strategyProgram: anchor.Program<Strategy>;
  vault: anchor.web3.PublicKey;
  underlyingMint: anchor.web3.PublicKey;
  signer: anchor.web3.Keypair;
  config: any;
}) => {
  const globalStrategyConfig = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    strategyProgram.programId
  )[0];

  let configAccount = await strategyProgram.account.config.fetch(
    globalStrategyConfig
  );
  const nextStrategyIndex = configAccount.nextStrategyIndex.toNumber();

  const strategy = web3.PublicKey.findProgramAddressSync(
    [
      vault.toBuffer(),
      Buffer.from(
        new Uint8Array(new BigUint64Array([BigInt(nextStrategyIndex)]).buffer)
      ),
    ],
    strategyProgram.programId
  )[0];

  const strategyTokenAccount = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("underlying"), strategy.toBuffer()],
    strategyProgram.programId
  )[0];

  const strategyType = { simple: {} };

  const configBytes = Buffer.from(
    borsh.serialize(SimpleStrategyConfigSchema, config)
  );

  await strategyProgram.methods
    .initStrategy(strategyType, configBytes)
    .accounts({
      vault,
      signer: signer.publicKey,
      underlyingMint,
      tokenProgram: token.TOKEN_PROGRAM_ID,
    })
    .signers([signer])
    .rpc();

  return [strategy, strategyTokenAccount];
};

export const validateDeposit = async ({
  userTokenAccount,
  userTokenAccountAmountExpected,
  userSharesAccount,
  userSharesAccountAmountExpected,
  vaultTokenAccount,
  vaultTokenAccountAmountExpected,
  vault,
  vaultTotalIdleAmountExpected,
  vaultTotalSharesAmountExpected,
}: {
  userTokenAccount: anchor.web3.PublicKey;
  userTokenAccountAmountExpected: number;
  userSharesAccount: anchor.web3.PublicKey;
  userSharesAccountAmountExpected: number;
  vaultTokenAccount: anchor.web3.PublicKey;
  vaultTokenAccountAmountExpected: number;
  vault: anchor.web3.PublicKey;
  vaultTotalIdleAmountExpected: number;
  vaultTotalSharesAmountExpected: number;
}) => {
  let vaultTokenAccountInfo = await token.getAccount(
    provider.connection,
    vaultTokenAccount
  );
  assert.strictEqual(
    vaultTokenAccountInfo.amount.toString(),
    vaultTokenAccountAmountExpected.toString()
  );

  let userTokenAccountInfo = await token.getAccount(
    provider.connection,
    userTokenAccount
  );
  assert.strictEqual(
    userTokenAccountInfo.amount.toString(),
    userTokenAccountAmountExpected.toString()
  );

  let userSharesAccountInfo = await token.getAccount(
    provider.connection,
    userSharesAccount
  );
  assert.strictEqual(
    userSharesAccountInfo.amount.toString(),
    userSharesAccountAmountExpected.toString()
  );

  const vaultAccount = await vaultProgram.account.vault.fetch(vault);
  assert.strictEqual(
    vaultAccount.totalIdle.toString(),
    vaultTotalIdleAmountExpected.toString()
  );
  assert.strictEqual(
    vaultAccount.totalShares.toString(),
    vaultTotalSharesAmountExpected.toString()
  );
};

export const validateDirectDeposit = async ({
  userTokenAccount,
  userTokenAccountAmountExpected,
  userSharesAccount,
  userSharesAccountAmountExpected,
  vaultTokenAccount,
  vaultTokenAccountAmountExpected,
  vault,
  vaultTotalDebtAmountExpected,
  vaultTotalSharesAmountExpected,
  strategyTokenAccount,
  strategyTokenAccountAmountExpected,
  strategy,
  strategyCurrentDebtAmountExpected,
}: {
  userTokenAccount: anchor.web3.PublicKey;
  userTokenAccountAmountExpected: number;
  userSharesAccount: anchor.web3.PublicKey;
  userSharesAccountAmountExpected: number;
  vaultTokenAccount: anchor.web3.PublicKey;
  vaultTokenAccountAmountExpected: number;
  vault: anchor.web3.PublicKey;
  vaultTotalDebtAmountExpected: number;
  vaultTotalSharesAmountExpected: number;
  strategyTokenAccount: anchor.web3.PublicKey;
  strategyTokenAccountAmountExpected: number;
  strategy: anchor.web3.PublicKey;
  strategyCurrentDebtAmountExpected: number;
}) => {
  let userTokenAccountInfo = await token.getAccount(
    provider.connection,
    userTokenAccount
  );
  assert.strictEqual(
    userTokenAccountInfo.amount.toString(),
    userTokenAccountAmountExpected.toString()
  );

  let userSharesAccountInfo = await token.getAccount(
    provider.connection,
    userSharesAccount
  );
  assert.strictEqual(
    userSharesAccountInfo.amount.toString(),
    userSharesAccountAmountExpected.toString()
  );

  let vaultTokenAccountInfo = await token.getAccount(
    provider.connection,
    vaultTokenAccount
  );
  assert.strictEqual(
    vaultTokenAccountInfo.amount.toString(),
    vaultTokenAccountAmountExpected.toString()
  );

  const vaultAccount = await vaultProgram.account.vault.fetch(vault);
  assert.strictEqual(
    vaultAccount.totalDebt.toString(),
    vaultTotalDebtAmountExpected.toString()
  );
  assert.strictEqual(
    vaultAccount.totalShares.toString(),
    vaultTotalSharesAmountExpected.toString()
  );

  let strategyTokenAccountInfo = await token.getAccount(
    provider.connection,
    strategyTokenAccount
  );
  assert.strictEqual(
    strategyTokenAccountInfo.amount.toString(),
    strategyTokenAccountAmountExpected.toString()
  );

  const strategyData = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_data"), vault.toBuffer(), strategy.toBuffer()],
    vaultProgram.programId
  )[0];
  const strategyDataAccount = await vaultProgram.account.strategyData.fetch(
    strategyData
  );
  assert.strictEqual(
    strategyDataAccount.currentDebt.toString(),
    strategyCurrentDebtAmountExpected.toString()
  );
};

export const initNextAccountant = async ({
  accountantConfig,
  admin,
}: {
  accountantConfig: anchor.web3.PublicKey;
  admin: anchor.web3.Keypair;
}): Promise<anchor.web3.PublicKey> => {
  const accountantConfigAccount = await accountantProgram.account.config.fetch(
    accountantConfig
  );
  const accountant = anchor.web3.PublicKey.findProgramAddressSync(
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
    .initAccountant({ generic: {} })
    .accounts({
      signer: admin.publicKey,
    })
    .signers([admin])
    .rpc();

  return accountant;
};

export const setUpTestUser = async ({
  underlyingMint,
  underlyingMintOwner,
  mintAmount,
}: {
  underlyingMint: anchor.web3.PublicKey;
  underlyingMintOwner: anchor.web3.Keypair;
  mintAmount: number;
}) => {
  const user = anchor.web3.Keypair.generate();
  await airdrop({
    connection: connection,
    publicKey: user.publicKey,
    amount: 10e9,
  });
  const userTokenAccount = await token.createAccount(
    connection,
    user,
    underlyingMint,
    user.publicKey
  );
  await token.mintTo(
    connection,
    underlyingMintOwner,
    underlyingMint,
    userTokenAccount,
    underlyingMintOwner.publicKey,
    mintAmount
  );
  return { user, userTokenAccount };
};

export const setUpTestVaultWithSingleStrategy = async ({
  admin,
  accountant,
  vaultConfig,
  underlyingMint,
  strategyConfig,
  strategyMaxDebt,
}: {
  admin: anchor.web3.Keypair;
  accountant: anchor.web3.PublicKey;
  vaultConfig: any;
  underlyingMint: anchor.web3.PublicKey;
  strategyConfig: SimpleStrategyConfig;
  strategyMaxDebt: number;
}) => {
  const sharesConfig = {
    name: "Vault Test Shares",
    symbol: "VTS",
    uri: "https://gist.githubusercontent.com/vito-kovalione/08b86d3c67440070a8061ae429572494/raw/833e3d5f5988c18dce2b206a74077b2277e13ab6/PVT.json",
  };

  const [vault, sharesMint, metadataAccount, vaultTokenAccount] =
    await initializeVault({
      vaultProgram,
      underlyingMint,
      signer: admin,
      vaultConfig: vaultConfig,
      sharesConfig: sharesConfig,
    });

  const feeRecipient = anchor.web3.Keypair.generate();
  await airdrop({
    connection: connection,
    publicKey: feeRecipient.publicKey,
    amount: 10e9,
  });

  const feeRecipientSharesAccount = await token.createAccount(
    provider.connection,
    feeRecipient,
    sharesMint,
    feeRecipient.publicKey
  );
  const feeRecipientTokenAccount = await token.createAccount(
    provider.connection,
    feeRecipient,
    underlyingMint,
    feeRecipient.publicKey
  );

  const [strategy, strategyTokenAccount] = await initializeSimpleStrategy({
    strategyProgram,
    vault: vault,
    underlyingMint,
    signer: admin,
    config: strategyConfig,
  });

  await vaultProgram.methods
    .addStrategy(new BN(strategyMaxDebt))
    .accounts({
      vault,
      strategy,
      signer: admin.publicKey,
    })
    .signers([admin])
    .rpc();

  // Create token accounts and mint underlying tokens
  await accountantProgram.methods
    .initTokenAccount()
    .accounts({
      accountant: accountant,
      signer: admin.publicKey,
      mint: sharesMint,
    })
    .signers([admin])
    .rpc();

  await accountantProgram.methods
    .initTokenAccount()
    .accounts({
      accountant: accountant,
      signer: admin.publicKey,
      mint: underlyingMint,
    })
    .signers([admin])
    .rpc();

  return {
    vault,
    sharesMint,
    metadataAccount,
    vaultTokenAccount,
    strategy,
    strategyTokenAccount,
    accountant,
    feeRecipient,
    feeRecipientTokenAccount,
    feeRecipientSharesAccount,
  };
};

export const validateUserTokenAndShareData = async ({
  userTokenAccount,
  userSharesAccount,
  userCurrentTokenAmount,
  userSharesCurrentAmount,
}: {
  userTokenAccount: anchor.web3.PublicKey;
  userSharesAccount: anchor.web3.PublicKey;
  userCurrentTokenAmount: number;
  userSharesCurrentAmount: number;
}): Promise<void> => {
  let userTokenAccountInfo = await token.getAccount(
    provider.connection,
    userTokenAccount
  );
  let userSharesAccountInfo = await token.getAccount(
    provider.connection,
    userSharesAccount
  );

  assert.strictEqual(
    userTokenAccountInfo.amount.toString(),
    userCurrentTokenAmount.toString(),
    "User Token Account Amount equal invalid"
  );
  assert.strictEqual(
    userSharesAccountInfo.amount.toString(),
    userSharesCurrentAmount.toString(),
    "User Shares Account Amount invalid"
  );
};

export const validateVaultTokenAndShareData = async ({
  vaultTokenAccount,
  vault,
  vaultTokenAccountCurrentAmount,
  vaultTotalIdleCurrentAmount,
  vaultTotalSharesCurrentAmount,
  vaultTotalDebtCurrentAmount,
}: {
  vaultTokenAccount: anchor.web3.PublicKey;
  vault: anchor.web3.PublicKey;
  vaultTokenAccountCurrentAmount: number;
  vaultTotalIdleCurrentAmount: number;
  vaultTotalSharesCurrentAmount: number;
  vaultTotalDebtCurrentAmount: number;
}): Promise<void> => {
  let vaultTokenAccountInfo = await token.getAccount(
    provider.connection,
    vaultTokenAccount
  );
  const vaultAccount = await vaultProgram.account.vault.fetch(vault);

  assert.strictEqual(
    vaultTokenAccountInfo.amount.toString(),
    vaultTokenAccountCurrentAmount.toString(),
    "Vault Token Account Amount invalid"
  );
  assert.strictEqual(
    vaultAccount.totalIdle.toString(),
    vaultTotalIdleCurrentAmount.toString(),
    "Vault Total Idle Amount invalid"
  );
  assert.strictEqual(
    vaultAccount.totalShares.toString(),
    vaultTotalSharesCurrentAmount.toString(),
    "Vault Total Shares Amount invalid"
  );
  assert.strictEqual(
    vaultAccount.totalDebt.toString(),
    vaultTotalDebtCurrentAmount.toString(),
    "Vault Total Debt Amount invalid"
  );
};
