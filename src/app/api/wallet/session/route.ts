import { fail, ok } from "@/lib/http";
import {
  SESSION_TTL_MS,
  clearCookieHeader,
  encodeSessionCookie,
  readSessionCookie,
  setCookieHeader,
} from "@/lib/wallet/cookie";
import { nonceStore } from "@/lib/wallet/nonce";
import { requestDomain } from "@/lib/wallet/origin";
import { parseSessionMessage, toHex, verifySessionProof } from "@/lib/wallet/session";
import { proofStore, sessionKey } from "@/lib/wallet/taddr-proof";
import bs58 from "bs58";

/**
 * Establishes a session from a Phantom `signMessage` proof. The signature is an
 * ed25519 signature over the statement's UTF-8 bytes, checked with the same
 * tweetnacl verification the protocol uses for ownership authorizations.
 */
export async function POST(request: Request) {
  let body: { publicKey?: string; message?: string; signature?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail("Expected a JSON body with publicKey, message and signature.");
  }
  if (!body.publicKey || !body.message || !body.signature) {
    return fail("publicKey, message and signature are all required.");
  }

  const statement = parseSessionMessage(body.message);
  if (!statement) {
    return fail("The signed message is not StampPad's verification statement.");
  }
  if (!nonceStore.consume(statement.nonce)) {
    return fail("That connect nonce is unknown, already used, or expired. Connect again.", 409);
  }

  const verification = verifySessionProof({
    proof: { publicKey: body.publicKey, message: body.message, signature: body.signature },
    expectedDomain: requestDomain(request),
    expectedNonce: statement.nonce,
  });
  if (!verification.ok) return fail(verification.message, 401, "signature_rejected");

  const response = ok({ session: verification.session });
  response.headers.set(
    "Set-Cookie",
    setCookieHeader(
      encodeSessionCookie({
        publicKey: verification.session.publicKey,
        verifiedAt: verification.session.verifiedAt,
      }),
      Math.floor(SESSION_TTL_MS / 1000),
    ),
  );
  return response;
}

/** The session this browser already proved, if the cookie is still valid. */
export async function GET(request: Request) {
  const session = readSessionCookie(request);
  if (!session) return ok({ session: null });
  return ok({
    session: {
      publicKey: session.publicKey,
      publicKeyHex: toHex(bs58.decode(session.publicKey)),
      verifiedAt: session.verifiedAt,
    },
  });
}

/**
 * Disconnecting drops the session and everything scoped to it, including any
 * transparent-address control proofs. A proof is this session's word that it
 * holds a Zcash key, so it must not outlive the session that gave it.
 */
export async function DELETE(request: Request) {
  const session = readSessionCookie(request);
  if (session) proofStore.revoke(sessionKey(session));
  const response = ok({ session: null });
  response.headers.set("Set-Cookie", clearCookieHeader());
  return response;
}
