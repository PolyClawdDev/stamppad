/**
 * ZIP-244: the v5 transaction identifier, signature and authorizing digests.
 * https://zips.z.cash/zip-0244
 *
 * All three are trees of personalized BLAKE2b-256 hashes over the same four
 * branches: header, transparent, Sapling, Orchard. The txid and the signature
 * digest share a root personalization, `"ZcashTxHash_" || branch_id`, and
 * differ only in the transparent branch, which is why a fully shielded
 * transaction signs its own txid.
 *
 * Two details are easy to get wrong and fatal if you do.
 *
 * First, the digests are personalized with the consensus branch ID. Signing
 * against the wrong epoch produces a signature that verifies against nothing,
 * and the failure looks like a rejected transaction rather than a bug.
 *
 * Second, ZIP-244 changed what a transparent input signature commits to.
 * ZIP-243 committed to the redeemScript for a P2SH coin; ZIP-244's S.2g.iii
 * commits to the *scriptPubKey* of the coin being spent, that is, the
 * `OP_HASH160 <20> OP_EQUAL` script, never the preimage. Using the redeem
 * script there is the single most likely way to produce a transaction that
 * looks perfect and is unspendable. tests/zcash-zip244.test.ts settles it by
 * recomputing the digest for the real mainnet reveal, whose input is P2SH, and
 * checking the on-chain signature against it; the redeemScript variant is
 * computed alongside and asserted to fail.
 *
 * The Sapling and Orchard branches are implemented even though StampPad never
 * builds a shielded bundle. They are the only reason the ZIP's own test vectors
 * can be run at all — every one of the ten is shielded — and they let the txid
 * of any mainnet v5 transaction be checked, not just of the two we know.
 */
import { blake2b256 } from "./blake2b";
import { concatBytes } from "./script";
import {
  compactSize,
  encodeHeader,
  encodeOutPoint,
  encodeOutput,
  i64le,
  u32le,
  u8,
  varBytes,
  type OrchardBundle,
  type OutPoint,
  type SaplingBundle,
  type TransactionV5,
  type TxOutput,
} from "./transaction";

export const SIGHASH_ALL = 0x01;
export const SIGHASH_NONE = 0x02;
export const SIGHASH_SINGLE = 0x03;
export const SIGHASH_ANYONECANPAY = 0x80;

const PERSONAL_TX_HASH_PREFIX = "ZcashTxHash_";
const PERSONAL_AUTH_PREFIX = "ZTxAuthHash_";
const PERSONAL_HEADER = "ZTxIdHeadersHash";
const PERSONAL_TRANSPARENT = "ZTxIdTranspaHash";
const PERSONAL_PREVOUTS = "ZTxIdPrevoutHash";
const PERSONAL_SEQUENCE = "ZTxIdSequencHash";
const PERSONAL_OUTPUTS = "ZTxIdOutputsHash";
const PERSONAL_AMOUNTS = "ZTxTrAmountsHash";
const PERSONAL_SCRIPTS = "ZTxTrScriptsHash";
const PERSONAL_TXIN = "Zcash___TxInHash";
const PERSONAL_SAPLING = "ZTxIdSaplingHash";
const PERSONAL_SAPLING_SPENDS = "ZTxIdSSpendsHash";
const PERSONAL_SAPLING_SPENDS_COMPACT = "ZTxIdSSpendCHash";
const PERSONAL_SAPLING_SPENDS_NONCOMPACT = "ZTxIdSSpendNHash";
const PERSONAL_SAPLING_OUTPUTS = "ZTxIdSOutputHash";
const PERSONAL_SAPLING_OUTPUTS_COMPACT = "ZTxIdSOutC__Hash";
const PERSONAL_SAPLING_OUTPUTS_MEMOS = "ZTxIdSOutM__Hash";
const PERSONAL_SAPLING_OUTPUTS_NONCOMPACT = "ZTxIdSOutN__Hash";
const PERSONAL_ORCHARD = "ZTxIdOrchardHash";
const PERSONAL_ORCHARD_COMPACT = "ZTxIdOrcActCHash";
const PERSONAL_ORCHARD_MEMOS = "ZTxIdOrcActMHash";
const PERSONAL_ORCHARD_NONCOMPACT = "ZTxIdOrcActNHash";
const PERSONAL_AUTH_TRANSPARENT = "ZTxAuthTransHash";
const PERSONAL_AUTH_SAPLING = "ZTxAuthSapliHash";
const PERSONAL_AUTH_ORCHARD = "ZTxAuthOrchaHash";

const EMPTY = new Uint8Array(0);

function personalWithBranch(prefix: string, consensusBranchId: number): Uint8Array {
  return concatBytes([new TextEncoder().encode(prefix), u32le(consensusBranchId)]);
}

/** `"ZcashTxHash_" || consensus_branch_id`, the root of the txid and sighash trees. */
function rootPersonal(consensusBranchId: number): Uint8Array {
  return personalWithBranch(PERSONAL_TX_HASH_PREFIX, consensusBranchId);
}

/** T.1 / S.1. */
export function headerDigest(tx: TransactionV5): Uint8Array {
  return blake2b256(PERSONAL_HEADER, encodeHeader(tx));
}

/** T.2a, also S.2b when ANYONECANPAY is clear. */
function prevoutsDigest(prevouts: readonly OutPoint[]): Uint8Array {
  return blake2b256(PERSONAL_PREVOUTS, concatBytes(prevouts.map(encodeOutPoint)));
}

/** T.2b, also S.2e when ANYONECANPAY is clear. */
function sequenceDigest(sequences: readonly number[]): Uint8Array {
  return blake2b256(PERSONAL_SEQUENCE, concatBytes(sequences.map(u32le)));
}

/** T.2c, also S.2f for SIGHASH_ALL. */
function outputsDigest(outputs: readonly TxOutput[]): Uint8Array {
  return blake2b256(PERSONAL_OUTPUTS, concatBytes(outputs.map(encodeOutput)));
}

/** T.2. Empty when the transaction has neither transparent inputs nor outputs. */
export function transparentDigest(tx: TransactionV5): Uint8Array {
  if (tx.inputs.length === 0 && tx.outputs.length === 0) {
    return blake2b256(PERSONAL_TRANSPARENT, EMPTY);
  }
  return blake2b256(
    PERSONAL_TRANSPARENT,
    concatBytes([
      prevoutsDigest(tx.inputs.map((i) => i.prevout)),
      sequenceDigest(tx.inputs.map((i) => i.sequence)),
      outputsDigest(tx.outputs),
    ]),
  );
}

/**
 * T.3. Note the field order inside T.3a.ii: cv, then the bundle's shared
 * anchor, then rk. The anchor sits in the middle, repeated per spend.
 */
export function saplingDigest(bundle: SaplingBundle | null | undefined): Uint8Array {
  if (!bundle || (bundle.spends.length === 0 && bundle.outputs.length === 0)) {
    return blake2b256(PERSONAL_SAPLING, EMPTY);
  }

  const spendsDigest =
    bundle.spends.length === 0
      ? blake2b256(PERSONAL_SAPLING_SPENDS, EMPTY)
      : blake2b256(
          PERSONAL_SAPLING_SPENDS,
          concatBytes([
            blake2b256(
              PERSONAL_SAPLING_SPENDS_COMPACT,
              concatBytes(bundle.spends.map((s) => s.nullifier)),
            ),
            blake2b256(
              PERSONAL_SAPLING_SPENDS_NONCOMPACT,
              concatBytes(bundle.spends.flatMap((s) => [s.cv, bundle.anchor!, s.rk])),
            ),
          ]),
        );

  const outputsDigestSapling =
    bundle.outputs.length === 0
      ? blake2b256(PERSONAL_SAPLING_OUTPUTS, EMPTY)
      : blake2b256(
          PERSONAL_SAPLING_OUTPUTS,
          concatBytes([
            blake2b256(
              PERSONAL_SAPLING_OUTPUTS_COMPACT,
              concatBytes(
                bundle.outputs.flatMap((o) => [o.cmu, o.ephemeralKey, o.encCiphertext.subarray(0, 52)]),
              ),
            ),
            blake2b256(
              PERSONAL_SAPLING_OUTPUTS_MEMOS,
              concatBytes(bundle.outputs.map((o) => o.encCiphertext.subarray(52, 564))),
            ),
            blake2b256(
              PERSONAL_SAPLING_OUTPUTS_NONCOMPACT,
              concatBytes(
                bundle.outputs.flatMap((o) => [o.cv, o.encCiphertext.subarray(564), o.outCiphertext]),
              ),
            ),
          ]),
        );

  return blake2b256(
    PERSONAL_SAPLING,
    concatBytes([spendsDigest, outputsDigestSapling, i64le(bundle.valueBalance)]),
  );
}

/** T.4. */
export function orchardDigest(bundle: OrchardBundle | null | undefined): Uint8Array {
  if (!bundle || bundle.actions.length === 0) return blake2b256(PERSONAL_ORCHARD, EMPTY);
  const actions = bundle.actions;
  return blake2b256(
    PERSONAL_ORCHARD,
    concatBytes([
      blake2b256(
        PERSONAL_ORCHARD_COMPACT,
        concatBytes(
          actions.flatMap((a) => [a.nullifier, a.cmx, a.ephemeralKey, a.encCiphertext.subarray(0, 52)]),
        ),
      ),
      blake2b256(
        PERSONAL_ORCHARD_MEMOS,
        concatBytes(actions.map((a) => a.encCiphertext.subarray(52, 564))),
      ),
      blake2b256(
        PERSONAL_ORCHARD_NONCOMPACT,
        concatBytes(
          actions.flatMap((a) => [a.cv, a.rk, a.encCiphertext.subarray(564), a.outCiphertext]),
        ),
      ),
      u8(bundle.flags),
      i64le(bundle.valueBalance),
      bundle.anchor,
    ]),
  );
}

/** T.3 for a transaction with no Sapling bundle. A protocol constant. */
export function emptySaplingDigest(): Uint8Array {
  return blake2b256(PERSONAL_SAPLING, EMPTY);
}

/** T.4 for a transaction with no Orchard bundle. */
export function emptyOrchardDigest(): Uint8Array {
  return blake2b256(PERSONAL_ORCHARD, EMPTY);
}

/**
 * The transaction id, in internal byte order. Reverse it for display.
 *
 * Note that this does not depend on any scriptSig, which is the point of
 * ZIP-244: the txid is fixed before the transaction is signed, so a commit
 * output can be spent by a reveal that was built before the commit was signed.
 */
export function txidDigest(tx: TransactionV5): Uint8Array {
  return blake2b256(
    rootPersonal(tx.consensusBranchId),
    concatBytes([
      headerDigest(tx),
      transparentDigest(tx),
      saplingDigest(tx.sapling),
      orchardDigest(tx.orchard),
    ]),
  );
}

/**
 * The authorizing data commitment, ZIP-244 section "Authorizing Data
 * Commitment". Unlike the txid this does depend on the scriptSigs, so it only
 * exists once a transaction is fully signed. Blocks commit to it through
 * hashAuthDataRoot, which makes it the value to compare against an explorer's
 * `authdigest` to confirm the bytes we built are the bytes that got mined.
 */
export function authDigest(tx: TransactionV5): Uint8Array {
  const transparentScripts =
    tx.inputs.length === 0
      ? blake2b256(PERSONAL_AUTH_TRANSPARENT, EMPTY)
      : blake2b256(
          PERSONAL_AUTH_TRANSPARENT,
          concatBytes(tx.inputs.map((input) => varBytes(input.scriptSig))),
        );

  const sapling = tx.sapling;
  const saplingAuth =
    !sapling || (sapling.spends.length === 0 && sapling.outputs.length === 0)
      ? blake2b256(PERSONAL_AUTH_SAPLING, EMPTY)
      : blake2b256(
          PERSONAL_AUTH_SAPLING,
          concatBytes([
            ...sapling.spendProofs,
            ...sapling.spendAuthSigs,
            ...sapling.outputProofs,
            sapling.bindingSig!,
          ]),
        );

  const orchard = tx.orchard;
  const orchardAuth =
    !orchard || orchard.actions.length === 0
      ? blake2b256(PERSONAL_AUTH_ORCHARD, EMPTY)
      : blake2b256(
          PERSONAL_AUTH_ORCHARD,
          concatBytes([orchard.proofs, ...orchard.spendAuthSigs, orchard.bindingSig]),
        );

  return blake2b256(
    personalWithBranch(PERSONAL_AUTH_PREFIX, tx.consensusBranchId),
    concatBytes([transparentScripts, saplingAuth, orchardAuth]),
  );
}

/** What the coin being spent looked like on chain. Both fields are needed. */
export interface SpentOutput {
  /** Zatoshi held by the coin. */
  value: bigint;
  /**
   * The coin's scriptPubKey, not the redeem script. For a P2SH coin this is
   * `OP_HASH160 <20 bytes> OP_EQUAL`; see the note at the top of this file.
   */
  scriptPubKey: Uint8Array;
}

/** S.2g. */
function txinSigDigest(input: {
  prevout: OutPoint;
  sequence: number;
  spent: SpentOutput;
}): Uint8Array {
  return blake2b256(
    PERSONAL_TXIN,
    concatBytes([
      encodeOutPoint(input.prevout),
      i64le(input.spent.value),
      varBytes(input.spent.scriptPubKey),
      u32le(input.sequence),
    ]),
  );
}

/** S.2c. */
function amountsSigDigest(spent: readonly SpentOutput[]): Uint8Array {
  return blake2b256(PERSONAL_AMOUNTS, concatBytes(spent.map((s) => i64le(s.value))));
}

/** S.2d. */
function scriptPubKeysSigDigest(spent: readonly SpentOutput[]): Uint8Array {
  return blake2b256(PERSONAL_SCRIPTS, concatBytes(spent.map((s) => varBytes(s.scriptPubKey))));
}

/** S.2f. SINGLE commits to the one output at the input's own index, if it exists. */
function outputsSigDigest(tx: TransactionV5, base: number, index: number): Uint8Array {
  if (base === SIGHASH_ALL) return outputsDigest(tx.outputs);
  if (base === SIGHASH_SINGLE && index < tx.outputs.length) {
    return blake2b256(PERSONAL_OUTPUTS, encodeOutput(tx.outputs[index]!));
  }
  return blake2b256(PERSONAL_OUTPUTS, EMPTY);
}

export interface SignatureDigestInput {
  tx: TransactionV5;
  /** The coins the inputs spend, in input order. */
  spent: readonly SpentOutput[];
  /** Which input is being signed. */
  index: number;
  /** SIGHASH_ALL unless a caller has a reason; nothing here produces another. */
  hashType?: number;
  /**
   * Overrides the scriptPubKey committed to in S.2g for this one input. Present
   * only so the tests can compute the wrong, ZIP-243-style digest and show it
   * does not verify. Production never sets it.
   */
  txinScriptOverride?: Uint8Array;
}

/**
 * S.2: the transparent half of the signature digest.
 *
 * SIGHASH_NONE and SIGHASH_SINGLE are computed here because the ZIP's test
 * vectors cover them and refusing them would leave S.2f untested. Nothing in
 * the stamp pipeline asks for either; the guard that keeps it that way lives in
 * `signatureDigest` below, which is the only entry point production uses.
 */
export function transparentSignatureDigest(input: SignatureDigestInput): Uint8Array {
  const { tx, spent, index } = input;
  const hashType = input.hashType ?? SIGHASH_ALL;
  if (spent.length !== tx.inputs.length) {
    throw new Error("every input needs the coin it spends to compute a ZIP-244 signature digest");
  }
  if (index < 0 || index >= tx.inputs.length) throw new Error("input index out of range");
  const base = hashType & 0x1f;
  if (base !== SIGHASH_ALL && base !== SIGHASH_NONE && base !== SIGHASH_SINGLE) {
    throw new Error(`undefined sighash type 0x${hashType.toString(16)}`);
  }
  const anyoneCanPay = (hashType & SIGHASH_ANYONECANPAY) !== 0;

  return blake2b256(
    PERSONAL_TRANSPARENT,
    concatBytes([
      u8(hashType),
      anyoneCanPay
        ? blake2b256(PERSONAL_PREVOUTS, EMPTY)
        : prevoutsDigest(tx.inputs.map((i) => i.prevout)),
      anyoneCanPay ? blake2b256(PERSONAL_AMOUNTS, EMPTY) : amountsSigDigest(spent),
      anyoneCanPay ? blake2b256(PERSONAL_SCRIPTS, EMPTY) : scriptPubKeysSigDigest(spent),
      anyoneCanPay
        ? blake2b256(PERSONAL_SEQUENCE, EMPTY)
        : sequenceDigest(tx.inputs.map((i) => i.sequence)),
      outputsSigDigest(tx, base, index),
      txinSigDigest({
        prevout: tx.inputs[index]!.prevout,
        sequence: tx.inputs[index]!.sequence,
        spent: input.txinScriptOverride
          ? { value: spent[index]!.value, scriptPubKey: input.txinScriptOverride }
          : spent[index]!,
      }),
    ]),
  );
}

/**
 * The root of the signature digest tree, and the bytes a transparent input's
 * ECDSA signature is made over.
 */
export function signatureDigest(input: SignatureDigestInput): Uint8Array {
  const base = (input.hashType ?? SIGHASH_ALL) & 0x1f;
  if (base !== SIGHASH_ALL) {
    // NONE and SINGLE let someone else rewrite the outputs of a transaction we
    // are paying for. Nothing in the stamp pipeline wants that.
    throw new Error("only SIGHASH_ALL is supported; a stamp must commit to all of its outputs");
  }
  return combineDigest(input.tx, transparentSignatureDigest(input));
}

/**
 * The root hash shared by the txid and signature trees, given whichever
 * transparent digest belongs at S.2 or T.2. Exported so the ZIP's vectors,
 * which all exercise sighash types production refuses, can still be run.
 */
export function combineDigest(tx: TransactionV5, transparent: Uint8Array): Uint8Array {
  return blake2b256(
    rootPersonal(tx.consensusBranchId),
    concatBytes([
      headerDigest(tx),
      transparent,
      saplingDigest(tx.sapling),
      orchardDigest(tx.orchard),
    ]),
  );
}

/**
 * The empty-bundle digests, exported so tests can pin them. They are constants
 * of the protocol, so a change in either means BLAKE2b personalization broke.
 */
export const EMPTY_DIGESTS = {
  transparent: () => blake2b256(PERSONAL_TRANSPARENT, EMPTY),
  sapling: emptySaplingDigest,
  orchard: emptyOrchardDigest,
};

export { compactSize };
