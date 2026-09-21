import { fail, ok } from "@/lib/http";
import { walletAdapter } from "@/lib/modules/wallet";
import { readSessionCookie } from "@/lib/wallet/cookie";
import { nonceStore } from "@/lib/wallet/nonce";
import { requestDomain } from "@/lib/wallet/origin";
import { STATEMENT_MAX_AGE_MS, buildAddressStatement } from "@/lib/wallet/taddr-proof";

/**
 * Issues the exact statement a transparent address's holder is asked to sign.
 *
 * The server builds it rather than the browser, so the bytes shown to the person
 * are the bytes this site will check. The nonce comes from the same single-use
 * store the Phantom connect statement draws on.
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

  let body: { address?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail("Expected a JSON body naming the transparent address.");
  }
  const address = body.address?.trim();
  if (!address) return fail("An address is required.");

  // A t3 multisig or a TEX address is refused here rather than after someone has
  // gone to their wallet for a signature that could never have worked.
  const capability = walletAdapter.capability(address);
  if (capability.scheme !== "zcash-signmessage") {
    return fail(capability.reason, 400, "unprovable_address");
  }

  const issuedAt = new Date().toISOString();
  const statement = {
    domain: requestDomain(request),
    walletPublicKey: session.publicKey,
    address,
    nonce: nonceStore.issue(),
    issuedAt,
  };
  return ok({
    statement: buildAddressStatement(statement),
    address,
    domain: statement.domain,
    nonce: statement.nonce,
    issuedAt,
    expiresInMs: STATEMENT_MAX_AGE_MS,
  });
}
