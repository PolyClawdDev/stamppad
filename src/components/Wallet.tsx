"use client";

/**
 * Phantom, connected through the injected provider.
 *
 * No keys are generated here and no identity is invented: the app's identity is
 * the Solana public key Phantom reports, and it is only adopted after the wallet
 * signs a statement that the server verifies. The provider can be supplied as a
 * prop so the flow can be exercised without a browser extension.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ConnectError, connectPhantom, type NonceGrant } from "@/lib/wallet/connect";
import { readDestination, writeDestination } from "@/lib/wallet/destination";
import {
  PHANTOM_SITE,
  detectPhantom,
  isUserRejection,
  keyTextOf,
  publicKeyOf,
  readSendResult,
  readSignature,
  subscribe,
  type PhantomProvider,
  type PhantomWindow,
} from "@/lib/wallet/provider";
import { toHex, truncateKey, type SessionProof, type VerifiedSession } from "@/lib/wallet/session";

export type WalletPhase =
  | "detecting"
  | "unavailable"
  | "disconnected"
  | "connecting"
  | "verifying"
  | "unverified"
  | "connected";

export type Identity = VerifiedSession;

interface WalletApi {
  phase: WalletPhase;
  /** True once we know whether Phantom is in this browser. */
  ready: boolean;
  installed: boolean;
  /** The verified wallet, or null until a signature has been checked. */
  wallet: Identity | null;
  /** Phantom's selected account, which may not be verified yet. */
  account: string | null;
  notice: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sign: (preimage: string) => Promise<{ signatureHex: string; publicKeyHex: string }>;
  /**
   * Approves and broadcasts a transaction this app built. Real money moves
   * here, and only after the user approves it in Phantom's own window.
   */
  sendTransaction: (transactionBase64: string) => Promise<string>;
  /** Zcash t-address this wallet last used, remembered locally. */
  zcashDestination: string | null;
  setZcashDestination: (address: string | null) => void;
}

const Ctx = createContext<WalletApi>({
  phase: "detecting",
  ready: false,
  installed: false,
  wallet: null,
  account: null,
  notice: null,
  connect: async () => undefined,
  disconnect: async () => undefined,
  sign: async () => {
    throw new Error("No wallet is connected.");
  },
  sendTransaction: async () => {
    throw new Error("No wallet is connected.");
  },
  zcashDestination: null,
  setZcashDestination: () => undefined,
});

async function requestNonce(): Promise<NonceGrant> {
  const res = await fetch("/api/wallet/nonce", { method: "POST" });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? "This site could not issue a connect nonce.");
  }
  return { nonce: json.data.nonce as string, domain: json.data.domain as string };
}

async function verifyProof(proof: SessionProof): Promise<VerifiedSession> {
  const res = await fetch("/api/wallet/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(proof),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? "The signature could not be verified.");
  }
  return json.data.session as VerifiedSession;
}

async function readServerSession(): Promise<VerifiedSession | null> {
  try {
    const json = await (await fetch("/api/wallet/session")).json();
    return (json.data?.session as VerifiedSession | null) ?? null;
  } catch {
    return null;
  }
}

function dropServerSession(): void {
  void fetch("/api/wallet/session", { method: "DELETE" }).catch(() => undefined);
}

export function WalletProvider({
  children,
  provider: injected,
}: {
  children: React.ReactNode;
  provider?: PhantomProvider | null;
}) {
  const [provider, setProvider] = useState<PhantomProvider | null>(injected ?? null);
  const [ready, setReady] = useState(injected !== undefined);
  const [account, setAccount] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Identity | null>(null);
  const [busy, setBusy] = useState<"connecting" | "verifying" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [zcashDestination, setDestination] = useState<string | null>(null);

  // Phantom usually injects before hydration, but it can arrive late and
  // announces itself when it does.
  useEffect(() => {
    if (injected !== undefined) {
      setProvider(injected);
      setReady(true);
      return;
    }
    let done = false;
    const find = () => {
      if (done) return true;
      const found = detectPhantom(window as unknown as PhantomWindow);
      if (!found) return false;
      done = true;
      setProvider(found);
      setReady(true);
      return true;
    };
    if (find()) return;
    const onInjected = () => void find();
    window.addEventListener("phantom#initialized", onInjected);
    const timer = window.setTimeout(() => {
      if (!find()) setReady(true);
    }, 800);
    return () => {
      window.removeEventListener("phantom#initialized", onInjected);
      window.clearTimeout(timer);
    };
  }, [injected]);

  // Eager reconnect: silent, and only when Phantom already trusts this site and
  // the server still holds a session for that same account.
  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    void (async () => {
      const trusted = await provider
        .connect({ onlyIfTrusted: true })
        .then(() => publicKeyOf(provider))
        .catch(() => null);
      const session = await readServerSession();
      if (cancelled) return;
      if (!trusted) {
        if (session) dropServerSession();
        return;
      }
      setAccount(trusted);
      if (session?.publicKey === trusted) setWallet(session);
      else if (session) dropServerSession();
    })();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  useEffect(() => {
    if (!provider) return;
    const offConnect = subscribe(provider, "connect", () => {
      const key = publicKeyOf(provider);
      if (key) setAccount(key);
    });
    const offDisconnect = subscribe(provider, "disconnect", () => {
      setAccount(null);
      setWallet(null);
      setNotice("Phantom disconnected this site.");
      dropServerSession();
    });
    const offChanged = subscribe(provider, "accountChanged", (payload) => {
      const next = keyTextOf(payload) ?? publicKeyOf(provider);
      dropServerSession();
      setWallet(null);
      setAccount(next);
      setNotice(
        next
          ? `Phantom switched to ${truncateKey(next)}. Prove ownership of that account to use it here.`
          : "Phantom has no account selected for this site.",
      );
    });
    return () => {
      offConnect();
      offDisconnect();
      offChanged();
    };
  }, [provider]);

  useEffect(() => {
    setDestination(wallet ? readDestination(wallet.publicKey, window.localStorage) : null);
  }, [wallet]);

  const connect = useCallback(async () => {
    if (!provider) {
      setNotice("Phantom isn't in this browser. StampPad signs with your Phantom key.");
      return;
    }
    setNotice(null);
    setBusy("connecting");
    try {
      const session = await connectPhantom({
        provider,
        requestNonce,
        verify: async (proof) => {
          setBusy("verifying");
          return verifyProof(proof);
        },
      });
      if (session) {
        setWallet(session);
        setAccount(session.publicKey);
      }
    } catch (error) {
      setWallet(null);
      setNotice(
        error instanceof ConnectError || error instanceof Error
          ? error.message
          : "Phantom could not complete the connection.",
      );
    } finally {
      setBusy(null);
    }
  }, [provider]);

  const disconnect = useCallback(async () => {
    try {
      await provider?.disconnect();
    } catch {
      /* Phantom may already consider the site disconnected. */
    }
    dropServerSession();
    setWallet(null);
    setAccount(null);
    setNotice(null);
  }, [provider]);

  const sign = useCallback(
    async (preimage: string) => {
      if (!provider || !wallet) {
        throw new Error("Connect Phantom and prove ownership before signing.");
      }
      try {
        const signature = readSignature(
          await provider.signMessage(new TextEncoder().encode(preimage), "utf8"),
        );
        return { signatureHex: toHex(signature), publicKeyHex: wallet.publicKeyHex };
      } catch (error) {
        if (isUserRejection(error)) throw new Error("You declined the signature in Phantom.");
        throw error;
      }
    },
    [provider, wallet],
  );

  /**
   * Hands a transaction this app built to Phantom to approve and broadcast.
   *
   * The transaction arrives already carrying any signature it needed from a
   * key that is not the user's, so it is deserialized without verifying
   * signatures; the user's is the one still missing. web3.js is imported here
   * rather than at the top of the module so the wallet context does not pull it
   * into every page that only needs to know who is connected.
   */
  const sendTransaction = useCallback(
    async (transactionBase64: string) => {
      if (!provider || !wallet) {
        throw new Error("Connect Phantom and prove ownership before approving a transaction.");
      }
      if (!provider.signAndSendTransaction) {
        throw new Error(
          "This wallet cannot send transactions. Phantom supports it; update the extension and try again.",
        );
      }
      const { Transaction, VersionedTransaction } = await import("@solana/web3.js");
      const bytes = Buffer.from(transactionBase64, "base64");
      let transaction: InstanceType<typeof Transaction> | InstanceType<typeof VersionedTransaction>;
      try {
        transaction = Transaction.from(bytes);
      } catch {
        transaction = VersionedTransaction.deserialize(bytes);
      }
      try {
        return readSendResult(await provider.signAndSendTransaction(transaction));
      } catch (error) {
        if (isUserRejection(error)) throw new Error("You declined the transaction in Phantom.");
        throw error;
      }
    },
    [provider, wallet],
  );

  const setZcashDestination = useCallback(
    (address: string | null) => {
      if (!wallet) return;
      writeDestination(wallet.publicKey, address, window.localStorage);
      setDestination(address?.trim() ? address.trim() : null);
    },
    [wallet],
  );

  const phase: WalletPhase = !ready
    ? "detecting"
    : !provider
      ? "unavailable"
      : busy === "connecting"
        ? "connecting"
        : busy === "verifying"
          ? "verifying"
          : wallet
            ? "connected"
            : account
              ? "unverified"
              : "disconnected";

  const api = useMemo<WalletApi>(
    () => ({
      phase,
      ready,
      installed: Boolean(provider),
      wallet,
      account,
      notice,
      connect,
      disconnect,
      sign,
      sendTransaction,
      zcashDestination,
      setZcashDestination,
    }),
    [
      phase,
      ready,
      provider,
      wallet,
      account,
      notice,
      connect,
      disconnect,
      sign,
      sendTransaction,
      zcashDestination,
      setZcashDestination,
    ],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useWallet() {
  return useContext(Ctx);
}

/** One sentence per state, for the panels that gate on a connected wallet. */
export function walletStateLine(phase: WalletPhase): string {
  switch (phase) {
    case "detecting":
      return "Looking for Phantom in this browser.";
    case "unavailable":
      return "Phantom is not installed in this browser. StampPad signs with Phantom's Solana key, so there is no way to connect without it.";
    case "connecting":
      return "Waiting for you to approve StampPad in Phantom.";
    case "verifying":
      return "Checking the signature that proves you hold this key.";
    case "unverified":
      return "Phantom is connected but has not proved ownership of this key yet. One signature does it; nothing moves and no SOL is spent.";
    case "connected":
      return "Connected and verified.";
    default:
      return "Connect Phantom to sign with your own Solana key.";
  }
}

export function WalletButton() {
  const { phase, wallet, account, notice, connect, disconnect } = useWallet();

  return (
    <div className="wallet">
      {phase === "detecting" && (
        <button className="btn btn--sm" disabled aria-live="polite">
          Connect wallet
        </button>
      )}

      {/* A missing extension is explained on click, not made the label. */}
      {(phase === "disconnected" || phase === "unavailable") && (
        <button className="btn btn--sm" onClick={() => void connect()}>
          Connect wallet
        </button>
      )}

      {phase === "connecting" && (
        <button className="btn btn--sm" disabled aria-live="polite">
          Approve in Phantom…
        </button>
      )}

      {phase === "verifying" && (
        <button className="btn btn--sm" disabled aria-live="polite">
          Verifying signature…
        </button>
      )}

      {phase === "unverified" && (
        <>
          <span className="wallet__key mono" title={account ?? undefined}>
            {truncateKey(account ?? "")}
          </span>
          <button className="btn btn--sm" onClick={() => void connect()}>
            Prove ownership
          </button>
        </>
      )}

      {phase === "connected" && wallet && (
        <>
          <span className="wallet__key mono" title={wallet.publicKey}>
            {truncateKey(wallet.publicKey)}
          </span>
          <button
            className="btn btn--sm"
            onClick={() => void disconnect()}
            aria-label="Disconnect wallet"
          >
            Disconnect
          </button>
        </>
      )}

      {notice && (
        <p className="wallet__note tiny" role="status">
          {notice}
          {phase === "unavailable" && (
            <>
              {" "}
              <a className="linky" href={PHANTOM_SITE} target="_blank" rel="noreferrer">
                Get Phantom
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
