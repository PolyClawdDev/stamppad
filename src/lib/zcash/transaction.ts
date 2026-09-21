/**
 * Zcash v5 transaction structure and serialization, per ZIP-225.
 *
 * Only the transparent bundle is constructible here: a stamp has no shielded
 * component, and building one we cannot verify would be worse than not building
 * it. Shielded bundles are nonetheless parsed in full and re-serialized
 * exactly, because that is what makes the rest of this directory checkable. The
 * ZIP-244 test vectors are all shielded, and so is most of mainnet; a parser
 * that gave up at the first Orchard action would leave the digest tree in
 * zip244.ts with nothing to be tested against except our own two transactions.
 *
 * The v5 format differs from v4 in ways that matter for every byte:
 *   - nConsensusBranchId moved into the header, so a transaction is bound to
 *     one epoch at the serialization level rather than only at signing time.
 *   - The txid is no longer SHA-256d of the serialization. It is the ZIP-244
 *     digest tree in zip244.ts, which means the txid is stable while the
 *     scriptSigs are still being filled in.
 *   - Sapling's valueBalance and anchor are only present when the corresponding
 *     bundles are non-empty, so an all-zeros tail is three bytes, not more.
 *
 * Correctness here is asserted in tests/zcash-transaction.test.ts by parsing
 * the reference mainnet commit and reveal and re-serializing them to identical
 * bytes, and by doing the same for all ten ZIP-244 vectors.
 */
import { concatBytes } from "./script";

export const TX_VERSION_V5 = 5;
export const OVERWINTERED_FLAG = 0x8000_0000;
export const VERSION_GROUP_ID_V5 = 0x26a7_270a;

/** Signalled by every input we build: no relative locktime, no RBF semantics. */
export const SEQUENCE_FINAL = 0xffff_ffff;

export interface OutPoint {
  /** Transaction id in display order, as an explorer or RPC shows it. */
  txid: string;
  index: number;
}

export interface TxInput {
  prevout: OutPoint;
  scriptSig: Uint8Array;
  sequence: number;
}

export interface TxOutput {
  /** Zatoshi. */
  value: bigint;
  scriptPubKey: Uint8Array;
}

/* ---------- shielded bundles ---------- */

/** SpendDescriptionV5: 96 bytes. The anchor is shared and lives on the bundle. */
export interface SaplingSpend {
  cv: Uint8Array;
  nullifier: Uint8Array;
  rk: Uint8Array;
}

/** OutputDescriptionV5: 756 bytes. */
export interface SaplingOutput {
  cv: Uint8Array;
  cmu: Uint8Array;
  ephemeralKey: Uint8Array;
  encCiphertext: Uint8Array;
  outCiphertext: Uint8Array;
}

/**
 * The Sapling bundle, split the way ZIP-225 serializes it: the descriptions
 * first, then the proofs and signatures that authorize them. ZIP-244 hashes the
 * two halves into different trees, so they are kept apart here rather than
 * reassembled per spend.
 */
export interface SaplingBundle {
  spends: SaplingSpend[];
  outputs: SaplingOutput[];
  valueBalance: bigint;
  /** Shared across all spends in v5. Absent when there are no spends. */
  anchor: Uint8Array | null;
  spendProofs: Uint8Array[];
  spendAuthSigs: Uint8Array[];
  outputProofs: Uint8Array[];
  bindingSig: Uint8Array | null;
}

/** An Orchard action: 820 bytes. */
export interface OrchardAction {
  cv: Uint8Array;
  nullifier: Uint8Array;
  rk: Uint8Array;
  cmx: Uint8Array;
  ephemeralKey: Uint8Array;
  encCiphertext: Uint8Array;
  outCiphertext: Uint8Array;
}

export interface OrchardBundle {
  actions: OrchardAction[];
  flags: number;
  valueBalance: bigint;
  anchor: Uint8Array;
  /** A single aggregated Halo 2 proof, length-prefixed on the wire. */
  proofs: Uint8Array;
  spendAuthSigs: Uint8Array[];
  bindingSig: Uint8Array;
}

export interface TransactionV5 {
  version: number;
  versionGroupId: number;
  consensusBranchId: number;
  lockTime: number;
  expiryHeight: number;
  inputs: TxInput[];
  outputs: TxOutput[];
  /** Null for everything StampPad builds. */
  sapling?: SaplingBundle | null;
  orchard?: OrchardBundle | null;
}

export const SAPLING_SPEND_PROOF_BYTES = 192;
export const SAPLING_OUTPUT_PROOF_BYTES = 192;
const REDJUBJUB_SIG_BYTES = 64;
const ENC_CIPHERTEXT_BYTES = 580;
const OUT_CIPHERTEXT_BYTES = 80;

/* ---------- byte-level helpers ---------- */

export function u8(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff);
}

export function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

export function i64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, value, true);
  return out;
}

/** Bitcoin's CompactSize, which Zcash inherited unchanged. */
export function compactSize(value: number): Uint8Array {
  if (value < 0) throw new Error("compact size must be non-negative");
  if (value < 0xfd) return Uint8Array.of(value);
  if (value <= 0xffff) return concatBytes([Uint8Array.of(0xfd), u32le(value).subarray(0, 2)]);
  if (value <= 0xffff_ffff) return concatBytes([Uint8Array.of(0xfe), u32le(value)]);
  const out = new Uint8Array(9);
  out[0] = 0xff;
  new DataView(out.buffer).setBigUint64(1, BigInt(value), true);
  return out;
}

/** A byte array as a script field: CompactSize length, then the bytes. */
export function varBytes(bytes: Uint8Array): Uint8Array {
  return concatBytes([compactSize(bytes.length), bytes]);
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error(`invalid hex: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function reverse(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes).reverse();
}

/**
 * Transaction ids are shown big-endian and serialized little-endian. Every
 * reversal in this file goes through these two so the direction is named.
 */
export function txidToInternal(txid: string): Uint8Array {
  const bytes = hexToBytes(txid);
  if (bytes.length !== 32) throw new Error("a transaction id is 32 bytes");
  return reverse(bytes);
}

export function internalToTxid(internal: Uint8Array): string {
  if (internal.length !== 32) throw new Error("a transaction id is 32 bytes");
  return bytesToHex(reverse(internal));
}

/* ---------- field encodings, shared with the ZIP-244 digests ---------- */

export function encodeOutPoint(prevout: OutPoint): Uint8Array {
  return concatBytes([txidToInternal(prevout.txid), u32le(prevout.index)]);
}

export function encodeOutput(output: TxOutput): Uint8Array {
  return concatBytes([i64le(output.value), varBytes(output.scriptPubKey)]);
}

export function encodeHeader(tx: TransactionV5): Uint8Array {
  return concatBytes([
    u32le(tx.version | OVERWINTERED_FLAG),
    u32le(tx.versionGroupId),
    u32le(tx.consensusBranchId),
    u32le(tx.lockTime),
    u32le(tx.expiryHeight),
  ]);
}

/* ---------- serialization ---------- */

function encodeSapling(bundle: SaplingBundle | null | undefined): Uint8Array[] {
  if (!bundle || (bundle.spends.length === 0 && bundle.outputs.length === 0)) {
    return [compactSize(0), compactSize(0)];
  }
  const parts: Uint8Array[] = [compactSize(bundle.spends.length)];
  for (const spend of bundle.spends) parts.push(spend.cv, spend.nullifier, spend.rk);
  parts.push(compactSize(bundle.outputs.length));
  for (const output of bundle.outputs) {
    parts.push(
      output.cv,
      output.cmu,
      output.ephemeralKey,
      output.encCiphertext,
      output.outCiphertext,
    );
  }
  parts.push(i64le(bundle.valueBalance));
  if (bundle.spends.length > 0) {
    if (!bundle.anchor) throw new Error("a Sapling bundle with spends needs its anchor");
    parts.push(bundle.anchor);
  }
  parts.push(...bundle.spendProofs, ...bundle.spendAuthSigs, ...bundle.outputProofs);
  if (!bundle.bindingSig) throw new Error("a non-empty Sapling bundle needs its binding signature");
  parts.push(bundle.bindingSig);
  return parts;
}

function encodeOrchard(bundle: OrchardBundle | null | undefined): Uint8Array[] {
  if (!bundle || bundle.actions.length === 0) return [compactSize(0)];
  const parts: Uint8Array[] = [compactSize(bundle.actions.length)];
  for (const action of bundle.actions) {
    parts.push(
      action.cv,
      action.nullifier,
      action.rk,
      action.cmx,
      action.ephemeralKey,
      action.encCiphertext,
      action.outCiphertext,
    );
  }
  parts.push(
    u8(bundle.flags),
    i64le(bundle.valueBalance),
    bundle.anchor,
    varBytes(bundle.proofs),
    ...bundle.spendAuthSigs,
    bundle.bindingSig,
  );
  return parts;
}

export function serializeTransaction(tx: TransactionV5): Uint8Array {
  if (tx.version !== TX_VERSION_V5) throw new Error("only v5 transactions are built here");
  if (tx.versionGroupId !== VERSION_GROUP_ID_V5) throw new Error("wrong version group id for v5");

  const parts: Uint8Array[] = [encodeHeader(tx), compactSize(tx.inputs.length)];
  for (const input of tx.inputs) {
    parts.push(encodeOutPoint(input.prevout), varBytes(input.scriptSig), u32le(input.sequence));
  }
  parts.push(compactSize(tx.outputs.length));
  for (const output of tx.outputs) parts.push(encodeOutput(output));
  parts.push(...encodeSapling(tx.sapling), ...encodeOrchard(tx.orchard));
  return concatBytes(parts);
}

export function serializeTransactionHex(tx: TransactionV5): string {
  return bytesToHex(serializeTransaction(tx));
}

/* ---------- parsing ---------- */

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  get consumed(): number {
    return this.offset;
  }
  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length) {
      throw new Error("transaction ended mid-field");
    }
    // Copied, not a view: callers keep these past the life of the input buffer,
    // and a DataView over a subarray of a subarray is a trap.
    const out = Uint8Array.from(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return out;
  }

  u8(): number {
    return this.take(1)[0]!;
  }

  u32(): number {
    const b = this.take(4);
    return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
  }

  i64(): bigint {
    const b = this.take(8);
    return new DataView(b.buffer, b.byteOffset, 8).getBigInt64(0, true);
  }

  compactSize(): number {
    const first = this.u8();
    if (first < 0xfd) return first;
    if (first === 0xfd) {
      const b = this.take(2);
      return b[0]! | (b[1]! << 8);
    }
    if (first === 0xfe) return this.u32();
    const b = this.take(8);
    const value = new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("compact size too large");
    return Number(value);
  }

  varBytes(): Uint8Array {
    return this.take(this.compactSize());
  }

  repeat(count: number, length: number): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (let i = 0; i < count; i += 1) out.push(this.take(length));
    return out;
  }
}

export interface ParsedTransaction extends TransactionV5 {
  sapling: SaplingBundle | null;
  orchard: OrchardBundle | null;
  /** True when both shielded bundles are absent. Every stamp is. */
  transparentOnly: boolean;
}

function readSapling(reader: Reader): SaplingBundle | null {
  const spendCount = reader.compactSize();
  const spends: SaplingSpend[] = [];
  for (let i = 0; i < spendCount; i += 1) {
    spends.push({ cv: reader.take(32), nullifier: reader.take(32), rk: reader.take(32) });
  }
  const outputCount = reader.compactSize();
  const outputs: SaplingOutput[] = [];
  for (let i = 0; i < outputCount; i += 1) {
    outputs.push({
      cv: reader.take(32),
      cmu: reader.take(32),
      ephemeralKey: reader.take(32),
      encCiphertext: reader.take(ENC_CIPHERTEXT_BYTES),
      outCiphertext: reader.take(OUT_CIPHERTEXT_BYTES),
    });
  }
  if (spendCount === 0 && outputCount === 0) return null;

  const valueBalance = reader.i64();
  const anchor = spendCount > 0 ? reader.take(32) : null;
  return {
    spends,
    outputs,
    valueBalance,
    anchor,
    spendProofs: reader.repeat(spendCount, SAPLING_SPEND_PROOF_BYTES),
    spendAuthSigs: reader.repeat(spendCount, REDJUBJUB_SIG_BYTES),
    outputProofs: reader.repeat(outputCount, SAPLING_OUTPUT_PROOF_BYTES),
    bindingSig: reader.take(REDJUBJUB_SIG_BYTES),
  };
}

function readOrchard(reader: Reader): OrchardBundle | null {
  const actionCount = reader.compactSize();
  if (actionCount === 0) return null;
  const actions: OrchardAction[] = [];
  for (let i = 0; i < actionCount; i += 1) {
    actions.push({
      cv: reader.take(32),
      nullifier: reader.take(32),
      rk: reader.take(32),
      cmx: reader.take(32),
      ephemeralKey: reader.take(32),
      encCiphertext: reader.take(ENC_CIPHERTEXT_BYTES),
      outCiphertext: reader.take(OUT_CIPHERTEXT_BYTES),
    });
  }
  return {
    actions,
    flags: reader.u8(),
    valueBalance: reader.i64(),
    anchor: reader.take(32),
    proofs: reader.varBytes(),
    spendAuthSigs: reader.repeat(actionCount, REDJUBJUB_SIG_BYTES),
    bindingSig: reader.take(REDJUBJUB_SIG_BYTES),
  };
}

/**
 * Parses a v5 transaction, shielded bundles included. Throws on anything that
 * is not v5: v4 and the v6 format that NU7 introduces both exist on mainnet,
 * and guessing at either would be worse than refusing.
 */
export function parseTransaction(raw: Uint8Array): ParsedTransaction {
  const reader = new Reader(raw);
  const header = reader.u32();
  if ((header & OVERWINTERED_FLAG) === 0) throw new Error("not an Overwinter-or-later transaction");
  const version = header & 0x7fff_ffff;
  if (version !== TX_VERSION_V5) throw new Error(`unsupported transaction version ${version}`);
  const versionGroupId = reader.u32();
  if (versionGroupId !== VERSION_GROUP_ID_V5) {
    throw new Error(`unexpected version group id ${versionGroupId.toString(16)}`);
  }
  const consensusBranchId = reader.u32();
  const lockTime = reader.u32();
  const expiryHeight = reader.u32();

  const inputs: TxInput[] = [];
  const inputCount = reader.compactSize();
  for (let i = 0; i < inputCount; i += 1) {
    const hash = reader.take(32);
    const index = reader.u32();
    const scriptSig = reader.varBytes();
    const sequence = reader.u32();
    inputs.push({ prevout: { txid: internalToTxid(hash), index }, scriptSig, sequence });
  }

  const outputs: TxOutput[] = [];
  const outputCount = reader.compactSize();
  for (let i = 0; i < outputCount; i += 1) {
    const value = reader.i64();
    outputs.push({ value, scriptPubKey: reader.varBytes() });
  }

  const sapling = readSapling(reader);
  const orchard = readOrchard(reader);
  if (reader.remaining !== 0) {
    throw new Error(`${reader.remaining} trailing bytes after a complete v5 transaction`);
  }

  return {
    version,
    versionGroupId,
    consensusBranchId,
    lockTime,
    expiryHeight,
    inputs,
    outputs,
    sapling,
    orchard,
    transparentOnly: sapling === null && orchard === null,
  };
}

export function parseTransactionHex(hex: string): ParsedTransaction {
  return parseTransaction(hexToBytes(hex));
}

/** Total zatoshi paid out. Inputs cannot be summed without their prevouts. */
export function totalOutputValue(tx: Pick<TransactionV5, "outputs">): bigint {
  return tx.outputs.reduce((sum, output) => sum + output.value, 0n);
}
