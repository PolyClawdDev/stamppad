/**
 * ZIP-317 conventional fees.
 * https://zips.z.cash/zip-0317
 *
 * Zcash has no fee market to estimate against and no node method that answers
 * usefully: zcashd's `estimatefee` was deprecated and returns -1, and zebrad
 * never implemented it. Since NU5 the fee is a rule instead, computed from the
 * shape of the transaction, and both zcashd and zebrad will decline to relay a
 * transaction paying less than the conventional fee for its own size. So the
 * fee is worked out here rather than asked for.
 *
 * The rule prices a transaction in "logical actions": one per standard P2PKH
 * input and one per standard P2PKH output, with anything larger than standard
 * counting proportionally. A reveal carrying a 429-byte scriptSig is therefore
 * four input-actions, not one, which is why revealing costs twice what
 * committing does.
 *
 * tests/zcash-inscribe.test.ts checks this against the reference stamp, whose
 * commit paid exactly 10,000 zatoshi and whose reveal paid exactly 20,000. Both
 * fall out of the formula below; neither is hardcoded.
 */
import { compactSize } from "./transaction";

/** Zatoshi per logical action. */
export const MARGINAL_FEE = 5_000n;

/** Actions below this are free, so the floor on any fee is 2 × MARGINAL_FEE. */
export const GRACE_ACTIONS = 2n;

/** Size of a P2PKH input: 36 outpoint + 1 length + 107 scriptSig + 4 sequence + 2 slack. */
export const P2PKH_STANDARD_INPUT_SIZE = 150;

/** Size of a P2PKH output: 8 value + 1 length + 25 scriptPubKey. */
export const P2PKH_STANDARD_OUTPUT_SIZE = 34;

/** The minimum a transparent output may carry and still be relayed. */
export const DUST_THRESHOLD_ZAT = 546n;

function divCeil(a: number, b: number): number {
  return Math.ceil(a / b);
}

/** Serialized size of one transparent input, scriptSig included. */
export function inputSize(scriptSigBytes: number): number {
  return 32 + 4 + compactSize(scriptSigBytes).length + scriptSigBytes + 4;
}

/** Serialized size of one transparent output. */
export function outputSize(scriptPubKeyBytes: number): number {
  return 8 + compactSize(scriptPubKeyBytes).length + scriptPubKeyBytes;
}

export interface FeeShape {
  /** scriptSig length of each input, in bytes. */
  inputScriptSigSizes: readonly number[];
  /** scriptPubKey length of each output, in bytes. */
  outputScriptPubKeySizes: readonly number[];
}

/**
 * ZIP-317 logical actions for a transparent-only transaction. Inputs and
 * outputs are each totalled and divided by the standard size, and the larger of
 * the two counts wins; they are not added.
 */
export function logicalActions(shape: FeeShape): number {
  const inTotal = shape.inputScriptSigSizes.reduce((sum, size) => sum + inputSize(size), 0);
  const outTotal = shape.outputScriptPubKeySizes.reduce((sum, size) => sum + outputSize(size), 0);
  return Math.max(
    divCeil(inTotal, P2PKH_STANDARD_INPUT_SIZE),
    divCeil(outTotal, P2PKH_STANDARD_OUTPUT_SIZE),
  );
}

/** The fee a transaction of this shape must pay to be relayed. */
export function conventionalFee(shape: FeeShape): bigint {
  const actions = BigInt(logicalActions(shape));
  return MARGINAL_FEE * (actions > GRACE_ACTIONS ? actions : GRACE_ACTIONS);
}
