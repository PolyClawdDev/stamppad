import { fail, ok } from "@/lib/http";
import { readSessionCookie } from "@/lib/wallet/cookie";
import { nonceStore } from "@/lib/wallet/nonce";
import { requestDomain } from "@/lib/wallet/origin";
import {
  proofStore,
  sessionKey,
  verifyAddressProof,
} from "@/lib/wallet/taddr-proof";

/**
 * Records a proof that the connected session controls a transparent address.
 *
 * The signature is the 65-byte compact form a Zcash wallet's signmessage emits,
 * base64 as the wallet prints it, and it is checked by the protocol's own
 * verifier. The recovered key is what gets stored; a key named by the caller is
 * never trusted, and no Zcash key ever reaches this server.
 */
export async function POST(request: Request) {
  const session = readSessionCookie(request);
  if (!session) {
    return fail(
      "Connect your wallet first. A control proof is kept against one connected session, so there is nothing to attach this to yet.",
      401,
      "no_session",
    );
  }

  let body: { address?: string; message?: string; signature?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail("Expected a JSON body with address, message and signature.");
  }
  if (!body.address || !body.message || !body.signature) {
    return fail("address, message and signature are all required.");
  }

  const verification = verifyAddressProof({
    address: body.address,
    message: body.message,
    signatureBase64: body.signature,
    expectedDomain: requestDomain(request),
    expectedWallet: session.publicKey,
  });
  if (!verification.ok) {
    return fail(
      verification.message,
      verification.code === "signature_rejected" ? 401 : 400,
      verification.code,
    );
  }

  // The nonce is spent only once the signature has checked out. A rejected paste
  // leaves the statement signable, so a typo does not send someone back to their
  // wallet, while a proof that succeeds burns the nonce and cannot be replayed.
  if (!nonceStore.consume(verification.statement.nonce)) {
    return fail(
      "That statement's nonce is unknown, already used, or expired. Ask for a fresh statement and sign that one.",
      409,
      "nonce_rejected",
    );
  }

  proofStore.record(sessionKey(session), verification.proof);
  return ok({ proof: verification.proof });
}

/** The addresses this session has proved, so a reload does not lose the panel's state. */
export async function GET(request: Request) {
  const session = readSessionCookie(request);
  if (!session) return ok({ proofs: [] });
  return ok({ proofs: proofStore.list(sessionKey(session)) });
}

/** Gives a proof up without giving up the wallet session. */
export async function DELETE(request: Request) {
  const session = readSessionCookie(request);
  if (session) proofStore.revoke(sessionKey(session));
  return ok({ proofs: [] });
}
