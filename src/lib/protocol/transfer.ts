/**
 * stamp-exp/1 ownership records.
 *
 * A stamp is an application record. Spending the transparent output that
 * carries an inscription does NOT move the stamp: ownership only changes when a
 * transfer authorization signed by the current owner is committed on chain and
 * the authorization artifact is published. Both are required.
 */
import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import {
  OFFER_MAGIC,
  OP_RETURN_DATA_LIMIT,
  PROTOCOL_ID,
  RECORD_PAYLOAD_LEN,
  TRANSFER_MAGIC,
} from "./constants";
import { bufferEq, decodeBase58, fromHex, sha256, toHex } from "./encoding";
import { validateTransparentAddress } from "./taddr";
import { verifyTransparentAuthorization } from "./tsig";

export const OWNERSHIP_VERSION = 1 as const;

export type RecordKind = "transfer" | "offer";

export interface TransferAuthorization {
  stampCommitmentHex: string;
  sequence: number;
  fromAddress: string;
  toAddress: string;
  /** sha256 of the settlement offer this transfer pays, or "none" for a gift. */
  offerHashHex: string;
  /** Hex hash-lock preimage revealed by the seller when claiming payment, or "none". */
  preimageHex: string;
  /** Owner public key that must verify the signature, hex. */
  ownerPublicKeyHex: string;
  signatureHex: string;
}

export interface SettlementOffer {
  stampCommitmentHex: string;
  /** The sequence this offer consumes. Must equal current sequence + 1. */
  sequence: number;
  sellerAddress: string;
  /** v1 offers are targeted: the buyer is named before any payment is locked. */
  buyerAddress: string;
  priceZat: string;
  /** sha256 hash lock; the seller reveals the preimage to claim payment. */
  hashLockHex: string;
  expiryHeight: number;
  ownerPublicKeyHex: string;
  signatureHex: string;
}

export interface OnChainRecord {
  kind: RecordKind;
  stampCommitmentHex: string;
  sequence: number;
  /** sha256 over the canonical authorization or offer artifact. */
  artifactHashHex: string;
}

export function transferPreimage(
  auth: Omit<TransferAuthorization, "signatureHex" | "ownerPublicKeyHex">,
): string {
  return [
    PROTOCOL_ID,
    String(OWNERSHIP_VERSION),
    "transfer",
    auth.stampCommitmentHex,
    String(auth.sequence),
    auth.fromAddress,
    auth.toAddress,
    auth.offerHashHex,
    auth.preimageHex,
  ].join("\n");
}

export function offerPreimage(
  offer: Omit<SettlementOffer, "signatureHex" | "ownerPublicKeyHex">,
): string {
  return [
    PROTOCOL_ID,
    String(OWNERSHIP_VERSION),
    "offer",
    offer.stampCommitmentHex,
    String(offer.sequence),
    offer.sellerAddress,
    offer.buyerAddress,
    offer.priceZat,
    offer.hashLockHex,
    String(offer.expiryHeight),
  ].join("\n");
}

/** Artifact hash binds the signed statement, so the on-chain record cannot be re-pointed. */
export function artifactHash(preimage: string, signatureHex: string): Uint8Array {
  return sha256(`${preimage}\n${signatureHex}`);
}

export function transferArtifactHash(auth: TransferAuthorization): Uint8Array {
  return artifactHash(transferPreimage(auth), auth.signatureHex);
}

export function offerArtifactHash(offer: SettlementOffer): Uint8Array {
  return artifactHash(offerPreimage(offer), offer.signatureHex);
}

export function encodeRecord(record: OnChainRecord): Uint8Array {
  const magic = record.kind === "transfer" ? TRANSFER_MAGIC : OFFER_MAGIC;
  const commitment = fromHex(record.stampCommitmentHex);
  const artifact = fromHex(record.artifactHashHex);
  if (commitment.length !== 32 || artifact.length !== 32) {
    throw new Error("record hashes must be 32 bytes");
  }
  if (record.sequence < 0 || record.sequence > 0xffff_ffff) {
    throw new Error("sequence out of range");
  }
  const buf = Buffer.alloc(RECORD_PAYLOAD_LEN);
  magic.copy(buf, 0);
  buf.writeUInt16LE(OWNERSHIP_VERSION, 4);
  Buffer.from(commitment).copy(buf, 6);
  buf.writeUInt32LE(record.sequence, 38);
  Buffer.from(artifact).copy(buf, 42);
  if (buf.length > OP_RETURN_DATA_LIMIT) {
    throw new Error("record exceeds the OP_RETURN data budget");
  }
  return new Uint8Array(buf);
}

export function decodeRecord(data: Uint8Array): OnChainRecord | null {
  if (data.length !== RECORD_PAYLOAD_LEN) return null;
  const magic = data.subarray(0, 4);
  const kind: RecordKind | null = bufferEq(magic, TRANSFER_MAGIC)
    ? "transfer"
    : bufferEq(magic, OFFER_MAGIC)
      ? "offer"
      : null;
  if (!kind) return null;
  const version = data[4]! | (data[5]! << 8);
  if (version !== OWNERSHIP_VERSION) return null;
  return {
    kind,
    stampCommitmentHex: toHex(data.subarray(6, 38)),
    sequence: Buffer.from(data.subarray(38, 42)).readUInt32LE(0),
    artifactHashHex: toHex(data.subarray(42, 74)),
  };
}

/**
 * Demo ownership keys. A `zdemo1…` destination commits to an ed25519 public
 * key, so the demo can verify owner authorization end to end. Mainnet and
 * testnet stamps would bind a secp256k1 key behind the transparent address
 * instead; that path is specified but not enabled.
 */
export function demoAddressForKey(publicKeyHex: string): string {
  const digest = sha256(fromHex(publicKeyHex));
  return `zdemo1${toHex(digest.subarray(0, 20))}`;
}

export function demoAddressMatchesKey(address: string, publicKeyHex: string): boolean {
  try {
    return address === demoAddressForKey(publicKeyHex);
  } catch {
    return false;
  }
}

export function isDemoManagedAddress(address: string): boolean {
  return /^zdemo1[0-9a-f]{40}$/.test(address);
}

export interface SignatureCheck {
  ok: boolean;
  message: string;
}

/**
 * Verifies that `signatureHex` was produced by the key that the claimed owner
 * address commits to.
 *
 * Two bindings exist. A protocol-managed destination commits to an ed25519 key
 * and is signed directly. A transparent Zcash address commits to a secp256k1
 * key, so the owner signs with their own wallet's signmessage and the key is
 * recovered from the compact signature.
 *
 * Every caller routes through here, including the deterministic rebuild, so the
 * live answer and the rebuilt answer are the same answer.
 */
export function verifyOwnerSignature(input: {
  address: string;
  publicKeyHex: string;
  preimage: string;
  signatureHex: string;
}): SignatureCheck {
  if (!isDemoManagedAddress(input.address)) {
    const transparent = validateTransparentAddress(input.address);
    if (transparent.ok && transparent.kind === "p2pkh") {
      return verifyTransparentAuthorization({
        address: input.address,
        preimage: input.preimage,
        signatureHex: input.signatureHex,
      });
    }
    return {
      ok: false,
      message: transparent.ok
        ? "That address commits to a script rather than a single key, so a signature cannot prove control of it."
        : "Ownership operations need a protocol-managed destination or a transparent Zcash address.",
    };
  }
  if (!demoAddressMatchesKey(input.address, input.publicKeyHex)) {
    return { ok: false, message: "Public key does not match the stamp's current owner address." };
  }
  let ok = false;
  try {
    ok = nacl.sign.detached.verify(
      Buffer.from(input.preimage, "utf8"),
      fromHex(input.signatureHex),
      fromHex(input.publicKeyHex),
    );
  } catch {
    ok = false;
  }
  return ok
    ? { ok: true, message: "Owner signature verified." }
    : { ok: false, message: "Owner signature did not verify over the canonical preimage." };
}

export function hashLockFor(preimageHex: string): string {
  return toHex(sha256(fromHex(preimageHex)));
}

export function verifyHashLock(hashLockHex: string, preimageHex: string): boolean {
  if (preimageHex === "none") return false;
  try {
    return hashLockFor(preimageHex) === hashLockHex;
  } catch {
    return false;
  }
}

export function hash160(data: Uint8Array): Uint8Array {
  const sha = createHash("sha256").update(data).digest();
  return createHash("ripemd160").update(sha).digest();
}

export function looksLikeSolanaAddress(text: string): boolean {
  try {
    return decodeBase58(text).length === 32;
  } catch {
    return false;
  }
}
