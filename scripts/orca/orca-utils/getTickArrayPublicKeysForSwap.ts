//need to get is_a_to_b_for_purchase from the invest tracker
//if the flow is to buy, use is_a_to_b_for_purchase as is_a_to_b
//if the flow is to sell, use is_a_to_b_for_purchase as !is_a_to_b
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getTickArrayPda, TICK_ARRAY_SIZE } from "@orca-so/whirlpool-client-sdk";
import { OrcaDAL } from "./dal/orca-dal";
import { translateAddress } from "@project-serum/anchor";
import { TickUtil } from "./tick-util";

/**
 * Gets the tick array public keys needed for a swap operation
 */
export async function getTickArrayPublicKeysForSwap(
  poolAddress: PublicKey,
  programId: PublicKey,
  aToB: boolean,
  dal: OrcaDAL
): Promise<[PublicKey, PublicKey, PublicKey]> {
  // Retrieve the whirlpool data
  const whirlpool = await dal.getPool(poolAddress, true);
  if (!whirlpool) {
    throw new Error(`Whirlpool not found: ${translateAddress(poolAddress).toBase58()}`);
  }

  const { tickCurrentIndex, tickSpacing } = whirlpool;
  const startTickIndex = TickUtil.getStartTickIndex(tickCurrentIndex, tickSpacing);
  const direction = aToB ? -1 : 1;

  return [
    getTickArrayPda(programId, poolAddress, startTickIndex).publicKey,
    getTickArrayPda(programId, poolAddress, startTickIndex + (direction * tickSpacing * TICK_ARRAY_SIZE)).publicKey,
    getTickArrayPda(programId, poolAddress, startTickIndex + (direction * tickSpacing * TICK_ARRAY_SIZE * 2)).publicKey,
  ];
}