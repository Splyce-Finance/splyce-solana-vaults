import * as anchor from "@coral-xyz/anchor";
import { TokenizedVault } from "../../target/types/tokenized_vault";
import { BN, web3 } from "@coral-xyz/anchor";
import { Strategy } from "../../target/types/strategy";
import { SimpleStrategyConfigSchema } from "./schemas";
import * as borsh from "borsh";
import {
  METADATA_SEED,
  provider,
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


