/**
 * Wallet adapter (verification half).
 *
 * Private keys never reach the server. The browser wallet signs canonical
 * preimages; this module only checks that a signature belongs to the party the
 * protocol requires, and reports which capabilities an address actually has.
 */
import {
  demoAddressForKey,
  isDemoManagedAddress,
  verifyOwnerSignature,
  type SignatureCheck,
} from "../protocol";

export type WalletChain = "solana" | "zcash";

export interface OwnerCapability {
  /** True when the protocol can verify a signature for this address. */
  canAuthorize: boolean;
  reason: string;
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

export class DemoWalletAdapter implements WalletAdapter {
  readonly kind = "demo" as const;

  addressForKey(publicKeyHex: string): string {
    return demoAddressForKey(publicKeyHex);
  }

  capability(address: string): OwnerCapability {
    if (isDemoManagedAddress(address)) {
      return { canAuthorize: true, reason: "Demo destination with a verifiable key binding." };
    }
    return {
      canAuthorize: false,
      reason:
        "External transparent address. The stamp is issued and verifiable, but this build cannot prove control of the address, so it cannot be transferred or listed.",
    };
  }

  verify(input: {
    address: string;
    publicKeyHex: string;
    preimage: string;
    signatureHex: string;
  }): SignatureCheck {
    return verifyOwnerSignature(input);
  }
}

/**
 * A real adapter would bind ownership to the secp256k1 key behind a t-address
 * and verify signatures the way ZIP 320 consumers do. Not implemented, so it
 * refuses rather than degrading to the demo path.
 */
export class LiveWalletAdapter implements WalletAdapter {
  readonly kind = "live" as const;
  addressForKey(): string {
    throw new Error("Live Zcash key binding is not implemented.");
  }
  capability(): OwnerCapability {
    return {
      canAuthorize: false,
      reason: "Live t-address key binding is unverified in this build; ownership operations are disabled.",
    };
  }
  verify(): SignatureCheck {
    return { ok: false, message: "Live signature verification is not implemented." };
  }
}

export const walletAdapter: WalletAdapter = new DemoWalletAdapter();
