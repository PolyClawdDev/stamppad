/**
 * ECDSA over a bare 32-byte ZIP-244 digest.
 *
 * Node's crypto.sign still hashes even when the algorithm is null, so a
 * ZIP-244 digest cannot be handed to OpenSSL. Signing lives here, next to the
 * curve math already used to verify transparent ownership.
 */
import { createHash } from "node:crypto";
import { bytesToBigInt, encodePoint, generator, N, pointMul } from "../protocol/secp256k1";

export function signDigestDer(digest: Uint8Array, scalar: bigint): Uint8Array {
  if (digest.length !== 32) throw new Error("ZIP-244 digest is 32 bytes");
  const e = bytesToBigInt(digest) % N;
  for (let counter = 0; counter < 256; counter += 1) {
    const nonceBytes = createHash("sha256")
      .update(Buffer.concat([Buffer.from(digest), Buffer.from([counter]), bigIntToBuffer(scalar)]))
      .digest();
    const k = bytesToBigInt(nonceBytes) % N;
    if (k === 0n) continue;
    const point = pointMul(k, generator);
    if (!point) continue;
    const r = point.x % N;
    if (r === 0n) continue;
    let s = (modInverse(k, N) * (e + r * scalar)) % N;
    if (s === 0n) continue;
    if (s > N / 2n) s = N - s;
    return encodeDer(r, s);
  }
  throw new Error("no usable ECDSA nonce");
}

function modInverse(value: bigint, modulus: bigint): bigint {
  let [oldR, r] = [((value % modulus) + modulus) % modulus, modulus];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return ((oldS % modulus) + modulus) % modulus;
}

function bigIntToBuffer(value: bigint): Buffer {
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex");
}

function encodeDer(r: bigint, s: bigint): Uint8Array {
  const integer = (value: bigint): Buffer => {
    let bytes = bigIntToBuffer(value);
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
    bytes = bytes.subarray(start);
    if (bytes[0]! & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
    return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
  };
  const body = Buffer.concat([integer(r), integer(s)]);
  return Uint8Array.from(Buffer.concat([Buffer.from([0x30, body.length]), body]));
}

export function publicKeyFromScalar(scalar: bigint): Uint8Array {
  const point = pointMul(scalar, generator);
  if (!point) throw new Error("invalid publisher scalar");
  return encodePoint(point, true);
}
