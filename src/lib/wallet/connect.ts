/**
 * The connect flow, kept free of React and of the window object so it can be
 * driven end to end by a fake provider holding real ed25519 keys.
 *
 * Order of operations: Phantom approves the site, the server issues a
 * single-use nonce, Phantom signs the statement carrying that nonce, and the
 * server verifies the signature before any identity is adopted. The wallet's
 * public key only becomes the app's identity after that round trip succeeds.
 */
import bs58 from "bs58";
import {
  buildSessionMessage,
  type SessionProof,
  type VerifiedSession,
} from "./session";
import {
  isUserRejection,
  keyTextOf,
  publicKeyOf,
  readSignature,
  type PhantomProvider,
} from "./provider";

export type ConnectFailure =
  | "rejected"
  | "signature_rejected"
  | "no_account"
  | "verification_failed"
  | "provider_error";

export class ConnectError extends Error {
  readonly kind: ConnectFailure;

  constructor(kind: ConnectFailure, message: string) {
    super(message);
    this.name = "ConnectError";
    this.kind = kind;
  }
}

export interface NonceGrant {
  nonce: string;
  /** The host the server sees, named in the statement so both sides agree on it. */
  domain: string;
}

export interface ConnectDeps {
  provider: PhantomProvider;
  requestNonce: () => Promise<NonceGrant>;
  verify: (proof: SessionProof) => Promise<VerifiedSession>;
  now?: () => Date;
}

/**
 * Returns null when `onlyIfTrusted` was asked for and Phantom reports no
 * standing approval for this site. Every other unhappy path throws a
 * ConnectError carrying a sentence the UI can show as-is.
 */
export async function connectPhantom(
  deps: ConnectDeps,
  options: { onlyIfTrusted?: boolean } = {},
): Promise<VerifiedSession | null> {
  let publicKey: string | null;
  try {
    const result = await deps.provider.connect({ onlyIfTrusted: options.onlyIfTrusted });
    publicKey =
      (result && "publicKey" in result ? keyTextOf(result.publicKey) : null) ??
      publicKeyOf(deps.provider);
  } catch (error) {
    if (options.onlyIfTrusted) return null;
    if (isUserRejection(error)) {
      throw new ConnectError("rejected", "Phantom connection was declined. Nothing was shared.");
    }
    throw new ConnectError("provider_error", providerMessage(error, "Phantom could not connect."));
  }
  if (!publicKey) {
    if (options.onlyIfTrusted) return null;
    throw new ConnectError("no_account", "Phantom connected without an account selected.");
  }

  const grant = await deps.requestNonce();
  const message = buildSessionMessage({
    domain: grant.domain,
    publicKey,
    nonce: grant.nonce,
    issuedAt: (deps.now?.() ?? new Date()).toISOString(),
  });

  let signature: Uint8Array;
  try {
    signature = readSignature(
      await deps.provider.signMessage(new TextEncoder().encode(message), "utf8"),
    );
  } catch (error) {
    if (isUserRejection(error)) {
      throw new ConnectError(
        "signature_rejected",
        "The ownership signature was declined, so no session was created.",
      );
    }
    throw new ConnectError(
      "provider_error",
      providerMessage(error, "Phantom could not sign the ownership message."),
    );
  }

  try {
    return await deps.verify({ publicKey, message, signature: bs58.encode(signature) });
  } catch (error) {
    throw new ConnectError(
      "verification_failed",
      providerMessage(error, "The server could not verify that signature."),
    );
  }
}

function providerMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || fallback;
}
