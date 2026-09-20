import type { DestNetwork } from "./types";
import { encodeBase58 } from "./encoding";
import {
  describeTransparent,
  sha256,
  validateTransparentAddress,
  type TransparentAddressCheck,
} from "./taddr";

export function validateDestination(
  network: DestNetwork,
  address: string,
): { ok: boolean; message: string } {
  if (network === "zcash:demo") {
    // The in-process ledger publishes to whatever address the burn authority
    // named. A protocol-managed `zdemo1…` destination has a verifiable key
    // binding; a real mainnet t-address does not, but it is the address the
    // person actually controls, so it is accepted and marked unverifiable
    // elsewhere rather than being replaced with something invented.
    if (/^zdemo1[0-9a-z]{20,80}$/.test(address)) {
      return { ok: true, message: "protocol-managed destination" };
    }
    const mainnet = validateTransparentAddress(address);
    if (mainnet.ok && mainnet.network === "zcash:main") {
      return { ok: true, message: describeTransparent(mainnet) };
    }
    return {
      ok: false,
      message: mainnet.ok
        ? "Use a Zcash mainnet transparent address, not a testnet one."
        : mainnet.message,
    };
  }

  const check = validateTransparentAddress(address);
  if (!check.ok) return { ok: false, message: check.message };
  if (check.network !== network) {
    return {
      ok: false,
      message: `That address is for ${check.network}, not ${network}. Use a transparent address for this network.`,
    };
  }
  return { ok: true, message: describeTransparent(check) };
}

export function checkTransparent(address: string): TransparentAddressCheck {
  return validateTransparentAddress(address);
}

export function encodeDemoDestination(suffix: string): string {
  const body = suffix
    .toLowerCase()
    .replace(/[^0-9a-z]/g, "")
    .padEnd(20, "0")
    .slice(0, 40);
  return `zdemo1${body}`;
}

export function encodeMainnetLikeTestVector(): string {
  const payload = new Uint8Array(22);
  payload.set([0x1c, 0xb8]);
  payload.fill(7, 2);
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  const full = new Uint8Array(26);
  full.set(payload);
  full.set(checksum, 22);
  return encodeBase58(full);
}
