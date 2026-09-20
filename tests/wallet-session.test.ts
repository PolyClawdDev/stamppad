/**
 * The connect flow, driven by a fake injected provider holding real ed25519
 * keys. A browser extension cannot be automated here, so the fake stands in for
 * Phantom while everything downstream of it — the statement, the nonce, the
 * tweetnacl verification and the session cookie — is the production code.
 */
import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { POST as issueNonce } from "../src/app/api/wallet/nonce/route";
import {
  DELETE as endSession,
  GET as readSession,
  POST as proveSession,
} from "../src/app/api/wallet/session/route";
import { ConnectError, connectPhantom, type ConnectDeps } from "../src/lib/wallet/connect";
import {
  decodeSessionCookie,
  encodeSessionCookie,
  SESSION_COOKIE,
} from "../src/lib/wallet/cookie";
import { createNonceStore } from "../src/lib/wallet/nonce";
import {
  detectPhantom,
  isUserRejection,
  keyTextOf,
  readSignature,
  type PhantomEvent,
  type PhantomProvider,
} from "../src/lib/wallet/provider";
import {
  buildSessionMessage,
  parseSessionMessage,
  toHex,
  truncateKey,
  verifySessionProof,
  type SessionProof,
  type VerifiedSession,
} from "../src/lib/wallet/session";

const DOMAIN = "127.0.0.1:3477";
const ORIGIN = `http://${DOMAIN}`;

interface FakeOptions {
  trusted?: boolean;
  rejectConnect?: boolean;
  rejectSign?: boolean;
  /** Some provider builds resolve signMessage to the bare signature. */
  bareSignature?: boolean;
  signWith?: nacl.SignKeyPair;
}

class FakePhantom implements PhantomProvider {
  readonly isPhantom = true;
  publicKey: { toString(): string } | null = null;
  isConnected = false;
  lastSigned: string | null = null;
  private readonly handlers = new Map<PhantomEvent, Array<(payload?: unknown) => void>>();

  constructor(
    readonly keypair: nacl.SignKeyPair,
    private readonly options: FakeOptions = {},
  ) {}

  get base58(): string {
    return bs58.encode(this.keypair.publicKey);
  }

  async connect(options?: { onlyIfTrusted?: boolean }) {
    if (options?.onlyIfTrusted && !this.options.trusted) {
      throw rejection("User rejected the request.");
    }
    if (this.options.rejectConnect) throw rejection("User rejected the request.");
    this.isConnected = true;
    const text = this.base58;
    this.publicKey = { toString: () => text };
    return { publicKey: this.publicKey };
  }

  async disconnect() {
    this.isConnected = false;
    this.publicKey = null;
  }

  async signMessage(message: Uint8Array) {
    if (this.options.rejectSign) throw rejection("User rejected the request.");
    this.lastSigned = new TextDecoder().decode(message);
    const secret = (this.options.signWith ?? this.keypair).secretKey;
    const signature = nacl.sign.detached(message, secret);
    return this.options.bareSignature ? signature : { signature, publicKey: this.publicKey! };
  }

  on(event: PhantomEvent, handler: (payload?: unknown) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  off(event: PhantomEvent, handler: (payload?: unknown) => void) {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== handler));
  }

  emit(event: PhantomEvent, payload?: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }

  listenerCount(event: PhantomEvent): number {
    return (this.handlers.get(event) ?? []).length;
  }
}

function rejection(message: string): Error {
  return Object.assign(new Error(message), { code: 4001 });
}

function request(path: string, body?: unknown, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: body === undefined ? "POST" : "POST",
    headers: {
      host: DOMAIN,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Wires connectPhantom to the real route handlers over fabricated requests. */
function routedDeps(provider: PhantomProvider): {
  deps: ConnectDeps;
  cookie: () => string | undefined;
} {
  let cookie: string | undefined;
  return {
    cookie: () => cookie,
    deps: {
      provider,
      requestNonce: async () => {
        const json = await (await issueNonce(request("/api/wallet/nonce"))).json();
        return json.data;
      },
      verify: async (proof: SessionProof): Promise<VerifiedSession> => {
        const response = await proveSession(request("/api/wallet/session", proof));
        const json = await response.json();
        if (json.error) throw new Error(json.error.message);
        cookie = response.headers.get("set-cookie")?.split(";")[0];
        return json.data.session;
      },
    },
  };
}

describe("phantom detection", () => {
  const provider = { isPhantom: true } as PhantomProvider;

  it("prefers the namespaced provider", () => {
    expect(detectPhantom({ phantom: { solana: provider } })).toBe(provider);
  });

  it("accepts window.solana only when it says it is Phantom", () => {
    expect(detectPhantom({ solana: provider })).toBe(provider);
    expect(detectPhantom({ solana: { isPhantom: false } as PhantomProvider })).toBeNull();
    expect(detectPhantom(undefined)).toBeNull();
  });

  it("reads a public key from either an object or a bare string", () => {
    expect(keyTextOf("abc")).toBe("abc");
    expect(keyTextOf({ toBase58: () => "xyz", toString: () => "xyz" })).toBe("xyz");
    expect(keyTextOf(null)).toBeNull();
  });

  it("recognises the wallet rejection code", () => {
    expect(isUserRejection(rejection("nope"))).toBe(true);
    expect(isUserRejection(new Error("rpc timeout"))).toBe(false);
  });
});

describe("connecting through a fake provider", () => {
  it("adopts the wallet's real public key after the server verifies the signature", async () => {
    const phantom = new FakePhantom(nacl.sign.keyPair());
    const { deps, cookie } = routedDeps(phantom);

    const session = await connectPhantom(deps);

    expect(session?.publicKey).toBe(phantom.base58);
    expect(session?.publicKeyHex).toBe(toHex(phantom.keypair.publicKey));

    const statement = parseSessionMessage(phantom.lastSigned!);
    expect(statement?.domain).toBe(DOMAIN);
    expect(statement?.publicKey).toBe(phantom.base58);
    expect(statement?.nonce).toMatch(/^[0-9a-f]{32}$/);

    const restored = await (await readSession(request("/api/wallet/session", undefined, cookie()))).json();
    expect(restored.data.session.publicKey).toBe(phantom.base58);
  });

  it("accepts a provider that resolves signMessage to a bare signature", async () => {
    const phantom = new FakePhantom(nacl.sign.keyPair(), { bareSignature: true });
    const session = await connectPhantom(routedDeps(phantom).deps);
    expect(session?.publicKey).toBe(phantom.base58);
  });

  it("refuses a second use of the same nonce", async () => {
    const phantom = new FakePhantom(nacl.sign.keyPair());
    const { deps } = routedDeps(phantom);
    await connectPhantom(deps);
    const replay: SessionProof = {
      publicKey: phantom.base58,
      message: phantom.lastSigned!,
      signature: bs58.encode(
        nacl.sign.detached(new TextEncoder().encode(phantom.lastSigned!), phantom.keypair.secretKey),
      ),
    };
    const json = await (await proveSession(request("/api/wallet/session", replay))).json();
    expect(json.error.message).toMatch(/already used|unknown/i);
  });

  it("rejects a signature made by a different key", async () => {
    const phantom = new FakePhantom(nacl.sign.keyPair(), { signWith: nacl.sign.keyPair() });
    await expect(connectPhantom(routedDeps(phantom).deps)).rejects.toMatchObject({
      kind: "verification_failed",
    });
  });

  it("reports a declined connection without claiming a session", async () => {
    const phantom = new FakePhantom(nacl.sign.keyPair(), { rejectConnect: true });
    const error = await connectPhantom(routedDeps(phantom).deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).kind).toBe("rejected");
    expect((error as ConnectError).message).toMatch(/declined/i);
  });

  it("reports a declined signature separately from a declined connection", async () => {
    const phantom = new FakePhantom(nacl.sign.keyPair(), { rejectSign: true });
    const error = await connectPhantom(routedDeps(phantom).deps).catch((e: unknown) => e);
    expect((error as ConnectError).kind).toBe("signature_rejected");
  });

  it("stays silent when an eager reconnect finds no standing approval", async () => {
    const phantom = new FakePhantom(nacl.sign.keyPair(), { trusted: false });
    await expect(connectPhantom(routedDeps(phantom).deps, { onlyIfTrusted: true })).resolves.toBeNull();
    expect(phantom.lastSigned).toBeNull();
  });

  it("proceeds when Phantom reports the site is already trusted", async () => {
    const phantom = new FakePhantom(nacl.sign.keyPair(), { trusted: true });
    const session = await connectPhantom(routedDeps(phantom).deps, { onlyIfTrusted: true });
    expect(session?.publicKey).toBe(phantom.base58);
  });

  it("drops its event listeners when unsubscribed", () => {
    const phantom = new FakePhantom(nacl.sign.keyPair());
    const handler = () => undefined;
    phantom.on("accountChanged", handler);
    expect(phantom.listenerCount("accountChanged")).toBe(1);
    phantom.off("accountChanged", handler);
    expect(phantom.listenerCount("accountChanged")).toBe(0);
  });
});

describe("statement verification", () => {
  const keypair = nacl.sign.keyPair();
  const publicKey = bs58.encode(keypair.publicKey);

  function sign(message: string): SessionProof {
    return {
      publicKey,
      message,
      signature: bs58.encode(
        nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey),
      ),
    };
  }

  const base = {
    domain: DOMAIN,
    publicKey,
    nonce: "ab".repeat(16),
    issuedAt: "2026-09-21T00:00:00.000Z",
  };
  const now = new Date("2026-09-21T00:00:30.000Z");

  it("round-trips the human-readable statement", () => {
    const message = buildSessionMessage(base);
    expect(message).toContain("StampPad wants to check that you control this wallet.");
    expect(message).toContain("no SOL is spent");
    expect(parseSessionMessage(message)).toEqual(base);
  });

  it("verifies a signature over the exact statement bytes", () => {
    const result = verifySessionProof({
      proof: sign(buildSessionMessage(base)),
      expectedDomain: DOMAIN,
      expectedNonce: base.nonce,
      now,
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("refuses a statement naming another site", () => {
    const result = verifySessionProof({
      proof: sign(buildSessionMessage({ ...base, domain: "phishing.example" })),
      expectedDomain: DOMAIN,
      expectedNonce: base.nonce,
      now,
    });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.message).toContain("phishing.example");
  });

  it("refuses a statement carrying a different nonce", () => {
    const result = verifySessionProof({
      proof: sign(buildSessionMessage({ ...base, nonce: "cd".repeat(16) })),
      expectedDomain: DOMAIN,
      expectedNonce: base.nonce,
      now,
    });
    expect(result.ok ? "" : result.message).toMatch(/different nonce/);
  });

  it("refuses a stale statement", () => {
    const result = verifySessionProof({
      proof: sign(buildSessionMessage(base)),
      expectedDomain: DOMAIN,
      expectedNonce: base.nonce,
      now: new Date("2026-09-21T01:00:00.000Z"),
    });
    expect(result.ok ? "" : result.message).toMatch(/expired/);
  });

  it("refuses a message whose text was edited after signing", () => {
    const proof = sign(buildSessionMessage(base));
    const tampered = { ...proof, message: proof.message.replace("Site:", "Site :") };
    expect(
      verifySessionProof({
        proof: tampered,
        expectedDomain: DOMAIN,
        expectedNonce: base.nonce,
        now,
      }),
    ).toMatchObject({ ok: false });
  });

  it("refuses a proof presented on behalf of another wallet", () => {
    const proof = sign(buildSessionMessage(base));
    const other = bs58.encode(nacl.sign.keyPair().publicKey);
    const result = verifySessionProof({
      proof: { ...proof, publicKey: other },
      expectedDomain: DOMAIN,
      expectedNonce: base.nonce,
      now,
    });
    expect(result.ok ? "" : result.message).toMatch(/different wallet/);
  });

  it("truncates keys for display without losing the ends", () => {
    expect(truncateKey(publicKey)).toBe(`${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`);
    expect(truncateKey("short")).toBe("short");
  });

  it("reads a detached signature out of either provider shape", () => {
    const signature = nacl.sign.detached(new TextEncoder().encode("x"), keypair.secretKey);
    expect(readSignature(signature)).toBe(signature);
    expect(readSignature({ signature })).toBe(signature);
    expect(() => readSignature({} as never)).toThrow(/unrecognised/);
  });
});

describe("nonces and the session cookie", () => {
  it("issues single-use nonces that expire", () => {
    const store = createNonceStore({ ttlMs: 1000, random: (() => {
      let n = 0;
      return () => `nonce${n++}`;
    })() });
    const nonce = store.issue(0);
    expect(store.consume(nonce, 500)).toBe(true);
    expect(store.consume(nonce, 500)).toBe(false);
    expect(store.consume(store.issue(0), 2000)).toBe(false);
    expect(store.consume("never-issued", 0)).toBe(false);
  });

  it("authenticates the cookie it writes", () => {
    const session = { publicKey: "abc", verifiedAt: new Date().toISOString() };
    const value = encodeSessionCookie(session);
    expect(decodeSessionCookie(value)).toEqual(session);
    const [body] = value.split(".");
    expect(decodeSessionCookie(`${body}.forged`)).toBeNull();
    expect(decodeSessionCookie(undefined)).toBeNull();
  });

  it("expires a cookie older than its lifetime", () => {
    const value = encodeSessionCookie({
      publicKey: "abc",
      verifiedAt: new Date(Date.parse("2026-09-01T00:00:00.000Z")).toISOString(),
    });
    expect(decodeSessionCookie(value, { now: Date.parse("2026-09-21T00:00:00.000Z") })).toBeNull();
  });

  it("clears the cookie on disconnect", async () => {
    const response = await endSession();
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
    expect((await response.json()).data.session).toBeNull();
  });
});
