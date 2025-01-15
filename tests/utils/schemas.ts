import { BN } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";

export class VaultConfig {
    index: BN;
    deposit_limit: BN;
    min_user_deposit: BN;
    performance_fee: BN;
    profit_max_unlock_time: BN;

    constructor(fields: { index: BN, deposit_limit: BN, min_user_deposit: BN, performance_fee: BN, profit_max_unlock_time: BN }) {
        this.index = fields.index;
        this.deposit_limit = fields.deposit_limit;
        this.min_user_deposit = fields.min_user_deposit;
        this.performance_fee = fields.performance_fee;
        this.profit_max_unlock_time = fields.profit_max_unlock_time;
    }
}

export class SimpleStrategyConfig {
    depositLimit: BN;
    performanceFee: BN;
    feeManager: Buffer;

    constructor(fields: { depositLimit: BN, performanceFee: BN, feeManager: anchor.web3.PublicKey }) {
        this.depositLimit = fields.depositLimit;
        this.performanceFee = fields.performanceFee;
        this.feeManager = fields.feeManager.toBuffer();
    }
}

export class TradeFintechConfig {
    depositLimit: BN;
    depositPeriodEnds: BN;
    lockPeriodEnds: BN;
    performanceFee: BN;
    feeManager: Buffer;

    constructor(fields: {
        depositLimit: BN,
        depositPeriodEnds: BN,
        lockPeriodEnds: BN,
        performanceFee: BN,
        feeManager: anchor.web3.PublicKey
    }) {
        this.depositLimit = fields.depositLimit;
        this.depositPeriodEnds = fields.depositPeriodEnds;
        this.lockPeriodEnds = fields.lockPeriodEnds;
        this.performanceFee = fields.performanceFee;
        this.feeManager = fields.feeManager.toBuffer();
    }
}


export const VaultConfigSchema = new Map([
    [
        VaultConfig,
        {
            kind: 'struct',
            fields: [
                ['index', 'u64'],
                ['deposit_limit', 'u64'],
                ['min_user_deposit', 'u64'],
                ['performance_fee', 'u64'],
                ['profit_max_unlock_time', 'u64'],
            ],
        },
    ],
]);

// Define the schema for SimpleStrategy
export const SimpleStrategyConfigSchema = new Map([
    [
        SimpleStrategyConfig,
        {
            kind: 'struct',
            fields: [
                ['depositLimit', 'u64'],
                ['performanceFee', 'u64'],
                ['feeManager', [32]],
            ],
        },
    ],
]);

export const TradeFintechConfigSchema = new Map([
    [
        TradeFintechConfig,
        {
            kind: 'struct',
            fields: [
                ['depositLimit', 'u64'],
                ['depositPeriodEnds', 'u64'],
                ['lockPeriodEnds', 'u64'],
                ['performanceFee', 'u64'],
                ['feeManager', [32]],
            ],
        },
    ],
]);

// Orca Strategy Config
export class OrcaStrategyConfig {
    depositLimit: BN;
    performanceFee: BN;
    feeManager: Buffer;
    whirlpoolId: Buffer;
    assetMint: Buffer;
    assetDecimals: number;
    aToBForPurchase: number;

    constructor(fields: {
        depositLimit: BN,
        performanceFee: BN,
        feeManager: anchor.web3.PublicKey,
        whirlpoolId: anchor.web3.PublicKey,
        assetMint: anchor.web3.PublicKey,
        assetDecimals: number,
        aToBForPurchase: number;
    }) {
        this.depositLimit = fields.depositLimit;
        this.performanceFee = fields.performanceFee;
        this.feeManager = fields.feeManager.toBuffer();
        this.whirlpoolId = fields.whirlpoolId.toBuffer();
        this.assetMint = fields.assetMint.toBuffer();
        this.assetDecimals = fields.assetDecimals;
        this.aToBForPurchase = fields.aToBForPurchase;
    }
}

export const OrcaStrategyConfigSchema = new Map([
    [
        OrcaStrategyConfig,
        {
            kind: 'struct',
            fields: [
                ['depositLimit', 'u64'],
                ['performanceFee', 'u64'],
                ['feeManager', [32]],
                ['whirlpoolId', [32]],
                ['assetMint', [32]],
                ['assetDecimals', 'u8'],
                ['aToBForPurchase', 'u8'],
            ],
        },
    ],
]);