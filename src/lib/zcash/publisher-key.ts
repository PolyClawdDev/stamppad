import { readFileSync } from "node:fs";
import bs58 from "bs58";
import { createHash } from "node:crypto";
import { hash160 } from "../protocol/hash160";
import { encodeP2pkhAddress } from "../protocol/taddr";
import { bytesToBigInt } from "../protocol/secp256k1";
import { publicKeyFromScalar } from "./sign";

export interface PublisherKey {
  scalar: bigint;
  publicKey: Uint8Array;
  address: string;
}

/**
 * The spending key for the isolated publisher. On Vercel there is no file, so
 * ZCASH_PUBLISHER_KEY holds the WIF or 32-byte hex. A key file still wins when
 * both are set, because that is the safer operator layout.
 */
export function loadPublisherKey(): PublisherKey {
  const fromFile = process.env.ZCASH_PUBLISHER_KEY_FILE?.trim();
  const raw = fromFile
    ? readFileSync(fromFile, "utf8").trim()
    : (process.env.ZCASH_PUBLISHER_KEY ?? "").trim();
  if (!raw) {
    throw new Error(
      "ZCASH_PUBLISHER_KEY (WIF or hex) or ZCASH_PUBLISHER_KEY_FILE is required to publish a stamp.",
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

function scalarFromSecret(raw: string): bigint {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    const scalar = bytesToBigInt(Buffer.from(raw, "hex"));
    if (scalar === 0n) throw new Error("publisher key is zero");
    return scalar;
  }
  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(raw);
  } catch {
    throw new Error("publisher key must be 32-byte hex or WIF");
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
