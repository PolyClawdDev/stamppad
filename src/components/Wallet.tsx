"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface Identity {
  label: string;
  /** Solana-style base58 public key used as the burn authority. */
  publicKey: string;
  publicKeyHex: string;
  /** Protocol-managed Zcash destination derived from the same key. */
  zcashAddress: string;
}

interface StoredKey {
  label: string;
  publicKey: string;
  secret: string;
}

const STORAGE = "stamp.identities";
const ACTIVE = "stamp.active";

interface WalletApi {
  wallet: Identity | null;
  identities: Identity[];
  activeIndex: number;
  ready: boolean;
  connect: () => Promise<void>;
  addIdentity: () => Promise<void>;
  select: (index: number) => void;
  disconnect: () => void;
  sign: (preimage: string, index?: number) => Promise<{ signatureHex: string; publicKeyHex: string }>;
}

const Ctx = createContext<WalletApi>({
  wallet: null,
  identities: [],
  activeIndex: 0,
  ready: false,
  connect: async () => undefined,
  addIdentity: async () => undefined,
  select: () => undefined,
  disconnect: () => undefined,
  sign: async () => ({ signatureHex: "", publicKeyHex: "" }),
});

function readKeys(): StoredKey[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE) ?? "[]") as StoredKey[];
  } catch {
    return [];
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function demoAddress(publicKeyHex: string): Promise<string> {
  const bytes = Uint8Array.from(publicKeyHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `zdemo1${toHex(digest.subarray(0, 20))}`;
}

async function toIdentity(key: StoredKey): Promise<Identity> {
  const bs58 = (await import("bs58")).default;
  const publicKeyHex = toHex(bs58.decode(key.publicKey));
  return {
    label: key.label,
    publicKey: key.publicKey,
    publicKeyHex,
    zcashAddress: await demoAddress(publicKeyHex),
  };
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [ready, setReady] = useState(false);

  const hydrate = useCallback(async () => {
    const keys = readKeys();
    setIdentities(await Promise.all(keys.map(toIdentity)));
    setActiveIndex(Number(sessionStorage.getItem(ACTIVE) ?? 0));
    setReady(true);
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const createKey = useCallback(async (label: string) => {
    const nacl = (await import("tweetnacl")).default;
    const bs58 = (await import("bs58")).default;
    const kp = nacl.sign.keyPair();
    const key: StoredKey = {
      label,
      publicKey: bs58.encode(kp.publicKey),
      secret: bs58.encode(kp.secretKey),
    };
    const keys = [...readKeys(), key];
    sessionStorage.setItem(STORAGE, JSON.stringify(keys));
    return keys.length - 1;
  }, []);

  const api = useMemo<WalletApi>(
    () => ({
      wallet: identities[activeIndex] ?? null,
      identities,
      activeIndex,
      ready,
      async connect() {
        if (readKeys().length === 0) await createKey("Wallet A");
        await hydrate();
      },
      async addIdentity() {
        const index = await createKey(`Wallet ${String.fromCharCode(65 + readKeys().length)}`);
        sessionStorage.setItem(ACTIVE, String(index));
        await hydrate();
        setActiveIndex(index);
      },
      select(index: number) {
        sessionStorage.setItem(ACTIVE, String(index));
        setActiveIndex(index);
      },
      disconnect() {
        sessionStorage.removeItem(STORAGE);
        sessionStorage.removeItem(ACTIVE);
        setIdentities([]);
        setActiveIndex(0);
      },
      async sign(preimage: string, index?: number) {
        const keys = readKeys();
        const key = keys[index ?? activeIndex];
        if (!key) throw new Error("No wallet is connected.");
        const nacl = (await import("tweetnacl")).default;
        const bs58 = (await import("bs58")).default;
        const secret = bs58.decode(key.secret);
        const signature = nacl.sign.detached(new TextEncoder().encode(preimage), secret);
        return { signatureHex: toHex(signature), publicKeyHex: toHex(bs58.decode(key.publicKey)) };
      },
    }),
    [identities, activeIndex, ready, createKey, hydrate],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useWallet() {
  return useContext(Ctx);
}

export function WalletButton() {
  const { wallet, identities, activeIndex, connect, addIdentity, select, disconnect } = useWallet();
  if (!wallet) {
    return (
      <div className="wallet">
        <button className="btn btn--sm" onClick={() => void connect()}>
          Connect wallet
        </button>
      </div>
    );
  }
  return (
    <div className="wallet">
      <select
        aria-label="Active wallet"
        value={activeIndex}
        onChange={(e) => select(Number(e.target.value))}
      >
        {identities.map((id, i) => (
          <option key={id.publicKey} value={i}>
            {id.label} · {id.publicKey.slice(0, 4)}…{id.publicKey.slice(-4)}
          </option>
        ))}
      </select>
      <button
        className="btn btn--sm"
        onClick={() => void addIdentity()}
        title="Add a second wallet to hold or buy stamps"
        aria-label="Add another wallet"
      >
        +
      </button>
      <button className="btn btn--sm" onClick={disconnect} aria-label="Disconnect wallet">
        Exit
      </button>
    </div>
  );
}
