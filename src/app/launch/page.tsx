"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet, walletStateLine } from "@/components/Wallet";
import { Note, Panel, Tech } from "@/components/ui";
import { ARTWORK_MAX_BYTES, ARTWORK_MAX_LABEL } from "@/lib/artwork";
import { formatUnits } from "@/lib/format";
import { describeTransparent, validateTransparentAddress } from "@/lib/protocol/taddr";

/**
 * Issuing a stamp launches a ZEC-paired token on the venue and burns the whole
 * creator allocation into the inscription. The token is machinery, so it is
 * described under technical details rather than in the flow.
 *
 * Verified launchable and LaunchLab-ready on
 * https://www.stonkfun.xyz/api/public/v1/pairs on 2026-09-20.
 */
const ZEC_QUOTE = {
  mint: "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS",
  symbol: "ZEC",
  name: "Zcash",
};

type Step = "idle" | "issuing" | "stamping";

export default function IssuePage() {
  const { wallet, phase, connect, zcashDestination, setZcashDestination } = useWallet();
  const router = useRouter();
  const [quote, setQuote] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [touchedDestination, setTouchedDestination] = useState(false);
  const [form, setForm] = useState({
    name: "",
    symbol: "",
    description: "",
    denomination: "",
    destination: "",
    imageDataUrl: "" as string | null,
  });

  useEffect(() => {
    void fetch("/api/pairs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteMint: ZEC_QUOTE.mint }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setError(j.error.message);
        else {
          setError(null);
          setQuote(j.data);
        }
      });
  }, []);

  useEffect(() => {
    if (!touchedDestination && zcashDestination) {
      setForm((f) => ({ ...f, destination: zcashDestination }));
    }
  }, [zcashDestination, touchedDestination]);

  const parameters = quote?.parameters as
    | { decimals: number; supplyDisplay: number; supplyBase: string; poolBase: string; note: string }
    | undefined;
  const costs = quote?.costs as Record<string, unknown> | undefined;

  const destinationCheck = useMemo(
    () => (form.destination ? validateTransparentAddress(form.destination) : null),
    [form.destination],
  );
  const destinationReady = Boolean(
    destinationCheck?.ok && destinationCheck.network === "zcash:main",
  );

  async function onImage(file: File) {
    if (file.size > ARTWORK_MAX_BYTES) {
      setError(`Artwork must be ${ARTWORK_MAX_LABEL} or smaller.`);
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setForm((f) => ({ ...f, imageDataUrl: dataUrl }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!wallet) {
      await connect();
      return;
    }

    setStep("issuing");
    const launchRes = await fetch("/api/launches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner: wallet.publicKey,
        name: form.name,
        symbol: form.symbol,
        description: form.description,
        imageDataUrl: form.imageDataUrl,
        quoteMint: ZEC_QUOTE.mint,
        buyDisplay: form.denomination,
      }),
    });
    const launched = await launchRes.json();
    if (launched.error) {
      setStep("idle");
      setError(launched.error.message);
      return;
    }

    // The allocation exists only now, so the burn is a second call.
    setStep("stamping");
    const stampRes = await fetch("/api/convert/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mint: launched.data.launch.mint,
        owner: wallet.publicKey,
        amountDisplay: form.denomination,
        destination: form.destination,
      }),
    });
    const stamped = await stampRes.json();
    if (stamped.error) {
      setStep("idle");
      setError(
        `${stamped.error.message} The token was created, so you can finish this from Convert.`,
      );
      return;
    }

    setZcashDestination(form.destination);
    router.push(`/jobs/${stamped.data.job.id}`);
  }

  const busy = step !== "idle";
  const ready = Boolean(wallet) && destinationReady && form.denomination.trim().length > 0;

  return (
    <div className="split">
      <Panel>
        <h1>Launch a stamp</h1>
        <p className="lede muted" style={{ marginTop: 6 }}>
          A stamp carries the artwork, name and ticker you give it, and records the exact
          denomination it represents. One stamp, one owner, one amount.
        </p>

        <form style={{ marginTop: 16 }} onSubmit={(e) => void submit(e)}>
          <div className="field">
            <label htmlFor="img">Artwork</label>
            <input
              id="img"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onImage(file);
              }}
            />
            <span className="hint">
              Optional, {ARTWORK_MAX_LABEL} maximum. This is the face of the stamp. Without one it
              gets generated pixel art.
            </span>
          </div>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              maxLength={32}
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="symbol">Ticker</label>
            <input
              id="symbol"
              maxLength={10}
              required
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
            />
            <span className="hint">Shown on the stamp beside its denomination.</span>
          </div>
          <div className="field">
            <label htmlFor="desc">Description</label>
            <textarea
              id="desc"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="denomination">Denomination</label>
            <input
              id="denomination"
              inputMode="decimal"
              required
              value={form.denomination}
              onChange={(e) => setForm({ ...form, denomination: e.target.value })}
            />
            <span className="hint">
              The quantity this stamp represents. It is destroyed permanently to cut the stamp and
              cannot be redeemed.
            </span>
          </div>
          <div className="field">
            <label htmlFor="destination">Zcash address</label>
            <input
              id="destination"
              className="mono"
              placeholder="t1…"
              autoComplete="off"
              spellCheck={false}
              required
              value={form.destination}
              onChange={(e) => {
                setTouchedDestination(true);
                setForm({ ...form, destination: e.target.value.trim() });
              }}
            />
            <span className="hint">
              Where the stamp is delivered. A transparent address you control, since the
              inscription is transparent.
            </span>
            {destinationCheck && (
              <span className="hint">
                {destinationReady
                  ? `Checksum valid — ${describeTransparent(destinationCheck)}.`
                  : destinationCheck.ok
                    ? "That is a testnet address. Use a Zcash mainnet transparent address."
                    : destinationCheck.message}
              </span>
            )}
            <span className="hint">
              This build cannot prove control of an outside transparent address, so check it
              carefully. A stamp delivered to the wrong address cannot be recovered.
            </span>
          </div>

          {error && (
            <Note tone="error" title="Cannot issue">
              {error}
            </Note>
          )}

          <button className="btn btn--primary" disabled={busy || (Boolean(wallet) && !ready)} type="submit">
            {!wallet
              ? "Connect Phantom and launch"
              : step === "issuing"
                ? "Creating…"
                : step === "stamping"
                  ? "Cutting the stamp…"
                  : "Launch stamp"}
          </button>
          {!wallet && (
            <p className="tiny muted" style={{ marginTop: 8 }}>
              {walletStateLine(phase)}
            </p>
          )}
        </form>
      </Panel>

      <aside className="stack">
        <Panel>
          <h2>What you get</h2>
          <ol className="howto" style={{ marginTop: 10 }}>
            <li>A stamp on Zcash carrying your artwork, name and ticker.</li>
            <li>An inscription recording the exact denomination, destroyed to cut it.</li>
            <li>An asset you can hold, send, or sell whole for ZEC.</li>
          </ol>
          {parameters && (
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Priced in</dt>
              <dd>
                {ZEC_QUOTE.symbol} — {ZEC_QUOTE.name}. Not a choice.
              </dd>
              <dt>Venue fee</dt>
              <dd>{String(costs?.launchVenue)}</dd>
              <dt>StampPad fee</dt>
              <dd>None. This app takes no cut.</dd>
              <dt>Network cost</dt>
              <dd>{String(costs?.network)}</dd>
            </dl>
          )}
          {!parameters && (
            <p className="tiny muted" style={{ marginTop: 10 }}>
              {error
                ? "The venue did not return published parameters for the ZEC pair."
                : "Reading the published parameters…"}
            </p>
          )}
        </Panel>

        <Panel tone="ink">
          <h2>What a stamp is not</h2>
          <ul className="tiny" style={{ marginTop: 8 }}>
            <li>Not a wrapper. Nothing is held in reserve.</li>
            <li>Not redeemable. Matching quantity is not price parity.</li>
            <li>Not shielded. Stamps are transparent Zcash inscriptions.</li>
            <li>Not a future shielded asset. Migration is disabled and unverified.</li>
          </ul>
        </Panel>

        <Panel>
          <h2>How a launch runs</h2>
          <ol className="howto" style={{ marginTop: 10 }}>
            <li>You authorize the burn and name the destination.</li>
            <li>The burn must finalize on Solana before anything is published.</li>
            <li>The inscription is published to Zcash and then confirmed.</li>
          </ol>
          <p className="tiny dim" style={{ marginTop: 10 }}>
            The two chains are not atomic. A finalized burn can sit waiting for publication; the
            job page shows exactly where it is.
          </p>
        </Panel>

        <Note tone="warn" title="Mainnet launching is off">
          The venue&apos;s paid launch endpoint returned 503, and the self-build path would spend
          real SOL on mainnet. Live burns are disabled too, so the burn and the inscription are
          recorded on this deployment&apos;s in-process ledger, not on Solana mainnet or the Zcash
          chain. The destination you name is carried through unchanged.
        </Note>

        <Tech>
          <p className="tiny muted">
            Under the stamp: issuing creates a ZEC-paired token on the venue and burns your whole
            allocation into the inscription. Supply and decimals come from the venue&apos;s
            published launch path, not from you.
          </p>
          <dl className="kv" style={{ marginTop: 10 }}>
            <dt>Decimals</dt>
            <dd className="mono">{parameters?.decimals ?? "—"}</dd>
            <dt>Supply (base)</dt>
            <dd className="mono">{parameters?.supplyBase ?? "—"}</dd>
            <dt>Pool (base)</dt>
            <dd className="mono">
              {parameters ? formatUnits(parameters.poolBase, parameters.decimals) : "—"}
            </dd>
            <dt>Quote mint</dt>
            <dd className="mono">{ZEC_QUOTE.mint}</dd>
            <dt>Pairs source</dt>
            <dd className="mono">{(quote?.pairSource as string) || "—"}</dd>
          </dl>
        </Tech>
      </aside>
    </div>
  );
}
