import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { hash160, ripemd160 } from "../src/lib/protocol/hash160";
import {
  bytesToBigInt,
  decodePoint,
  encodePoint,
  generator,
  isOnCurve,
  N,
  pointMul,
  recoverPublicKey,
  verifySignature,
} from "../src/lib/protocol/secp256k1";

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/** Node's ECDSA gives us an independent implementation to check against. */
function nodeKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "secp256k1",
  });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string; d?: string };
  const priv = privateKey.export({ format: "jwk" }) as { d: string };
  return {
    privateKey,
    publicKey,
    d: bytesToBigInt(Buffer.from(priv.d, "base64url")),
    point: {
      x: bytesToBigInt(Buffer.from(jwk.x, "base64url")),
      y: bytesToBigInt(Buffer.from(jwk.y, "base64url")),
    },
  };
}

/** Pulls r and s out of the DER signature Node produces. */
function derToRS(der: Buffer): { r: bigint; s: bigint } {
  let offset = 2;
  if (der[offset] !== 0x02) throw new Error("expected integer");
  const rLen = der[offset + 1]!;
  const r = bytesToBigInt(der.subarray(offset + 2, offset + 2 + rLen));
  offset += 2 + rLen;
  if (der[offset] !== 0x02) throw new Error("expected integer");
  const sLen = der[offset + 1]!;
  const s = bytesToBigInt(der.subarray(offset + 2, offset + 2 + sLen));
  return { r, s };
}

describe("ripemd160", () => {
  it("matches the published test vectors", () => {
    const vectors: Array<[string, string]> = [
      ["", "9c1185a5c5e9fc54612808977ee8f548b2258d31"],
      ["a", "0bdc9d2d256b3ee9daae347be6f4dc835a467ffe"],
      ["abc", "8eb208f7e05d987a9b044a8e98c6b087f15a0bfc"],
      ["message digest", "5d0689ef49d2fae572b881b123a85ffa21595f36"],
      ["abcdefghijklmnopqrstuvwxyz", "f71c27109c692c1b56bbdceb5b9d2865b3708dbc"],
    ];
    for (const [input, expected] of vectors) {
      expect(hex(ripemd160(new TextEncoder().encode(input)))).toBe(expected);
    }
  });

  it("agrees with Node across block boundaries and random input", () => {
    const lengths = [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 200, 1000];
    for (const length of lengths) {
      const data = crypto.randomBytes(length);
      expect(hex(ripemd160(data))).toBe(crypto.createHash("ripemd160").update(data).digest("hex"));
    }
    for (let i = 0; i < 200; i += 1) {
      const data = crypto.randomBytes(Math.floor(Math.random() * 300));
      expect(hex(ripemd160(data))).toBe(crypto.createHash("ripemd160").update(data).digest("hex"));
    }
  });

  it("hashes a key the way an address commits to it", () => {
    const key = crypto.randomBytes(33);
    const expected = crypto
      .createHash("ripemd160")
      .update(crypto.createHash("sha256").update(key).digest())
      .digest("hex");
    expect(hex(hash160(key))).toBe(expected);
  });
});

describe("secp256k1", () => {
  it("derives the same public key as Node from the same secret", () => {
    for (let i = 0; i < 5; i += 1) {
      const key = nodeKeyPair();
      const derived = pointMul(key.d, generator);
      expect(derived).not.toBeNull();
      expect(derived!.x).toBe(key.point.x);
      expect(derived!.y).toBe(key.point.y);
      expect(isOnCurve(derived)).toBe(true);
    }
  });

  it("verifies signatures that Node produced", () => {
    for (let i = 0; i < 5; i += 1) {
      const key = nodeKeyPair();
      const message = crypto.randomBytes(48);
      const digest = crypto.createHash("sha256").update(message).digest();
      const der = crypto.sign("sha256", message, {
        key: key.privateKey,
        dsaEncoding: "der",
      });
      const { r, s } = derToRS(der);
      expect(verifySignature(digest, r, s, key.point)).toBe(true);
      // A different digest must not verify.
      expect(verifySignature(crypto.randomBytes(32), r, s, key.point)).toBe(false);
    }
  });

  it("recovers the signing key from a Node signature", () => {
    for (let i = 0; i < 5; i += 1) {
      const key = nodeKeyPair();
      const message = crypto.randomBytes(48);
      const digest = crypto.createHash("sha256").update(message).digest();
      const { r, s } = derToRS(
        crypto.sign("sha256", message, { key: key.privateKey, dsaEncoding: "der" }),
      );

      // Exactly one recovery id must reproduce the real key.
      const matches = [0, 1, 2, 3].filter((id) => {
        const point = recoverPublicKey(digest, r, s, id);
        return point?.x === key.point.x && point?.y === key.point.y;
      });
      expect(matches).toHaveLength(1);
    }
  });

  it("refuses a signature whose r is not a curve point", () => {
    const digest = crypto.randomBytes(32);
    expect(recoverPublicKey(digest, 0n, 1n, 0)).toBeNull();
    expect(recoverPublicKey(digest, N, 1n, 0)).toBeNull();
    expect(recoverPublicKey(digest, 1n, 0n, 0)).toBeNull();
    expect(recoverPublicKey(digest, 1n, 1n, 9)).toBeNull();
  });

  it("round-trips compressed and uncompressed encodings", () => {
    for (let i = 0; i < 5; i += 1) {
      const key = nodeKeyPair();
      for (const compressed of [true, false]) {
        const encoded = encodePoint(key.point, compressed);
        expect(encoded).toHaveLength(compressed ? 33 : 65);
        const decoded = decodePoint(encoded);
        expect(decoded?.x).toBe(key.point.x);
        expect(decoded?.y).toBe(key.point.y);
      }
      // Node agrees on the compressed form.
      const nodeCompressed = key.publicKey
        .export({ format: "der", type: "spki" })
        .subarray(-65);
      expect(hex(encodePoint(key.point, false)).slice(2)).toBe(hex(nodeCompressed).slice(2));
    }
  });
});
