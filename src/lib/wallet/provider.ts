/**
 * The Phantom injected provider, described as an interface so the connect flow
 * can be driven by a fake in tests. Nothing here touches the DOM beyond the
 * window object that is handed in.
 *
 * Phantom exposes `window.phantom.solana`. Older builds and some browsers only
 * expose `window.solana`, which is only Phantom when `isPhantom` is set; other
 * wallets squat on that name.
 */

export const PHANTOM_SITE = "https://phantom.app/download";

export interface PhantomPublicKey {
  toString(): string;
  toBase58?(): string;
}

export interface PhantomSignature {
  signature: Uint8Array;
  publicKey?: PhantomPublicKey;
}

export type PhantomEvent = "connect" | "disconnect" | "accountChanged";

/**
 * A transaction Phantom will sign and broadcast. The shape is web3.js's
 * Transaction, described structurally so this module stays free of the
 * dependency and the connect flow stays drivable by a fake.
 */
export interface PhantomTransaction {
  serialize(config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }): Uint8Array;
}

export interface PhantomProvider {
  isPhantom?: boolean;
  isConnected?: boolean;
  publicKey?: PhantomPublicKey | null;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey?: PhantomPublicKey } | void>;
  disconnect(): Promise<void>;
  signMessage(
    message: Uint8Array,
    encoding?: "utf8" | "hex",
  ): Promise<PhantomSignature | Uint8Array>;
  /**
   * Adds the wallet's signature and broadcasts. Phantom keeps signatures that
   * are already on the transaction, which is what lets a launch carry the new
   * mint's signature while the creator supplies their own.
   *
   * Optional, because older Phantom builds and the test fake do not have it.
   * Absence is reported to the user rather than worked around.
   */
  signAndSendTransaction?(
    transaction: PhantomTransaction,
  ): Promise<{ signature: string } | string>;
  on(event: PhantomEvent, handler: (payload?: unknown) => void): void;
  off?(event: PhantomEvent, handler: (payload?: unknown) => void): void;
  removeListener?(event: PhantomEvent, handler: (payload?: unknown) => void): void;
}

/** Phantom returns either the object or the bare signature depending on build. */
export function readSendResult(result: { signature: string } | string): string {
  const signature = typeof result === "string" ? result : result?.signature;
  if (!signature) throw new Error("The wallet did not return a transaction signature.");
  return signature;
}

export interface PhantomWindow {
  phantom?: { solana?: PhantomProvider };
  solana?: PhantomProvider;
}

export function detectPhantom(win: PhantomWindow | undefined | null): PhantomProvider | null {
  if (!win) return null;
  const injected = win.phantom?.solana;
  if (injected) return injected;
  const legacy = win.solana;
  return legacy?.isPhantom ? legacy : null;
}

/** Phantom hands out PublicKey objects; the events hand out bare strings too. */
export function keyTextOf(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value || null;
  if (typeof value !== "object") return null;
  const key = value as PhantomPublicKey;
  const text = typeof key.toBase58 === "function" ? key.toBase58() : String(key);
  return text && text !== "null" && text !== "[object Object]" ? text : null;
}

export function publicKeyOf(provider: PhantomProvider): string | null {
  return keyTextOf(provider.publicKey);
}

export function readSignature(result: PhantomSignature | Uint8Array): Uint8Array {
  if (result instanceof Uint8Array) return result;
  if (result && result.signature instanceof Uint8Array) return result.signature;
  throw new Error("The wallet returned a signature in an unrecognised shape.");
}

/**
 * EIP-1193 style rejection code that Phantom reuses. 4001 is the user closing
 * the approval popup, which is a normal outcome rather than a failure.
 */
export function isUserRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === 4001 || code === "4001") return true;
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return message.includes("user rejected") || message.includes("user declined");
}

export function subscribe(
  provider: PhantomProvider,
  event: PhantomEvent,
  handler: (payload?: unknown) => void,
): () => void {
  provider.on(event, handler);
  return () => {
    if (provider.off) provider.off(event, handler);
    else if (provider.removeListener) provider.removeListener(event, handler);
  };
}
