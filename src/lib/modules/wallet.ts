/**
 * Wallet adapter (verification half).
 *
 * Private keys never reach the server. The browser wallet signs canonical
 * preimages; this module only checks that a signature belongs to the party the
 * protocol requires, and reports which capabilities an address actually has.
 *
 * Two kinds of owner exist, and each proves itself differently:
 *
 *   - A protocol-managed destination commits to an ed25519 key, so the browser
 *     signs the preimage directly.
 *   - A real transparent Zcash address commits to a secp256k1 key, so the owner
 *     signs the preimage with their own Zcash wallet's signmessage and the key
 *     is recovered from the compact signature. See protocol/tsig.ts.
 *
 * Transparent addresses used to be refused here, which made a stamp sent to
 * someone's own t-address unlistable and untransferable. That was a limit of
 * this code rather than of the protocol, and it is gone.
 *
 * The verification rule itself lives in the protocol layer so that the request
 * path and the deterministic rebuild cannot drift apart. This module only
 * decides what an address is capable of and reports it in a form the UI can use.
 */
import {
  demoAddressForKey,
  isDemoManagedAddress,
  verifyOwnerSignature,
  type SignatureCheck,
} from "../protocol";
import { checkTransparent } from "../protocol/address";
import { fromHex } from "../protocol/encoding";
import { transparentAddressForKey } from "../protocol/tsig";

export type WalletChain = "solana" | "zcash";

/** How an owner is expected to sign, so the UI can ask for the right thing. */
export type OwnerScheme = "ed25519" | "zcash-signmessage" | "none";

export interface OwnerCapability {
  /** True when the protocol can verify a signature for this address. */
  canAuthorize: boolean;
  reason: string;
  scheme: OwnerScheme;
}

export interface WalletAdapter {
  readonly kind: "demo" | "live";
  addressForKey(publicKeyHex: string): string;
  capability(address: string): OwnerCapability;
  verify(input: {
    address: string;
    publicKeyHex: string;
    preimage: string;
    signatureHex: string;
  }): SignatureCheck;
}

/** A compressed secp256k1 key is 33 bytes and starts 02 or 03; ed25519 is 32. */
function looksSecp256k1(publicKeyHex: string): boolean {
  return publicKeyHex.length === 66 && /^0[23]/.test(publicKeyHex);
}

export class DemoWalletAdapter implements WalletAdapter {
  readonly kind = "demo" as const;

  addressForKey(publicKeyHex: string): string {
    if (looksSecp256k1(publicKeyHex)) {
      return transparentAddressForKey(fromHex(publicKeyHex));
    }
    return demoAddressForKey(publicKeyHex);
  }

  capability(address: string): OwnerCapability {
    if (isDemoManagedAddress(address)) {
      return {
        canAuthorize: true,
        scheme: "ed25519",
        reason: "Protocol-managed destination with a verifiable key binding.",
      };
    }

    const check = checkTransparent(address);
    if (check.ok && check.kind === "p2pkh") {
      return {
        canAuthorize: true,
        scheme: "zcash-signmessage",
        reason:
          "Transparent address. Ownership is proved by signing with the Zcash wallet that holds it, using signmessage.",
      };
    }
    if (check.ok && check.kind === "p2sh") {
      return {
        canAuthorize: false,
        scheme: "none",
        reason:
          "Multisig address. It commits to a script rather than one key, so a signed message cannot prove control of it.",
      };
    }
    if (check.ok && check.kind === "tex") {
      return {
        canAuthorize: false,
        scheme: "none",
        reason:
          "ZIP-320 TEX address. Proving control of one is not implemented here, so ownership operations are disabled.",
      };
    }
    return {
      canAuthorize: false,
      scheme: "none",
      reason: check.message || "Unrecognised destination, so ownership cannot be proved.",
    };
  }

  verify(input: {
    address: string;
    publicKeyHex: string;
    preimage: string;
    signatureHex: string;
  }): SignatureCheck {
    const capability = this.capability(input.address);
    if (!capability.canAuthorize) {
      return { ok: false, message: capability.reason };
    }
    return verifyOwnerSignature(input);
  }
}

export const walletAdapter: WalletAdapter = new DemoWalletAdapter();
