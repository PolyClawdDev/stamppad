/**
 * Proving control of a transparent Zcash address to a wallet session.
 *
 * Transferring a stamp held at a t-address already works, because the holder
 * signs the transfer preimage and the key is recovered from that signature.
 * Listing cannot work that way: a listing has to name the seller's key before
 * any signature over the sale exists. Taking the seller's word for the address
 * instead would be worse than useless. A stamp can carry only one live listing,
 * so anyone could name someone else's address, fail to complete the sale, and
 * still lock the real owner out of listing their own stamp.
 *
 * So control is proved once, up front, and the proof is kept against the
 * connected wallet session rather than against the address alone. The statement
 * names this origin and carries a single-use nonce, exactly as the Phantom
 * connect statement does, so a signature collected elsewhere or kept from an
 * earlier visit establishes nothing here. It also names the Solana wallet the
 * proof will belong to, and the Zcash signature covers that line, which is what
 * stops one session from presenting a proof another session obtained.
 *
 * No Zcash key is handled here or anywhere else in this app. The holder signs
 * in their own wallet, pastes the signature, and the public key is recovered
 * from it by the protocol's verifier.
 */
import { verifyTransparentMessage } from "../protocol/tsig";
import { SESSION_TTL_MS, readSessionCookie, type CookieSession } from "./cookie";

/** How long a statement stays signable. The same window Phantom's connect gets. */
export const STATEMENT_MAX_AGE_MS = 5 * 60 * 1000;

export interface AddressStatement {
  domain: string;
  /** The Solana wallet the proof will belong to, in base58. */
  walletPublicKey: string;
  address: string;
  nonce: string;
  issuedAt: string;
}

export interface AddressProof {
  address: string;
  /** Recovered from the signature. A caller never gets to name this. */
  publicKeyHex: string;
  provenAt: string;
}

const HEADER = "StampPad wants to check that you control this Zcash address.";
const BODY =
  "Sign this in the Zcash wallet that holds the address. It is not a transaction: nothing moves, no ZEC is spent, and StampPad never sees your Zcash key.";

export function buildAddressStatement(statement: AddressStatement): string {
  return [
    HEADER,
    "",
    BODY,
    "",
    `Site: ${statement.domain}`,
    `Wallet: ${statement.walletPublicKey}`,
    `Address: ${statement.address}`,
    `Nonce: ${statement.nonce}`,
    `Issued: ${statement.issuedAt}`,
  ].join("\n");
}

const SHAPE = new RegExp(
  `^${escape(HEADER)}\\n\\n${escape(BODY)}\\n\\n` +
    "Site: (?<domain>[^\\n]+)\\n" +
    "Wallet: (?<walletPublicKey>[1-9A-HJ-NP-Za-km-z]+)\\n" +
    "Address: (?<address>[1-9A-HJ-NP-Za-km-z]+)\\n" +
    "Nonce: (?<nonce>[0-9a-f]{32,64})\\n" +
    "Issued: (?<issuedAt>[0-9TZ:.\\-]+)$",
);

export function parseAddressStatement(message: string): AddressStatement | null {
  const match = SHAPE.exec(message);
  if (!match?.groups) return null;
  const { domain, walletPublicKey, address, nonce, issuedAt } = match.groups;
  if (!domain || !walletPublicKey || !address || !nonce || !issuedAt) return null;
  if (!Number.isFinite(Date.parse(issuedAt))) return null;
  return { domain, walletPublicKey, address, nonce, issuedAt };
}

export type ProofFailure = "invalid_request" | "signature_rejected";

export type AddressProofVerification =
  | { ok: true; statement: AddressStatement; proof: AddressProof }
  | { ok: false; message: string; code: ProofFailure };

/**
 * Checks a pasted signature against the statement this site issued.
 *
 * Nonce consumption is left to the caller, which owns the store. Everything
 * else a proof has to satisfy is here, and every rejection carries a sentence
 * that can be shown to whoever pasted the signature.
 */
export function verifyAddressProof(input: {
  address: string;
  message: string;
  signatureBase64: string;
  expectedDomain: string;
  expectedWallet: string;
  now?: Date;
  maxAgeMs?: number;
}): AddressProofVerification {
  const statement = parseAddressStatement(input.message);
  if (!statement) {
    return refuse(
      "That is not StampPad's address-control statement. Copy the statement exactly as it is shown, including the blank lines.",
    );
  }
  if (statement.domain !== input.expectedDomain) {
    return refuse(
      `The statement names ${statement.domain}, but this site is ${input.expectedDomain}, so a signature over it does not speak for this site.`,
    );
  }
  if (statement.walletPublicKey !== input.expectedWallet) {
    return refuse(
      "That statement was issued to a different StampPad wallet, so it cannot prove anything for this one. Ask for a statement while this wallet is connected.",
    );
  }
  if (statement.address !== input.address.trim()) {
    return refuse(`The statement is for ${statement.address}, not for ${input.address.trim()}.`);
  }

  const now = input.now ?? new Date();
  const age = now.getTime() - Date.parse(statement.issuedAt);
  if (age > (input.maxAgeMs ?? STATEMENT_MAX_AGE_MS) || age < -60_000) {
    return refuse("That statement has expired. Ask for a fresh one and sign that instead.");
  }

  const result = verifyTransparentMessage({
    address: statement.address,
    message: input.message,
    signatureBase64: input.signatureBase64,
  });
  if (!result.ok || !result.publicKeyHex) {
    return { ok: false, message: result.message, code: "signature_rejected" };
  }

  return {
    ok: true,
    statement,
    proof: {
      address: statement.address,
      publicKeyHex: result.publicKeyHex,
      provenAt: now.toISOString(),
    },
  };
}

export interface ProofStore {
  record(session: string, proof: AddressProof, now?: number): void;
  list(session: string, now?: number): AddressProof[];
  find(session: string, address: string, now?: number): AddressProof | null;
  /** Drops every proof a session holds. Disconnecting calls this. */
  revoke(session: string): void;
  size(): number;
}

/**
 * Proofs held in process memory, keyed by session, with the same lifetime as
 * the cookie that owns them. Like the connect nonces, they do not survive a
 * restart and are not shared between instances, which is the same scope as the
 * in-process ledger this build runs on.
 */
export function createProofStore(options: { ttlMs?: number } = {}): ProofStore {
  const ttlMs = options.ttlMs ?? SESSION_TTL_MS;
  const sessions = new Map<string, Map<string, { proof: AddressProof; expiresAt: number }>>();

  function live(session: string, now: number): Map<string, AddressProof> {
    const held = sessions.get(session);
    const out = new Map<string, AddressProof>();
    if (!held) return out;
    for (const [address, entry] of held) {
      if (entry.expiresAt <= now) held.delete(address);
      else out.set(address, entry.proof);
    }
    if (held.size === 0) sessions.delete(session);
    return out;
  }

  return {
    record(session, proof, now = Date.now()) {
      const held = sessions.get(session) ?? new Map();
      held.set(proof.address, { proof, expiresAt: now + ttlMs });
      sessions.set(session, held);
    },
    list(session, now = Date.now()) {
      return [...live(session, now).values()];
    },
    find(session, address, now = Date.now()) {
      return live(session, now).get(address.trim()) ?? null;
    },
    revoke(session) {
      sessions.delete(session);
    },
    size() {
      return sessions.size;
    },
  };
}

export const proofStore = createProofStore();

/**
 * The key a proof hangs on. `verifiedAt` is part of it deliberately: a proof
 * belongs to one connected session, so disconnecting and connecting again means
 * proving control again rather than inheriting an earlier session's word.
 */
export function sessionKey(session: Pick<CookieSession, "publicKey" | "verifiedAt">): string {
  return `${session.publicKey}|${session.verifiedAt}`;
}

/** The transparent addresses this request's session has proved control of. */
export function provenAddresses(request: Request): string[] {
  const session = readSessionCookie(request);
  if (!session) return [];
  return proofStore.list(sessionKey(session)).map((proof) => proof.address);
}

function refuse(message: string): AddressProofVerification {
  return { ok: false, message, code: "invalid_request" };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
