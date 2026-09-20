"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@/components/Wallet";
import { Loading, Note, Panel, Tech } from "@/components/ui";
import { formatUnits } from "@/lib/format";

export default function ConvertPage() {
  // useSearchParams opts the subtree out of prerendering; keep that to one child
  // so the rest of the screen still arrives in the first response.
  return (
    <Suspense
      fallback={
        <Panel>
          <Loading label="Loading convert" />
        </Panel>
      }
    >
      <Convert />
    </Suspense>
  );
}

function Convert() {
  const { wallet, connect } = useWallet();
  const router = useRouter();
  const search = useSearchParams();
  const [mint, setMint] = useState(search.get("mint") ?? "");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [touchedDestination, setTouchedDestination] = useState(false);
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (wallet && !touchedDestination) setDestination(wallet.zcashAddress);
  }, [wallet, touchedDestination]);

  useEffect(() => {
    if (!mint) return;
    const q = wallet ? `?owner=${wallet.publicKey}` : "";
    void fetch(`/api/mints/${mint}${q}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setError(j.error.message);
        else setInfo(j.data);
      });
  }, [mint, wallet]);

  // Any edit invalidates the confirmed preview, so nobody authorizes stale numbers.
  function edited<T>(setter: (value: T) => void) {
    return (value: T) => {
      setPreview(null);
      setter(value);
    };
  }

  async function doPreview() {
    if (!wallet) return connect();
    setError(null);
    const res = await fetch("/api/convert/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mint, owner: wallet.publicKey, amountDisplay: amount, destination }),
    });
    const json = await res.json();
    if (json.error) {
      setPreview(null);
      setError(json.error.message);
    } else {
      setPreview(json.data);
    }
  }

  async function submit() {
    if (!wallet) return connect();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/convert/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mint, owner: wallet.publicKey, amountDisplay: amount, destination }),
    });
    const json = await res.json();
    setBusy(false);
    if (json.error) {
      setError(json.error.message);
      return;
    }
    router.push(`/jobs/${json.data.job.id}`);
  }

  const decimals = Number(info?.decimals ?? 0);
  const symbol = String(info?.symbol ?? "");
  const managed = Boolean(wallet && destination === wallet.zcashAddress);

  return (
    <div className="split">
      <Panel>
        <h1>Convert tokens to a stamp</h1>
        <p className="lede muted" style={{ marginTop: 6 }}>
          Burning destroys supply on Solana and issues one Zcash stamp for the destroyed quantity.
        </p>

        <form
          style={{ marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            void (preview ? submit() : doPreview());
          }}
        >
          <div className="field">
            <label htmlFor="mint">Solana mint</label>
            <input
              id="mint"
              className="mono"
              value={mint}
              onChange={(e) => edited(setMint)(e.target.value.trim())}
              required
            />
            {info ? (
              info.supported ? (
                <span className="hint">
                  {symbol}
                  {wallet
                    ? ` · you hold ${formatUnits(String(info.eligibleBase ?? "0"), decimals)} ${symbol}`
                    : " · connect a wallet to see your balance"}
                </span>
              ) : (
                <span className="hint">{String(info.reason)}</span>
              )
            ) : (
              <span className="hint">Any supported, validated mint. Not every mint qualifies.</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="amount">Amount to burn</label>
            <input
              id="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => edited(setAmount)(e.target.value)}
              required
            />
            <span className="hint">In {symbol || "token"} display units.</span>
          </div>

          <div className="field">
            <label htmlFor="dest">Zcash destination</label>
            <input
              id="dest"
              className="mono"
              value={destination}
              onChange={(e) => {
                setTouchedDestination(true);
                edited(setDestination)(e.target.value.trim());
              }}
              required
            />
            <span className="hint">
              {managed
                ? "Your wallet's managed destination. Stamps sent here can be transferred or listed."
                : "An outside destination still receives a verifiable stamp, but this build cannot prove control of it, so that stamp cannot be transferred or sold."}
            </span>
          </div>

          {preview && (
            <Note tone="warn" title="This burn is permanent">
              <p>
                <strong className="num" style={{ fontSize: "1rem" }}>
                  {formatUnits(String(preview.amountBase), decimals)} {symbol}
                </strong>{" "}
                will be destroyed on Solana. Destroyed supply cannot be recovered, and the stamp you
                receive is a receipt: it is not redeemable for the burned tokens and carries no
                claim on anything.
              </p>
              <p className="tiny">{String(preview.irreversible)}</p>
            </Note>
          )}

          {error && (
            <Note tone="error" title="Cannot continue">
              {error}
            </Note>
          )}

          <div className="cluster" style={{ marginTop: 14 }}>
            <button className="btn btn--primary" disabled={busy} type="submit">
              {!wallet
                ? "Connect wallet"
                : preview
                  ? `Burn ${formatUnits(String(preview.amountBase), decimals)} ${symbol}`.trim()
                  : "Review burn"}
            </button>
            {preview && (
              <button className="btn" type="button" onClick={() => setPreview(null)}>
                Change details
              </button>
            )}
          </div>
        </form>

        {preview && (
          <div style={{ marginTop: 14 }}>
            <Tech>
              <dl className="kv">
                <dt>Base units</dt>
                <dd className="mono">{String(preview.amountBase)}</dd>
                <dt>Display units</dt>
                <dd className="mono">{String(preview.amountDisplay)}</dd>
                <dt>Decimals</dt>
                <dd className="mono">{decimals}</dd>
                <dt>Destination</dt>
                <dd className="mono">{destination}</dd>
              </dl>
            </Tech>
          </div>
        )}
      </Panel>

      <aside className="stack">
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
          <h2>How issuance runs</h2>
          <ol className="howto" style={{ marginTop: 10 }}>
            <li>You authorize the burn and name the destination.</li>
            <li>The burn must finalize on Solana before anything is published.</li>
            <li>The inscription is published to Zcash and then confirmed.</li>
          </ol>
          <p className="tiny dim" style={{ marginTop: 10 }}>
            The two chains are not atomic. A finalized burn can sit waiting for publication; the job
            page shows exactly where it is.
          </p>
        </Panel>
      </aside>
    </div>
  );
}
