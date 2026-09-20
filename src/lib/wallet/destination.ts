/**
 * The Zcash destination a person typed, remembered per connected wallet.
 *
 * Phantom holds Solana keys, not Zcash keys, so there is nothing to derive here:
 * the address is whatever the wallet owner says it is. It lives in
 * localStorage keyed by the Solana public key so switching accounts in Phantom
 * does not carry one account's destination over to another.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = "stamppad.zcash.";

function key(publicKey: string): string {
  return `${PREFIX}${publicKey}`;
}

export function readDestination(
  publicKey: string,
  storage: StorageLike | null | undefined,
): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(key(publicKey));
    return value?.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function writeDestination(
  publicKey: string,
  address: string | null,
  storage: StorageLike | null | undefined,
): void {
  if (!storage) return;
  try {
    if (address?.trim()) storage.setItem(key(publicKey), address.trim());
    else storage.removeItem(key(publicKey));
  } catch {
    /* Private browsing can refuse storage; the address is simply not remembered. */
  }
}
