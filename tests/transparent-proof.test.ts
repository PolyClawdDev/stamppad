import crypto from "node:crypto";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { hash160 } from "../src/lib/protocol/hash160";
import { bytesToBigInt, encodePoint } from "../src/lib/protocol/secp256k1";
import {
  MESSAGE_MAGIC,
  ownershipStatement,
  recoverFromCompact,
  signedMessageDigest,
  transparentAddressForKey,
  transparentMessageDigest,
  verifyTransparentMessage,
} from "../src/lib/protocol/tsig";
import { sha256 } from "../src/lib/protocol/taddr";

/**
 * Ground truth from Bitcoin Core's own message_verify test case in
 * src/test/util_tests.cpp. Zcash's scheme is byte-identical apart from the
 * magic string, so these vectors exercise the length prefixing, the double
 * SHA-256, the key recovery and the hash160 against an implementation that is
 * not ours. Testing only against our own signer would prove nothing about the
 * digest being right.
 */
const BITCOIN_MAGIC = "Bitcoin Signed Message:\n";
const BITCOIN_VECTORS = [
  {
    address: "15CRxFdyRpGZLW9w8HnHvVduizdL5jKNbs",
    message: "Trust no one",
    signature: "IPojfrX2dfPnH26UegfbGQQLrdK844DlHq5157/P6h57WyuS/Qsl+h/WSVGDF4MUi4rWSswW38oimDYfNNUBUOk=",
  },
  {
    address: "11canuhp9X2NocwCq7xNrQYTmUgZAnLK3",
    message: "Trust me",
    signature: "IIcaIENoYW5jZWxsb3Igb24gYnJpbmsgb2Ygc2Vjb25kIGJhaWxvdXQgZm9yIGJhbmtzIAaHRtbCeDZINyavx14=",
  },
];

/** base58check with a one-byte version, which is how Bitcoin writes a p2pkh address. */
function bitcoinAddress(publicKey: Uint8Array): string {
  const payload = new Uint8Array(21);
  payload[0] = 0x00;
  payload.set(hash160(publicKey), 1);
  const full = new Uint8Array(25);
  full.set(payload);
  full.set(sha256(sha256(payload)).subarray(0, 4), 21);
  return bs58.encode(full);
}

function compactSize(value: number): Buffer {
  if (value < 0xfd) return Buffer.from([value]);
  const out = Buffer.alloc(3);
  out[0] = 0xfd;
  out.writeUInt16LE(value, 1);
  return out;
}

/**
 * Produces a recoverable signature the way a wallet does.
 *
 * Node cannot sign a precomputed digest, but the digest here is
 * sha256(sha256(preimage)), so handing Node sha256(preimage) and asking for
 * sha256 gets the same result without reimplementing ECDSA in the test.
 */
function signMessage(
  magic: string,
  message: string,
  privateKey: crypto.KeyObject,
  point: { x: bigint; y: bigint },
): string {
  const magicBytes = Buffer.from(magic, "utf8");
  const bodyBytes = Buffer.from(message, "utf8");
  const preimage = Buffer.concat([
    compactSize(magicBytes.length),
    magicBytes,
    compactSize(bodyBytes.length),
    bodyBytes,
  ]);
  const inner = crypto.createHash("sha256").update(preimage).digest();
  const der = crypto.sign("sha256", inner, { key: privateKey, dsaEncoding: "der" });

  const rLen = der[3]!;
  const r = der.subarray(4, 4 + rLen);
  const sLen = der[4 + rLen + 1]!;
  const s = der.subarray(4 + rLen + 2, 4 + rLen + 2 + sLen);
  const rs = new Uint8Array(64);
  rs.set(r.subarray(Math.max(0, r.length - 32)), 32 - Math.min(32, r.length));
  rs.set(s.subarray(Math.max(0, s.length - 32)), 64 - Math.min(32, s.length));

  const digest = signedMessageDigest(magic, message);
  const wanted = Buffer.from(encodePoint(point, true));
  for (const id of [0, 1, 2, 3]) {
    const signature = new Uint8Array(65);
    signature[0] = 31 + id;
    signature.set(rs, 1);
    const recovered = recoverFromCompact(digest, signature);
    if (recovered && wanted.equals(Buffer.from(recovered.publicKey))) {
      return Buffer.from(signature).toString("base64");
    }
  }
  throw new Error("no recovery id reproduced the signing key");
}

function nodeKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const point = {
    x: bytesToBigInt(Buffer.from(jwk.x, "base64url")),
    y: bytesToBigInt(Buffer.from(jwk.y, "base64url")),
  };
  return { privateKey, point, compressed: encodePoint(point, true) };
}

describe("signed message machinery, against Bitcoin Core's vectors", () => {
  it("recovers the key that signed each vector and derives its address", () => {
    for (const vector of BITCOIN_VECTORS) {
      const digest = signedMessageDigest(BITCOIN_MAGIC, vector.message);
      const recovered = recoverFromCompact(digest, new Uint8Array(Buffer.from(vector.signature, "base64")));
      expect(recovered, `recovery failed for ${vector.address}`).not.toBeNull();
      expect(bitcoinAddress(recovered!.publicKey)).toBe(vector.address);
    }
  });

  it("rejects a vector's signature against the wrong message", () => {
    const vector = BITCOIN_VECTORS[0]!;
    const digest = signedMessageDigest(BITCOIN_MAGIC, "I never signed this");
    const recovered = recoverFromCompact(digest, new Uint8Array(Buffer.from(vector.signature, "base64")));
    // A different message recovers some other key, never this address.
    if (recovered) expect(bitcoinAddress(recovered.publicKey)).not.toBe(vector.address);
  });

  it("recovers nothing from an all-zero signature, as Bitcoin Core does not", () => {
    const zeros = new Uint8Array(65);
    zeros[0] = 31;
    expect(recoverFromCompact(signedMessageDigest(BITCOIN_MAGIC, "anything"), zeros)).toBeNull();
  });
});

describe("transparent ownership proof", () => {
  it("uses the magic string zcashd defines", () => {
    expect(MESSAGE_MAGIC).toBe("Zcash Signed Message:\n");
    // A Zcash digest must differ from a Bitcoin one over the same text, or a
    // signature could be replayed between the two chains.
    expect(Buffer.from(transparentMessageDigest("hello")).toString("hex")).not.toBe(
      Buffer.from(signedMessageDigest(BITCOIN_MAGIC, "hello")).toString("hex"),
    );
  });

  it("length-prefixes both strings before hashing twice", () => {
    const magic = Buffer.from(MESSAGE_MAGIC, "utf8");
    const body = Buffer.from("hello", "utf8");
    const preimage = Buffer.concat([
      Buffer.from([magic.length]),
      magic,
      Buffer.from([body.length]),
      body,
    ]);
    const expected = crypto
      .createHash("sha256")
      .update(crypto.createHash("sha256").update(preimage).digest())
      .digest("hex");
    expect(Buffer.from(transparentMessageDigest("hello")).toString("hex")).toBe(expected);
  });

  it("accepts a proof for the address the key implies", () => {
    const key = nodeKey();
    const address = transparentAddressForKey(key.compressed);
    expect(address.startsWith("t1")).toBe(true);

    const statement = ownershipStatement({
      stampCommitmentHex: "ab".repeat(32),
      address,
      nonce: "7f3c19a2",
    });
    const signature = signMessage(MESSAGE_MAGIC, statement, key.privateKey, key.point);

    const result = verifyTransparentMessage({ address, message: statement, signatureBase64: signature });
    expect(result.ok).toBe(true);
    expect(result.derivedAddress).toBe(address);
    expect(result.publicKeyHex).toHaveLength(66);
  });

  it("refuses the same proof for a different stamp or nonce", () => {
    const key = nodeKey();
    const address = transparentAddressForKey(key.compressed);
    const signature = signMessage(
      MESSAGE_MAGIC,
      ownershipStatement({ stampCommitmentHex: "ab".repeat(32), address, nonce: "7f3c19a2" }),
      key.privateKey,
      key.point,
    );

    const replayed = verifyTransparentMessage({
      address,
      message: ownershipStatement({ stampCommitmentHex: "cd".repeat(32), address, nonce: "7f3c19a2" }),
      signatureBase64: signature,
    });
    expect(replayed.ok).toBe(false);

    const reNonced = verifyTransparentMessage({
      address,
      message: ownershipStatement({ stampCommitmentHex: "ab".repeat(32), address, nonce: "deadbeef" }),
      signatureBase64: signature,
    });
    expect(reNonced.ok).toBe(false);
  });

  it("refuses a valid signature made by a different key", () => {
    const mine = nodeKey();
    const theirs = nodeKey();
    const myAddress = transparentAddressForKey(mine.compressed);

    const statement = ownershipStatement({
      stampCommitmentHex: "ab".repeat(32),
      address: myAddress,
      nonce: "7f3c19a2",
    });
    const theirSignature = signMessage(MESSAGE_MAGIC, statement, theirs.privateKey, theirs.point);

    const result = verifyTransparentMessage({
      address: myAddress,
      message: statement,
      signatureBase64: theirSignature,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("different address");
    // It still reports whose it was, which is useful when someone pastes the wrong one.
    expect(result.derivedAddress).not.toBe(myAddress);
  });

  it("explains every malformed input instead of failing silently", () => {
    const address = "t1P2GcxGhzeM5tPk3r3JsGh1tEVArD4C2fB";
    const cases: Array<[string, RegExp]> = [
      ["not base64 !!!", /base64/],
      [Buffer.alloc(10).toString("base64"), /65 bytes/],
      [Buffer.concat([Buffer.from([5]), Buffer.alloc(64)]).toString("base64"), /header byte/],
      [Buffer.concat([Buffer.from([31]), Buffer.alloc(64)]).toString("base64"), /malformed/],
    ];
    for (const [signatureBase64, expected] of cases) {
      const result = verifyTransparentMessage({ address, message: "hello", signatureBase64 });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(expected);
    }
  });

  it("refuses address types that cannot commit to one key", () => {
    // A t3 multisig address commits to a script hash.
    const payload = new Uint8Array(22);
    payload.set([0x1c, 0xbd]);
    payload.fill(9, 2);
    const full = new Uint8Array(26);
    full.set(payload);
    full.set(sha256(sha256(payload)).subarray(0, 4), 22);
    const p2sh = bs58.encode(full);

    const result = verifyTransparentMessage({
      address: p2sh,
      message: "hello",
      signatureBase64: Buffer.concat([Buffer.from([31]), Buffer.alloc(64)]).toString("base64"),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("multisig");
  });
});
