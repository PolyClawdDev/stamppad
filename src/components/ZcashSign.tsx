"use client";

/**
 * Signing with a Zcash wallet, by hand.
 *
 * Phantom holds a Solana key, so it cannot speak for a transparent Zcash
 * address. The holder of that address signs in whatever wallet actually holds
 * it and pastes the result here. Nothing in this file touches a Zcash key: it
 * shows exact text and collects a base64 signature.
 */
import { useCallback, useEffect, useId, useState } from "react";
import { Note, Panel } from "@/components/ui";
import { validateTransparentAddress } from "@/lib/protocol/taddr";

/**
 * True when the address commits to a key its holder keeps in their own Zcash
 * wallet, so every signature for it has to be pasted rather than taken from
 * Phantom. A protocol-managed `zdemo1…` destination does not.
 */
export function signsWithZcashWallet(address: string | null | undefined): boolean {
  if (!address) return false;
  const check = validateTransparentAddress(address);
  return check.ok && check.kind === "p2pkh";
}

/**
 * A signature as `signmessage` prints it, converted to the hex the protocol's
 * signature field carries. Returns null when the paste is not base64 at all, so
 * the caller can say so before a round trip.
 */
export function signatureBase64ToHex(signatureBase64: string): string | null {
  const trimmed = signatureBase64.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  try {
    const binary = atob(trimmed);
    let hex = "";
    for (let i = 0; i < binary.length; i += 1) {
      hex += binary.charCodeAt(i).toString(16).padStart(2, "0");
    }
    return hex;
  } catch {
    return null;
  }
}

/** Shows the exact text to sign, then takes the signature back. */
export function ZcashSignForm({
  statement,
  help,
  submitLabel,
  busy = false,
  onSubmit,
  onRefresh,
}: {
  statement: string;
  help: string;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (signatureBase64: string) => void | Promise<void>;
  onRefresh?: () => void;
}) {
  const id = useId();
  const [signature, setSignature] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(statement);
      setCopied(true);
      setCopyError(null);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopyError("The browser blocked clipboard access. Select the text above to copy it.");
    }
  }

  return (
    <div className="stack-sm">
      <p className="tiny muted">{help}</p>

      <div className="field">
        <label htmlFor={`${id}-statement`}>Statement to sign</label>
        <textarea
          id={`${id}-statement`}
          className="mono"
          readOnly
          rows={10}
          value={statement}
          onFocus={(e) => e.currentTarget.select()}
        />
        <span className="hint">
          Every line is part of what you sign, blank lines included. Copy it whole.
        </span>
      </div>

      <div className="cluster">
        <button className="btn btn--sm" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy statement"}
        </button>
        {onRefresh && (
          <button className="btn btn--sm" onClick={onRefresh} disabled={busy}>
            New statement
          </button>
        )}
      </div>

      {copyError && <Note tone="quiet">{copyError}</Note>}

      <div className="field">
        <label htmlFor={`${id}-signature`}>Signature</label>
        <textarea
          id={`${id}-signature`}
          className="mono"
          rows={3}
          spellCheck={false}
          placeholder="Paste the base64 signature your wallet returned"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
        />
        <span className="hint">
          A signed message is 65 bytes, which is 88 base64 characters ending in a single equals
          sign.
        </span>
      </div>

      <button
        className="btn btn--primary btn--wide"
        disabled={busy || signature.trim().length === 0}
        onClick={() => void onSubmit(signature.trim())}
      >
        {busy ? "Checking…" : submitLabel}
      </button>
    </div>
  );
}

interface Challenge {
  statement: string;
  address: string;
}

/**
 * The one-time proof that unblocks listing a stamp held at a t-address.
 *
 * The statement is issued by the server, so the bytes shown here are the bytes
 * the server will check. It carries a single-use nonce, names this site, and
 * names the connected wallet, which is what keeps the resulting proof from being
 * replayed elsewhere or borrowed by another session.
 */
export function TransparentControlProof({
  address,
  note,
  onProven,
}: {
  address: string;
  note: string;
  onProven: () => void;
}) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const request = useCallback(async () => {
    setError(null);
    setChallenge(null);
    try {
      const res = await fetch("/api/wallet/taddr/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      setChallenge({ statement: json.data.statement, address: json.data.address });
    } catch (e) {
      setError(e instanceof Error ? e.message : "This site could not issue a statement to sign.");
    }
  }, [address]);

  useEffect(() => {
    void request();
  }, [request]);

  async function submit(signature: string) {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/taddr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, message: challenge.statement, signature }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      setDone(json.data.proof.publicKeyHex as string);
      onProven();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The signature could not be checked.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <h2>Prove you hold this address</h2>
      <p className="tiny muted" style={{ marginTop: 8 }}>
        {note}
      </p>

      {done ? (
        <Note title="Control proved">
          This session can now list stamps held at <span className="mono">{address}</span>. The key
          recovered from your signature is <span className="mono">{done.slice(0, 16)}…</span>.
          Disconnecting your wallet gives the proof up.
        </Note>
      ) : (
        <>
          {error && (
            <Note tone="error" title="Not proved">
              {error}
            </Note>
          )}
          {challenge ? (
            <div style={{ marginTop: 10 }}>
              <ZcashSignForm
                statement={challenge.statement}
                help="Sign this in whatever Zcash wallet holds the address — StampPad never sees your Zcash key."
                submitLabel="Prove control"
                busy={busy}
                onSubmit={submit}
                onRefresh={() => void request()}
              />
            </div>
          ) : (
            !error && (
              <p className="tiny dim" style={{ marginTop: 10 }}>
                Preparing a statement to sign…
              </p>
            )
          )}
        </>
      )}
    </Panel>
  );
}
