/**
 * Wallet session proofs.
 *
 * Phantom's `signMessage` produces a detached ed25519 signature over the raw
 * message bytes using the account's Solana key. That is the same primitive the
 * protocol already verifies for transfer and offer authorizations, so the proof
 * below is checked with the same tweetnacl call over the UTF-8 bytes of a
 * canonical, human-readable statement.
 *
 * The statement names the site and carries a server-issued single-use nonce, so
 * a signature captured on another origin or replayed later does not establish a
 * session here.
 *
 * tweetnacl and bs58 are both pure JavaScript, so this module runs unchanged in
 * the browser and on the server.
 */
import bs58 from "bs58";
import nacl from "tweetnacl";

export const SESSION_MAX_AGE_MS = 5 * 60 * 1000;

export interface SessionStatement {
  domain: string;
  publicKey: string;
  nonce: string;
  issuedAt: string;
}

export interface SessionProof extends Pick<SessionStatement, "publicKey"> {
  message: string;
  /** Base58, as Phantom hands back the 64-byte detached signature. */
  signature: string;
}

export interface VerifiedSession {
  publicKey: string;
  publicKeyHex: string;
  verifiedAt: string;
}

export type SessionVerification =
  | { ok: true; session: VerifiedSession }
  | { ok: false; message: string };

const HEADER = "StampPad wants to check that you control this wallet.";
const BODY =
  "Signing proves you hold the key. It is not a transaction: nothing moves and no SOL is spent.";

export function buildSessionMessage(statement: SessionStatement): string {
  return [
    HEADER,
    "",
    BODY,
    "",
    `Site: ${statement.domain}`,
    `Wallet: ${statement.publicKey}`,
    `Nonce: ${statement.nonce}`,
    `Issued: ${statement.issuedAt}`,
  ].join("\n");
}

const SHAPE = new RegExp(
  `^${escape(HEADER)}\\n\\n${escape(BODY)}\\n\\n` +
    "Site: (?<domain>[^\\n]+)\\n" +
    "Wallet: (?<publicKey>[1-9A-HJ-NP-Za-km-z]+)\\n" +
    "Nonce: (?<nonce>[0-9a-f]{32,64})\\n" +
    "Issued: (?<issuedAt>[0-9TZ:.\\-]+)$",
);

export function parseSessionMessage(message: string): SessionStatement | null {
  const match = SHAPE.exec(message);
  if (!match?.groups) return null;
  const { domain, publicKey, nonce, issuedAt } = match.groups;
  if (!domain || !publicKey || !nonce || !issuedAt) return null;
  if (!Number.isFinite(Date.parse(issuedAt))) return null;
  return { domain, publicKey, nonce, issuedAt };
}

/**
 * Checks a proof against the statement the server expects. Every mismatch
 * returns a sentence that can be shown to the person who signed.
 */
export function verifySessionProof(input: {
  proof: SessionProof;
  expectedDomain: string;
  expectedNonce: string;
  now?: Date;
  maxAgeMs?: number;
}): SessionVerification {
  const statement = parseSessionMessage(input.proof.message);
  if (!statement) {
    return { ok: false, message: "The signed message is not StampPad's verification statement." };
  }
  if (statement.domain !== input.expectedDomain) {
    return {
      ok: false,
      message: `The signed message names ${statement.domain}, but this site is ${input.expectedDomain}.`,
    };
  }
  if (statement.nonce !== input.expectedNonce) {
    return {
      ok: false,
      message: "The signed message carries a different nonce than the one this site issued.",
    };
  }
  if (statement.publicKey !== input.proof.publicKey) {
    return {
      ok: false,
      message: "The signed message names a different wallet than the one presenting it.",
    };
  }
  const now = input.now ?? new Date();
  const age = now.getTime() - Date.parse(statement.issuedAt);
  const maxAge = input.maxAgeMs ?? SESSION_MAX_AGE_MS;
  if (age > maxAge || age < -60_000) {
    return { ok: false, message: "The signed message has expired. Connect again to sign a fresh one." };
  }

  let publicKeyBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    publicKeyBytes = bs58.decode(input.proof.publicKey);
    signatureBytes = bs58.decode(input.proof.signature);
  } catch {
    return { ok: false, message: "The wallet public key or signature was not valid base58." };
  }
  if (publicKeyBytes.length !== 32) {
    return { ok: false, message: "A Solana public key must be 32 bytes." };
  }
  if (signatureBytes.length !== 64) {
    return { ok: false, message: "An ed25519 signature must be 64 bytes." };
  }

  let verified = false;
  try {
    verified = nacl.sign.detached.verify(
      new TextEncoder().encode(input.proof.message),
      signatureBytes,
      publicKeyBytes,
    );
  } catch {
    verified = false;
  }
  if (!verified) {
    return { ok: false, message: "The signature does not verify against that wallet's public key." };
  }

  return {
    ok: true,
    session: {
      publicKey: input.proof.publicKey,
      publicKeyHex: toHex(publicKeyBytes),
      verifiedAt: now.toISOString(),
    },
  };
}

export function truncateKey(publicKey: string, head = 4, tail = 4): string {
  if (publicKey.length <= head + tail + 1) return publicKey;
  return `${publicKey.slice(0, head)}…${publicKey.slice(-tail)}`;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
