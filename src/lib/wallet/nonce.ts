/**
 * Single-use connect nonces.
 *
 * Held in process memory, which means they do not survive a restart and are not
 * shared between instances. That is the same scope as the in-process ledger this
 * build runs on, so it is stated rather than papered over: a horizontally
 * scaled deployment would need a shared store here.
 */
import { randomBytes } from "node:crypto";

export const NONCE_TTL_MS = 5 * 60 * 1000;

export interface NonceStore {
  issue(now?: number): string;
  consume(nonce: string, now?: number): boolean;
  size(): number;
}

export function createNonceStore(options: {
  ttlMs?: number;
  random?: () => string;
} = {}): NonceStore {
  const ttlMs = options.ttlMs ?? NONCE_TTL_MS;
  const random = options.random ?? (() => randomBytes(16).toString("hex"));
  const outstanding = new Map<string, number>();

  function sweep(now: number): void {
    for (const [nonce, expiresAt] of outstanding) {
      if (expiresAt <= now) outstanding.delete(nonce);
    }
  }

  return {
    issue(now = Date.now()) {
      sweep(now);
      const nonce = random();
      outstanding.set(nonce, now + ttlMs);
      return nonce;
    },
    consume(nonce, now = Date.now()) {
      const expiresAt = outstanding.get(nonce);
      outstanding.delete(nonce);
      sweep(now);
      return expiresAt !== undefined && expiresAt > now;
    },
    size() {
      return outstanding.size;
    },
  };
}

export const nonceStore = createNonceStore();
