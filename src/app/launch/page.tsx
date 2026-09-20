"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/components/Wallet";
import { Note, Panel, Tech } from "@/components/ui";
import { formatUnits } from "@/lib/format";

/**
 * Every coin here is quoted in Zcash. Verified launchable and LaunchLab-ready on
 * https://www.stonkfun.xyz/api/public/v1/pairs on 2026-09-20.
 */
const ZEC_QUOTE = {
  mint: "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS",
  symbol: "ZEC",
  name: "Zcash",
};

export default function LaunchPage() {
  const { wallet, connect } = useWallet();
  const router = useRouter();
  const [quote, setQuote] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    symbol: "",
    description: "",
    buyDisplay: "",
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

  const parameters = quote?.parameters as
    | { decimals: number; supplyDisplay: number; supplyBase: string; poolBase: string; note: string }
    | undefined;
  const costs = quote?.costs as Record<string, unknown> | undefined;

  async function onImage(file: File) {
    if (file.size > 512 * 1024) {
      setError("Image must be 512 KB or smaller.");
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
    setBusy(true);
    const res = await fetch("/api/launches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner: wallet.publicKey,
        name: form.name,
        symbol: form.symbol,
        description: form.description,
        imageDataUrl: form.imageDataUrl,
        quoteMint: ZEC_QUOTE.mint,
        buyDisplay: form.buyDisplay || undefined,
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (json.error) {
      setError(json.error.message);
      return;
    }
    router.push(`/launches/${json.data.launch.mint}`);
  }

  return (
    <div className="split">
      <Panel>
        <h1>Launch a coin</h1>
        <p className="lede muted" style={{ marginTop: 6 }}>
          Supply and decimals come from the venue&apos;s published launch path, not from you.
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
            <span className="hint">Optional. 512 KB maximum.</span>
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
            <label htmlFor="symbol">Symbol</label>
            <input
              id="symbol"
              maxLength={10}
              required
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
            />
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
            <label htmlFor="buy">Initial purchase</label>
            <input
              id="buy"
              inputMode="decimal"
              placeholder="optional"
              value={form.buyDisplay}
              onChange={(e) => setForm({ ...form, buyDisplay: e.target.value })}
            />
            <span className="hint">
              Display units of the new token. Only this purchase is yours to burn later; pool
              inventory is not credited to you.
            </span>
          </div>

          {error && (
            <Note tone="error" title="Cannot launch">
              {error}
            </Note>
          )}

          <button className="btn btn--primary" disabled={busy} type="submit">
            {wallet ? "Launch on demo ledger" : "Connect and launch"}
          </button>
        </form>
      </Panel>

      <aside className="stack">
        <Panel>
          <h2>Launch path</h2>
          <dl className="kv" style={{ marginTop: 10 }}>
            <dt>Quote asset</dt>
            <dd>
              {ZEC_QUOTE.symbol} — {ZEC_QUOTE.name}. Every coin launched here is paired against
              Zcash. Not a choice.
            </dd>
            {parameters && (
              <>
                <dt>Supply</dt>
                <dd className="num">{parameters.supplyDisplay.toLocaleString()} tokens</dd>
                <dt>Pool / curve</dt>
                <dd className="num">
                  {formatUnits(parameters.poolBase, parameters.decimals)} tokens
                </dd>
                <dt>Venue fee</dt>
                <dd>{String(costs?.launchVenue)}</dd>
                <dt>Stamppad fee</dt>
                <dd>None. This app takes no cut of a launch.</dd>
                <dt>Network cost</dt>
                <dd>{String(costs?.network)}</dd>
              </>
            )}
          </dl>
          {!parameters && (
            <p className="tiny muted" style={{ marginTop: 10 }}>
              {error
                ? "The venue did not return published parameters for the ZEC pair."
                : "Reading the published parameters for the ZEC pair…"}
            </p>
          )}
          {parameters?.note && (
            <p className="tiny dim" style={{ marginTop: 10 }}>
              {parameters.note}
            </p>
          )}
        </Panel>

        <Note tone="warn" title="Mainnet launching is off">
          The venue&apos;s paid launch endpoint returned 503 (paid launches disabled), and the
          self-build path would spend real SOL on mainnet. This screen writes to the demo ledger
          only.
        </Note>

        <Tech>
          <dl className="kv">
            <dt>Decimals</dt>
            <dd className="mono">{parameters?.decimals ?? "—"}</dd>
            <dt>Supply (base)</dt>
            <dd className="mono">{parameters?.supplyBase ?? "—"}</dd>
            <dt>Pool (base)</dt>
            <dd className="mono">{parameters?.poolBase ?? "—"}</dd>
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
