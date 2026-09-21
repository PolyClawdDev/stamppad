/**
 * BIP39 seed + BIP44 path for a Zcash transparent key.
 *
 * Zcash coin type is 133. Most wallets that still emit a t-address from a
 * recovery phrase use m/44'/133'/0'/0/0. This is only used to accept a
 * phrase an operator already put in ZCASH_PUBLISHER_KEY; it is not a reason
 * to type a seed into chat.
 */
import { createHmac, pbkdf2Sync } from "node:crypto";
import { bytesToBigInt, encodePoint, generator, N, pointMul } from "../protocol/secp256k1";

export const ZCASH_BIP44_ACCOUNT0 = "m/44'/133'/0'/0/0";

interface Node {
  key: bigint;
  chain: Buffer;
}

export function seedFromMnemonic(mnemonic: string, passphrase = ""): Buffer {
  const norm = mnemonic.normalize("NFKD").trim().toLowerCase().split(/\s+/).join(" ");
  return pbkdf2Sync(Buffer.from(norm, "utf8"), Buffer.from(`mnemonic${passphrase}`, "utf8"), 2048, 64, "sha512");
}

export function deriveScalar(seed: Buffer, path: string): bigint {
  let node = master(seed);
  const parts = path.replace(/^m\//, "").split("/");
  for (const part of parts) {
    const hardened = part.endsWith("'") || part.endsWith("h");
    const index = Number(hardened ? part.slice(0, -1) : part);
    if (!Number.isInteger(index) || index < 0) throw new Error(`bad HD path segment ${part}`);
    node = ckd(node, index, hardened);
  }
  return node.key;
}

function master(seed: Buffer): Node {
  const I = createHmac("sha512", "Bitcoin seed").update(seed).digest();
  return { key: bytesToBigInt(I.subarray(0, 32)), chain: I.subarray(32) };
}

function ckd(parent: Node, index: number, hardened: boolean): Node {
  const i = hardened ? index + 0x80000000 : index;
  const data = hardened
    ? Buffer.concat([Buffer.from([0]), ser256(parent.key), ser32(i)])
    : Buffer.concat([Buffer.from(encodePoint(pointMul(parent.key, generator), true)), ser32(i)]);
  const I = createHmac("sha512", parent.chain).update(data).digest();
  const child = (bytesToBigInt(I.subarray(0, 32)) + parent.key) % N;
  if (child === 0n) throw new Error("degenerate HD child");
  return { key: child, chain: I.subarray(32) };
}

function ser256(value: bigint): Buffer {
  const out = Buffer.alloc(32);
  let v = value;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function ser32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value >>> 0);
  return out;
}

export function looksLikeMnemonic(raw: string): boolean {
  const words = raw.trim().toLowerCase().split(/\s+/);
  return words.length === 12 || words.length === 15 || words.length === 18 || words.length === 24;
}
