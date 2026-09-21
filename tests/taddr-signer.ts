/**
 * A test stand-in for a Zcash wallet that can signmessage.
 *
 * Signing is done with Node's ECDSA rather than our own curve code, so tests
 * built on this are checking our verifier against an independent signer.
 */
import crypto from "node:crypto";
import { bytesToBigInt, encodePoint } from "../src/lib/protocol/secp256k1";
import {
  MESSAGE_MAGIC,
  recoverFromCompact,
  signedMessageDigest,
  transparentAddressForKey,
} from "../src/lib/protocol/tsig";

function compactSize(value: number): Buffer {
  if (value < 0xfd) return Buffer.from([value]);
  const out = Buffer.alloc(3);
  out[0] = 0xfd;
  out.writeUInt16LE(value, 1);
  return out;
}

export interface TransparentIdentity {
  address: string;
  publicKeyHex: string;
  /** The 65-byte compact signature, hex encoded, as the protocol carries it. */
  sign(preimage: string): string;
  /** The same signature base64 encoded, as a wallet would print it. */
  signBase64(preimage: string): string;
}

export function transparentIdentity(): TransparentIdentity {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "secp256k1",
  });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const point = {
    x: bytesToBigInt(Buffer.from(jwk.x, "base64url")),
    y: bytesToBigInt(Buffer.from(jwk.y, "base64url")),
  };
  const compressed = encodePoint(point, true);

  function signCompact(preimage: string): Uint8Array {
    const magic = Buffer.from(MESSAGE_MAGIC, "utf8");
    const body = Buffer.from(preimage, "utf8");
    const full = Buffer.concat([compactSize(magic.length), magic, compactSize(body.length), body]);
    // The digest is sha256(sha256(full)); Node cannot sign a bare digest, but
    // handing it sha256(full) and asking for sha256 lands on the same value.
    const inner = crypto.createHash("sha256").update(full).digest();
    const der = crypto.sign("sha256", inner, { key: privateKey, dsaEncoding: "der" });

    const rLen = der[3]!;
    const r = der.subarray(4, 4 + rLen);
    const sLen = der[4 + rLen + 1]!;
    const s = der.subarray(4 + rLen + 2, 4 + rLen + 2 + sLen);
    const rs = new Uint8Array(64);
    rs.set(r.subarray(Math.max(0, r.length - 32)), 32 - Math.min(32, r.length));
    rs.set(s.subarray(Math.max(0, s.length - 32)), 64 - Math.min(32, s.length));

    const digest = signedMessageDigest(MESSAGE_MAGIC, preimage);
    const wanted = Buffer.from(compressed);
    for (const id of [0, 1, 2, 3]) {
      const signature = new Uint8Array(65);
      signature[0] = 31 + id;
      signature.set(rs, 1);
      const recovered = recoverFromCompact(digest, signature);
      if (recovered && wanted.equals(Buffer.from(recovered.publicKey))) return signature;
    }
    throw new Error("no recovery id reproduced the signing key");
  }

  return {
    address: transparentAddressForKey(compressed),
    publicKeyHex: Buffer.from(compressed).toString("hex"),
    sign: (preimage) => Buffer.from(signCompact(preimage)).toString("hex"),
    signBase64: (preimage) => Buffer.from(signCompact(preimage)).toString("base64"),
  };
}
