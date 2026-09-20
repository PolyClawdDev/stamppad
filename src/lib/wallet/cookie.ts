/**
 * The session cookie.
 *
 * It carries the verified Solana public key and the time the signature was
 * checked, authenticated with an HMAC so the browser cannot edit it into
 * somebody else's identity. Without `STAMP_SESSION_SECRET` the key is random
 * per process, so restarting the server invalidates outstanding sessions.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "stamppad_wallet";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface CookieSession {
  publicKey: string;
  verifiedAt: string;
}

let ephemeralSecret: Buffer | null = null;

export function sessionSecret(): Buffer {
  const configured = process.env.STAMP_SESSION_SECRET;
  if (configured) return Buffer.from(configured, "utf8");
  ephemeralSecret ??= randomBytes(32);
  return ephemeralSecret;
}

export function encodeSessionCookie(session: CookieSession, secret = sessionSecret()): string {
  const body = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

export function decodeSessionCookie(
  value: string | undefined,
  options: { secret?: Buffer; now?: number; ttlMs?: number } = {},
): CookieSession | null {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = mac(body, options.secret ?? sessionSecret());
  if (!equal(signature, expected)) return null;
  let session: CookieSession;
  try {
    session = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CookieSession;
  } catch {
    return null;
  }
  if (typeof session?.publicKey !== "string" || typeof session?.verifiedAt !== "string") return null;
  const issued = Date.parse(session.verifiedAt);
  const now = options.now ?? Date.now();
  if (!Number.isFinite(issued) || now - issued > (options.ttlMs ?? SESSION_TTL_MS)) return null;
  return session;
}

export function setCookieHeader(value: string, maxAgeSeconds: number): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function clearCookieHeader(): string {
  return setCookieHeader("", 0);
}

export function readSessionCookie(request: Request): CookieSession | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeSessionCookie(rest.join("="));
  }
  return null;
}

function mac(body: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
