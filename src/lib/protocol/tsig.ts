/**
 * Proving control of a transparent Zcash address.
 *
 * Until now a stamp sent to someone's own t-address was a dead end: verifiable,
 * but untransferable and unlistable, because nothing here could tell the real
 * holder of that address from anyone who happened to type it. This closes that.
 *
 * The scheme is the one zcashd established and Zallet kept, so any wallet that
 * can `signmessage` produces a proof this accepts. zcashd's `strMessageMagic`
 * is "Zcash Signed Message:\n" (src/main.cpp). That string and the caller's
 * message are each CompactSize-length-prefixed, concatenated, and double
 * SHA-256 hashed. The signature is a recoverable ECDSA blob of 65 bytes,
 * [header][r][s], base64-encoded, where the header encodes the recovery id and
 * whether the key was compressed.
 *
 * The magic prefix is the security boundary: it is what stops a signature over
 * user text from being replayed as a signature over a transaction. It also
 * means a Bitcoin signature will not verify here, which is intended.
 *
 * Verification recovers the public key, derives the address that key implies,
 * and compares. No key material is involved, so this is safe to run anywhere.
 */
import { encodeBase58, fromHex } from "./encoding";
import { hash160 } from "./hash160";
import { bytesToBigInt, encodePoint, recoverPublicKey } from "./secp256k1";
import { sha256, toHex, validateTransparentAddress } from "./taddr";
import bs58 from "bs58";

export const MESSAGE_MAGIC = "Zcash Signed Message:\n";

/** Mainnet p2pkh version bytes. Testnet t-addresses use 0x1d25. */
const P2PKH_VERSION: Record<"zcash:main" | "zcash:test", [number, number]> = {
  "zcash:main": [0x1c, 0xb8],
  "zcash:test": [0x1d, 0x25],
};

export interface TransparentProofResult {
  ok: boolean;
  /** Plain explanation, suitable for showing to whoever pasted the signature. */
  message: string;
  /** The key the signature recovers to, when it recovers at all. */
  publicKeyHex: string | null;
  /** The address that key implies. Compare against what was claimed. */
  derivedAddress: string | null;
}

function compactSize(value: number): Uint8Array {
  if (value < 0xfd) return Uint8Array.from([value]);
  if (value <= 0xffff) return Uint8Array.from([0xfd, value & 0xff, value >> 8]);
  const out = new Uint8Array(5);
  out[0] = 0xfe;
  new DataView(out.buffer).setUint32(1, value, true);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * The digest a wallet signs. Both strings are length-prefixed, then hashed
 * twice. The magic is a parameter only so the tests can drive this with
 * Bitcoin's, where published vectors exist; production always uses Zcash's.
 */
export function signedMessageDigest(magicString: string, message: string): Uint8Array {
  const magic = new TextEncoder().encode(magicString);
  const body = new TextEncoder().encode(message);
  const preimage = concat([compactSize(magic.length), magic, compactSize(body.length), body]);
  return sha256(sha256(preimage));
}

export function transparentMessageDigest(message: string): Uint8Array {
  return signedMessageDigest(MESSAGE_MAGIC, message);
}

/**
 * Recovers the key a compact signature implies. Shared by the Zcash path and
 * the tests that check this machinery against Bitcoin's vectors.
 */
export function recoverFromCompact(
  digest: Uint8Array,
  signature: Uint8Array,
): { publicKey: Uint8Array; compressed: boolean } | null {
  if (signature.length !== 65) return null;
  const header = signature[0]!;
  if (header < 27 || header > 34) return null;
  const compressed = header >= 31;
  const point = recoverPublicKey(
    digest,
    bytesToBigInt(signature.subarray(1, 33)),
    bytesToBigInt(signature.subarray(33, 65)),
    (header - 27) & 3,
  );
  if (!point) return null;
  return { publicKey: encodePoint(point, compressed), compressed };
}

/** Builds the p2pkh address a public key implies. */
export function transparentAddressForKey(
  publicKey: Uint8Array,
  network: "zcash:main" | "zcash:test" = "zcash:main",
): string {
  const payload = new Uint8Array(22);
  payload.set(P2PKH_VERSION[network]);
  payload.set(hash160(publicKey), 2);
  const full = new Uint8Array(26);
  full.set(payload);
  full.set(sha256(sha256(payload)).subarray(0, 4), 22);
  return encodeBase58(full);
}

/** The 20-byte key hash a t-address commits to, or null if it commits to a script. */
export function keyHashFromAddress(address: string): Uint8Array | null {
  const check = validateTransparentAddress(address);
  if (!check.ok || check.kind !== "p2pkh") return null;
  const raw = bs58.decode(address);
  return raw.subarray(2, 22);
}

function decodeBase64(input: string): Uint8Array | null {
  // Reject anything outside the alphabet up front; atob and Buffer are both
  // lenient about stray characters and would silently accept a typo.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.trim())) return null;
  try {
    const trimmed = input.trim();
    if (typeof atob === "function") {
      const binary = atob(trimmed);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(trimmed, "base64"));
  } catch {
    return null;
  }
}

/**
 * Checks that `signatureBase64` proves control of `address` over `message`.
 *
 * Returns why it failed rather than a bare boolean, because every failure here
 * is something a person can act on: a wrong address, a copied-wrong signature,
 * or the wrong message pasted into their wallet.
 */
export function verifyTransparentMessage(input: {
  address: string;
  message: string;
  signatureBase64: string;
}): TransparentProofResult {
  const fail = (message: string): TransparentProofResult => ({
    ok: false,
    message,
    publicKeyHex: null,
    derivedAddress: null,
  });

  const check = validateTransparentAddress(input.address);
  if (!check.ok) return fail(check.message);
  if (check.kind === "p2sh") {
    return fail(
      "That is a multisig address, which commits to a script rather than one key, so a signed message cannot prove control of it.",
    );
  }
  if (check.kind === "tex") {
    return fail(
      "TEX addresses are not supported here yet. Use the transparent address the funds actually sit at.",
    );
  }

  const expectedHash = keyHashFromAddress(input.address);
  if (!expectedHash) return fail("That address does not commit to a single key.");

  const signature = decodeBase64(input.signatureBase64);
  if (!signature) return fail("That signature is not valid base64. Copy it again from your wallet.");
  if (signature.length !== 65) {
    return fail(
      `A signed message is 65 bytes; this decoded to ${signature.length}. Make sure you pasted the signature and not the message.`,
    );
  }

  if (signature[0]! < 27 || signature[0]! > 34) {
    return fail("That signature's header byte is out of range, so it did not come from signmessage.");
  }

  const recovered = recoverFromCompact(transparentMessageDigest(input.message), signature);
  if (!recovered) {
    return fail("No public key can be recovered from that signature, so it is malformed.");
  }

  const publicKey = recovered.publicKey;
  const derivedAddress = transparentAddressForKey(
    publicKey,
    check.network === "zcash:test" ? "zcash:test" : "zcash:main",
  );
  const derivedHash = hash160(publicKey);

  if (toHex(derivedHash) !== toHex(expectedHash)) {
    return {
      ok: false,
      message:
        "That signature is valid but belongs to a different address, so it does not prove control of this one.",
      publicKeyHex: toHex(publicKey),
      derivedAddress,
    };
  }

  return {
    ok: true,
    message: "Signature proves control of this address.",
    publicKeyHex: toHex(publicKey),
    derivedAddress,
  };
}

/**
 * Verifies a transfer or offer preimage signed by the holder of a transparent
 * address.
 *
 * The signature is the 65-byte compact form Zcash wallets emit, hex encoded to
 * fit the protocol's existing signature field. The key is recovered from the
 * signature rather than supplied by the caller, so naming someone else's key
 * achieves nothing.
 *
 * This is the single rule for transparent ownership. Both the request path and
 * the deterministic rebuild call it, so a transfer cannot be accepted live and
 * then rejected when the ledger is rebuilt from public data.
 */
export function verifyTransparentAuthorization(input: {
  address: string;
  preimage: string;
  signatureHex: string;
}): { ok: boolean; message: string } {
  const expected = keyHashFromAddress(input.address);
  if (!expected) {
    return { ok: false, message: "That address does not commit to a single key." };
  }

  let signature: Uint8Array;
  try {
    signature = fromHex(input.signatureHex);
  } catch {
    return { ok: false, message: "That signature is not valid hex." };
  }
  if (signature.length !== 65) {
    return {
      ok: false,
      message: `A Zcash signed message is 65 bytes; this was ${signature.length}.`,
    };
  }

  const recovered = recoverFromCompact(transparentMessageDigest(input.preimage), signature);
  if (!recovered) {
    return { ok: false, message: "No key can be recovered from that signature." };
  }
  if (toHex(hash160(recovered.publicKey)) !== toHex(expected)) {
    return {
      ok: false,
      message: "That signature is valid but was made by a different address.",
    };
  }
  return { ok: true, message: "Signature verified against the transparent address." };
}

/**
 * The statement a holder signs. Naming the stamp and a nonce keeps a proof from
 * being lifted out of one context and replayed in another.
 */
export function ownershipStatement(input: {
  stampCommitmentHex: string;
  address: string;
  nonce: string;
}): string {
  return [
    "StampPad ownership proof",
    `stamp: ${input.stampCommitmentHex}`,
    `address: ${input.address}`,
    `nonce: ${input.nonce}`,
  ].join("\n");
}
