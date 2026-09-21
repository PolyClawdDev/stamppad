/**
 * Transparent Zcash scripts: the handful of forms a stamp actually uses.
 *
 * Zcash's transparent layer is Bitcoin's script system with Zcash version
 * bytes, so P2PKH and P2SH are byte-identical to Bitcoin's. What is specific to
 * us is the inscription redeem script, whose shape was read off the reference
 * stamp rather than designed: `<pubkey> OP_CHECKSIGVERIFY <32 bytes> OP_DROP x8
 * OP_1`. Only the signature is enforced. The drops clear the envelope pushes the
 * reveal puts on the stack, and OP_1 leaves a true value so the script succeeds.
 *
 * The 32-byte commitment and the eight drops are reproduced exactly, because
 * the indexer in src/lib/inscriptions.ts recognises stamps by that shape.
 */
import { hash160 } from "../protocol/hash160";
import { sha256, toHex, validateTransparentAddress } from "../protocol/taddr";
import { decodeBase58, encodeBase58 } from "../protocol/encoding";
import type { ZcashNetwork } from "./consensus";

export const OP_0 = 0x00;
export const OP_1 = 0x51;
export const OP_DROP = 0x75;
export const OP_DUP = 0x76;
export const OP_EQUAL = 0x87;
export const OP_EQUALVERIFY = 0x88;
export const OP_HASH160 = 0xa9;
export const OP_CHECKSIG = 0xac;
export const OP_CHECKSIGVERIFY = 0xad;
export const OP_RETURN = 0x6a;

/** Base58 version bytes. Zcash uses two, unlike Bitcoin's one. */
const VERSION_BYTES: Record<ZcashNetwork, { p2pkh: [number, number]; p2sh: [number, number] }> = {
  "zcash:main": { p2pkh: [0x1c, 0xb8], p2sh: [0x1c, 0xbd] },
  "zcash:test": { p2pkh: [0x1d, 0x25], p2sh: [0x1c, 0xba] },
};

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Minimal push of `bytes`, the same encoding the reference reveal uses. */
export function pushData(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 0x4c) return concatBytes([Uint8Array.of(bytes.length), bytes]);
  if (bytes.length <= 0xff) return concatBytes([Uint8Array.of(0x4c, bytes.length), bytes]);
  if (bytes.length <= 0xffff) {
    return concatBytes([Uint8Array.of(0x4d, bytes.length & 0xff, bytes.length >> 8), bytes]);
  }
  throw new Error("script push exceeds two-byte length");
}

/** Consensus limit on a single push. Nothing we build may exceed it. */
export const MAX_SCRIPT_ELEMENT_SIZE = 520;

export function p2pkhScript(keyHash: Uint8Array): Uint8Array {
  if (keyHash.length !== 20) throw new Error("key hash must be 20 bytes");
  return concatBytes([
    Uint8Array.of(OP_DUP, OP_HASH160),
    pushData(keyHash),
    Uint8Array.of(OP_EQUALVERIFY, OP_CHECKSIG),
  ]);
}

export function p2shScript(scriptHash: Uint8Array): Uint8Array {
  if (scriptHash.length !== 20) throw new Error("script hash must be 20 bytes");
  return concatBytes([Uint8Array.of(OP_HASH160), pushData(scriptHash), Uint8Array.of(OP_EQUAL)]);
}

function base58Check(version: [number, number], payload: Uint8Array): string {
  const body = concatBytes([Uint8Array.from(version), payload]);
  return encodeBase58(concatBytes([body, sha256(sha256(body)).subarray(0, 4)]));
}

export function p2shAddress(scriptHash: Uint8Array, network: ZcashNetwork): string {
  if (scriptHash.length !== 20) throw new Error("script hash must be 20 bytes");
  return base58Check(VERSION_BYTES[network].p2sh, scriptHash);
}

export function p2pkhAddress(keyHash: Uint8Array, network: ZcashNetwork): string {
  if (keyHash.length !== 20) throw new Error("key hash must be 20 bytes");
  return base58Check(VERSION_BYTES[network].p2pkh, keyHash);
}

export function addressForRedeemScript(redeemScript: Uint8Array, network: ZcashNetwork): string {
  return p2shAddress(hash160(redeemScript), network);
}

export interface DecodedAddress {
  kind: "p2pkh" | "p2sh";
  network: ZcashNetwork;
  hash: Uint8Array;
}

/**
 * Turns an address into the hash it commits to. Delegates the character-level
 * checks to the shared validator so a bad address fails the same way in the UI
 * and here, then re-derives the bytes rather than trusting the string.
 */
export function decodeAddress(address: string): DecodedAddress {
  const check = validateTransparentAddress(address);
  if (!check.ok) throw new Error(check.message);
  if (check.kind === "tex") {
    throw new Error("TEX addresses carry no script form; convert to the underlying t-address first.");
  }
  const raw = decodeBase58(address);
  return {
    kind: check.kind === "p2sh" ? "p2sh" : "p2pkh",
    network: check.network === "zcash:test" ? "zcash:test" : "zcash:main",
    hash: raw.subarray(2, 22),
  };
}

/** The scriptPubKey that pays `address`. */
export function scriptForAddress(address: string): Uint8Array {
  const decoded = decodeAddress(address);
  return decoded.kind === "p2sh" ? p2shScript(decoded.hash) : p2pkhScript(decoded.hash);
}

/** The address a scriptPubKey pays, or null for a form we do not recognise. */
export function addressForScript(script: Uint8Array, network: ZcashNetwork): string | null {
  if (
    script.length === 25 &&
    script[0] === OP_DUP &&
    script[1] === OP_HASH160 &&
    script[2] === 0x14 &&
    script[23] === OP_EQUALVERIFY &&
    script[24] === OP_CHECKSIG
  ) {
    return p2pkhAddress(script.subarray(3, 23), network);
  }
  if (script.length === 23 && script[0] === OP_HASH160 && script[1] === 0x14 && script[22] === OP_EQUAL) {
    return p2shAddress(script.subarray(2, 22), network);
  }
  return null;
}

/** Number of OP_DROPs in the reference redeem script. Matched exactly, not derived. */
export const INSCRIPTION_DROPS = 8;

/**
 * The redeem script the commit address hashes to.
 *
 * `commitment` is the stamp's 32-byte protocol commitment, the same value the
 * job carries. It is pushed and dropped: consensus has no opinion on it, but it
 * ties the funding output to one specific stamp, so a commit output cannot be
 * quietly reused to reveal a different payload.
 */
export function inscriptionRedeemScript(input: {
  publicKey: Uint8Array;
  commitment: Uint8Array;
}): Uint8Array {
  if (input.publicKey.length !== 33) {
    throw new Error("the reveal key must be a 33-byte compressed public key");
  }
  if (input.commitment.length !== 32) throw new Error("commitment must be 32 bytes");
  return concatBytes([
    pushData(input.publicKey),
    Uint8Array.of(OP_CHECKSIGVERIFY),
    pushData(input.commitment),
    new Uint8Array(INSCRIPTION_DROPS).fill(OP_DROP),
    Uint8Array.of(OP_1),
  ]);
}

/**
 * The reveal scriptSig: the envelope, then the signature, then the redeem
 * script. Script runs left to right, so the envelope pushes sit deepest on the
 * stack and the OP_DROPs in the redeem script clear them after the signature
 * check consumes the top two items.
 */
export function inscriptionScriptSig(input: {
  envelope: Uint8Array;
  signature: Uint8Array;
  redeemScript: Uint8Array;
}): Uint8Array {
  if (input.redeemScript.length > MAX_SCRIPT_ELEMENT_SIZE) {
    throw new Error(
      `redeem script is ${input.redeemScript.length} bytes; a P2SH redeem script must push in one element of at most ${MAX_SCRIPT_ELEMENT_SIZE}`,
    );
  }
  return concatBytes([input.envelope, pushData(input.signature), pushData(input.redeemScript)]);
}

export { toHex };
