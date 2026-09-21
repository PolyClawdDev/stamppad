import { readFileSync } from "node:fs";
import bs58 from "bs58";
import { createHash } from "node:crypto";
import { hash160 } from "../protocol/hash160";
import { encodeP2pkhAddress, validateTransparentAddress } from "../protocol/taddr";
import { bytesToBigInt } from "../protocol/secp256k1";
import { deriveScalar, looksLikeMnemonic, seedFromMnemonic, ZCASH_BIP44_ACCOUNT0 } from "./hd";
import { publicKeyFromScalar } from "./sign";

export interface PublisherKey {
  scalar: bigint;
  publicKey: Uint8Array;
  address: string;
}

/**
 * The spending key for the isolated publisher. On Vercel there is no file, so
 * ZCASH_PUBLISHER_KEY holds WIF, 32-byte hex, or a recovery phrase. A key file
 * still wins when both are set.
 */
export function loadPublisherKey(): PublisherKey {
  const fromFile = process.env.ZCASH_PUBLISHER_KEY_FILE?.trim();
  const raw = fromFile
    ? readFileSync(fromFile, "utf8").trim()
    : (process.env.ZCASH_PUBLISHER_KEY ?? "").trim();
  if (!raw) {
    throw new Error(
      "ZCASH_PUBLISHER_KEY (WIF, hex, or recovery phrase) or ZCASH_PUBLISHER_KEY_FILE is required to publish a stamp.",
    );
  }
  const scalar = scalarFromSecret(raw);
  const publicKey = publicKeyFromScalar(scalar);
  const address = encodeP2pkhAddress(hash160(publicKey));
  const expected = process.env.ZCASH_PUBLISHER_TADDR?.trim();
  if (expected && expected !== address) {
    throw new Error(
      `ZCASH_PUBLISHER_TADDR ${expected} does not match the key (derives ${address}).`,
    );
  }
  return { scalar, publicKey, address };
}

export function hasPublisherKey(): boolean {
  return Boolean(process.env.ZCASH_PUBLISHER_KEY_FILE?.trim() || process.env.ZCASH_PUBLISHER_KEY?.trim());
}

export function scalarFromSecret(raw: string): bigint {
  const value = raw.trim();
  if (validateTransparentAddress(value).ok) {
    throw new Error(
      "ZCASH_PUBLISHER_KEY is the t-address. Put the spending key (WIF or 64-character hex), not t1…",
    );
  }
  if (value.startsWith("secret-extended-key-") || value.startsWith("u-sk")) {
    throw new Error(
      "That is a shielded or unified spending key. The publisher needs the transparent WIF for the t1 address.",
    );
  }
  if (looksLikeMnemonic(value)) {
    return scalarFromMnemonic(value);
  }
  const hex = value.replace(/^0x/i, "").replace(/\s+/g, "");
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    const scalar = bytesToBigInt(Buffer.from(hex, "hex"));
    if (scalar === 0n) throw new Error("publisher key is zero");
    return scalar;
  }
  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(value.replace(/\s+/g, ""));
  } catch {
    throw new Error(
      "publisher key must be 32-byte hex, WIF, or a 12/24-word recovery phrase — not the t-address.",
    );
  }
  if (decoded.length !== 37 && decoded.length !== 38) {
    throw new Error("WIF decoded to an unexpected length");
  }
  const payload = decoded.subarray(0, decoded.length - 4);
  const checksum = decoded.subarray(decoded.length - 4);
  const digest = createHash("sha256")
    .update(createHash("sha256").update(payload).digest())
    .digest();
  const expect = digest.subarray(0, 4);
  if (checksum.length !== expect.length || checksum.some((byte, i) => byte !== expect[i])) {
    throw new Error("publisher WIF failed its checksum");
  }
  return bytesToBigInt(payload.subarray(1, 33));
}

function scalarFromMnemonic(mnemonic: string): bigint {
  const seed = seedFromMnemonic(mnemonic);
  const expected = process.env.ZCASH_PUBLISHER_TADDR?.trim();
  const candidates = [ZCASH_BIP44_ACCOUNT0];
  for (let i = 0; i < 8; i += 1) {
    candidates.push(`m/44'/133'/0'/0/${i}`);
    candidates.push(`m/44'/133'/0'/1/${i}`);
  }
  const seen = new Set<string>();
  for (const path of candidates) {
    if (seen.has(path)) continue;
    seen.add(path);
    const scalar = deriveScalar(seed, path);
    if (!expected) return scalar;
    const address = encodeP2pkhAddress(hash160(publicKeyFromScalar(scalar)));
    if (address === expected) return scalar;
  }
  throw new Error(
    `The recovery phrase does not derive ${expected} on the usual Zcash BIP44 paths. Export the transparent WIF for that t1 address and put it in ZCASH_PUBLISHER_KEY.`,
  );
}
