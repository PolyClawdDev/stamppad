"use client";

/**
 * Stamp detail: asset header, compact statistics, chart beside the trade panel
 * on desktop and stacked on mobile.
 *
 * Every price on this page is a stamp price in ZEC. The Solana market price of
 * the burned token is never substituted for it, and an asking price is never
 * counted as a sale.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { StampArt } from "@/components/art/PixelArt";
import { PriceChart, toCandles, type ChartPoint } from "@/components/PriceChart";
import { useWallet } from "@/components/Wallet";
import { Badge, Loading, Note, Panel, Tech } from "@/components/ui";
import { formatUnits, formatZec, humanState, shortId, stampNumbers } from "@/lib/format";
import { explorerNote, zcashTxUrl } from "@/lib/explorer";

interface Sale {
  mint: string;
  collection: string;
  symbol: string;
  decimals: number;
  stampId: string;
  stampNumber: number;
  amountBase: string;
  sequence: number;
  seller: string;
  buyer: string;
  priceZat: string;
  unitPriceZat: string | null;
  txid: string;
  height: number;
  settledAt: string | null;
  simulated: boolean;
}

interface StampView {
  id: string;
  mint: string;
  amountBase: string;
  decimals: number;
  destinationNetwork: string;
  sourceTx: string;
  burnLocator: string;
  tokenProgram: string;
  burnAuthority: string;
  originalRecipient: string;
  currentOwner: string;
  sequence: number;
  transferable: boolean;
  transferabilityNote: string;
  indexNote: string;
  zcashTx: string;
  zcashHeight: number;
  zcashOutputIndex: number;
  zcashNullDataIndex: number;
  confirmations: number;
  protocol: string;
  version: number;
  history: Array<{
    sequence: number;
    from: string;
    to: string;
    txid: string;
    height: number;
    priceZat: string | null;
  }>;
  pendingOwnershipRecords: Array<{ txid: string; reason: string }>;
  rejectedOwnershipRecords: Array<{ txid: string; reason: string; message: string }>;
  listings: Array<{
    id: string;
    state: string;
    priceZat: string;
    sellerAddress: string;
    buyerAddress: string | null;
  }>;
  validation: { ok: boolean; reason: string };
}

const CLOSED = ["cancelled", "expired", "failed", "settled"];
const RANGES = [
  { id: "24h", label: "24H", ms: 24 * 3600_000 },
  { id: "7d", label: "7D", ms: 7 * 24 * 3600_000 },
  { id: "30d", label: "30D", ms: 30 * 24 * 3600_000 },
  { id: "all", label: "All", ms: Infinity },
] as const;

export default function StampDetailPage() {
  const { mint, id } = useParams<{ mint: string; id: string }>();
  const { wallet, sign, connect } = useWallet();

  const [stamp, setStamp] = useState<StampView | null>(null);
  const [collection, setCollection] = useState<{ name: string; symbol: string } | null>(null);
  const [number, setNumber] = useState<number | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [collectionSales, setCollectionSales] = useState<Sale[]>([]);
  const [simulated, setSimulated] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [priceZec, setPriceZec] = useState("0.010");
  const [scope, setScope] = useState<"stamp" | "collection">("stamp");
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("all");

  const load = useCallback(async () => {
    const [s, sale, coll, catalogue] = await Promise.all([
      fetch(`/api/stamps/${id}`).then((r) => r.json()),
      fetch(`/api/sales?mint=${mint}`).then((r) => r.json()),
      fetch(`/api/launches/${mint}`).then((r) => r.json()),
      fetch("/api/stamps").then((r) => r.json()),
    ]);
    if (s.error) return setError(s.error.message);
    setStamp(s.data);
    // Catalogue number comes from issuance order, so unsold stamps have one too.
    setNumber(stampNumbers(catalogue.data?.stamps ?? []).get(String(id)) ?? null);
    const all: Sale[] = sale.data?.sales ?? [];
    setCollectionSales(all);
    setSales(all.filter((x) => x.stampId === id));
    setSimulated(sale.data?.simulated ?? true);
    if (coll.data?.launch) {
      setCollection({ name: coll.data.launch.name, symbol: coll.data.launch.symbol });
    }
  }, [id, mint]);

  useEffect(() => {
    void load();
  }, [load]);

  const liveListing = stamp?.listings.find((l) => !CLOSED.includes(l.state)) ?? null;
  const lastSale = sales.length ? sales[sales.length - 1]! : null;
  const isOwner = Boolean(wallet && stamp && wallet.zcashAddress === stamp.currentOwner);
  const isSeller = Boolean(wallet && liveListing && wallet.zcashAddress === liveListing.sellerAddress);

  const points: ChartPoint[] = useMemo(() => {
    const source = scope === "stamp" ? sales : collectionSales;
    const cutoff = RANGES.find((r) => r.id === range)!.ms;
    const now = Date.now();
    return source
      .map((s) => {
        const t = s.settledAt ? Date.parse(s.settledAt) : s.height;
        const value =
          scope === "stamp" ? Number(s.priceZat) : Number(s.unitPriceZat ?? s.priceZat);
        return {
          t,
          value,
          label:
            scope === "stamp"
              ? `${formatZec(s.priceZat)} ZEC`
              : `${formatZec(s.unitPriceZat ?? "0")} ZEC per ${s.symbol || "unit"}`,
          sub:
            scope === "stamp"
              ? `${s.settledAt ? new Date(s.settledAt).toLocaleString() : `height ${s.height}`} · ${shortId(s.txid, 10, 4)}`
              : `No. ${s.stampNumber} · ${formatUnits(s.amountBase, s.decimals)} ${s.symbol} · ${shortId(s.txid, 8, 4)}`,
        };
      })
      .filter((p) => (cutoff === Infinity ? true : now - p.t <= cutoff))
      .sort((a, b) => a.t - b.t);
  }, [scope, range, sales, collectionSales]);

  const candles = useMemo(
    () => (scope === "collection" ? toCandles(points) : null),
    [scope, points],
  );

  async function copyId() {
    try {
      await navigator.clipboard.writeText(String(id));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("The browser blocked clipboard access. Select the identifier to copy it manually.");
    }
  }

  function zecToZat(value: string): string {
    const [whole = "0", fraction = ""] = value.trim().split(".");
    const padded = (fraction + "00000000").slice(0, 8);
    return (BigInt(whole || "0") * 100000000n + BigInt(padded || "0")).toString(10);
  }

  async function listForSale() {
    if (!wallet) return connect();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/market/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stampId: id,
          sellerAddress: wallet.zcashAddress,
          sellerPublicKeyHex: wallet.publicKeyHex,
          priceZat: zecToZat(priceZec),
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      setNotice("Listed. The sale completes step by step once a buyer reserves it.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "listing failed");
    } finally {
      setBusy(false);
    }
  }

  async function act(action: "reserve" | "cancel") {
    if (!wallet || !liveListing) return connect();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/market/listings/${liveListing.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "reserve"
            ? {
                action,
                buyerAddress: wallet.zcashAddress,
                buyerPublicKeyHex: wallet.publicKeyHex,
              }
            : { action },
        ),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      setNotice(
        action === "reserve"
          ? "Reserved for this wallet. The seller signs the offer next; the remaining steps are on the Market screen."
          : "Listing cancelled.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !stamp) {
    return (
      <Note tone="error" title="Stamp unavailable">
        {error}
      </Note>
    );
  }
  if (!stamp) {
    return (
      <Panel>
        <Loading label="Loading stamp" />
      </Panel>
    );
  }

  const name = collection?.name ?? "Zcash stamp";
  const symbol = collection?.symbol ?? "";
  const explorer = zcashTxUrl(stamp.destinationNetwork, stamp.zcashTx);
  const statusLabel = liveListing
    ? liveListing.state === "listed"
      ? "Listed"
      : "Pending"
    : "Unlisted";

  return (
    <>
      <div className="spread">
        <Link className="linky" href="/market">
          ← Back to marketplace
        </Link>
        {simulated && <Badge>Demo ledger</Badge>}
      </div>

      <Panel>
        <div className="assethead">
          <div className="assethead__art">
            <div className="stampcard stampcard--static">
              <div className="stampcard__art">
                <StampArt seed={stamp.id} />
                <span className="stampcard__denom">
                  {formatUnits(stamp.amountBase, stamp.decimals)} {symbol}
                </span>
              </div>
            </div>
          </div>

          <div className="stack-sm" style={{ minWidth: 0 }}>
            <div className="cluster">
              <h1>{name}</h1>
              <Badge state={liveListing?.state}>{statusLabel}</Badge>
              {simulated && <Badge>Demo</Badge>}
            </div>
            <p className="muted">
              {number ? `Stamp No. ${number} · ` : ""}represents{" "}
              <strong className="num">
                {formatUnits(stamp.amountBase, stamp.decimals)} {symbol || "tokens"}
              </strong>{" "}
              destroyed on Solana.
            </p>
            <div className="idrow">
              <code className="mono idrow__id" title={stamp.id}>
                {shortId(stamp.id, 18, 8)}
              </code>
              <button className="btn btn--sm" onClick={() => void copyId()}>
                {copied ? "Copied" : "Copy ID"}
              </button>
              {explorer ? (
                <a className="linky" href={explorer} target="_blank" rel="noreferrer">
                  View inscription
                </a>
              ) : (
                <span className="tiny dim">{explorerNote(stamp.destinationNetwork)}</span>
              )}
            </div>
          </div>
        </div>

        <dl className="stats">
          <div>
            <dt>Asking price</dt>
            <dd className="num">
              {liveListing ? `${formatZec(liveListing.priceZat)} ZEC` : "Not listed"}
            </dd>
          </div>
          <div>
            <dt>Last sale</dt>
            <dd className="num">
              {lastSale ? `${formatZec(lastSale.priceZat)} ZEC` : "No sales yet"}
            </dd>
          </div>
          <div>
            <dt>Last sale date</dt>
            <dd className="num">
              {lastSale?.settledAt
                ? new Date(lastSale.settledAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : lastSale
                  ? `height ${lastSale.height}`
                  : "—"}
            </dd>
          </div>
          <div>
            <dt>Completed sales</dt>
            <dd className="num">{sales.length}</dd>
          </div>
        </dl>
      </Panel>

      <div className="tradelayout">
        <div className="stack">
          <Panel>
            <div className="chart__head">
              <div className="tabs tabs--sm" role="tablist" aria-label="Chart scope">
                <button
                  role="tab"
                  className="tab"
                  aria-selected={scope === "stamp"}
                  onClick={() => setScope("stamp")}
                >
                  This stamp
                </button>
                <button
                  role="tab"
                  className="tab"
                  aria-selected={scope === "collection"}
                  onClick={() => setScope("collection")}
                  disabled={collectionSales.length === 0}
                >
                  Collection
                </button>
              </div>
              <div className="rangetabs">
                {RANGES.map((r) => (
                  <button
                    key={r.id}
                    aria-pressed={range === r.id}
                    onClick={() => setRange(r.id)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <PriceChart
              points={points}
              candles={candles}
              asking={
                scope === "stamp" && liveListing
                  ? { value: Number(liveListing.priceZat), label: "Asking price" }
                  : null
              }
              yLabel={
                scope === "stamp"
                  ? "Whole-stamp sale price in ZEC"
                  : "ZEC per represented unit"
              }
              emptyTitle={
                scope === "stamp" ? "No completed sales yet" : "No completed sales in this collection"
              }
              emptyBody={
                range === "all"
                  ? undefined
                  : "No sale settled inside this range. Switch to All to see the full history."
              }
            />

            {scope === "collection" && (
              <Note tone="quiet">
                Each sale is divided by the quantity its stamp represents, so stamps of different
                sizes can be compared. Artwork and collectible premiums differ between stamps, so
                these are comparisons, not valuations of any individual stamp.
                {candles
                  ? " Candles group sales into equal time buckets."
                  : ` Points, not candles: candles need at least ${12} completed sales spread over several buckets, and this collection has ${collectionSales.length}.`}
              </Note>
            )}
            {simulated && (
              <p className="tiny dim">
                Demo ledger. Prices come from settlements this deployment produced; no external
                market data is imported, and no percentage change is inferred.
              </p>
            )}
          </Panel>

          <Panel>
            <h2>Recent completed sales</h2>
            {sales.length === 0 ? (
              <p className="tiny muted" style={{ marginTop: 8 }}>
                This stamp has never changed hands for ZEC. Ownership transfers without payment are
                listed under history in technical details.
              </p>
            ) : (
              <div className="steps" style={{ marginTop: 8 }}>
                {[...sales].reverse().map((s) => (
                  <div className="step" key={s.txid}>
                    <span className="tiny mono">
                      {s.settledAt
                        ? new Date(s.settledAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : `height ${s.height}`}
                    </span>
                    <span className="cluster">
                      <span className="num">{formatZec(s.priceZat)} ZEC</span>
                      <span className="tiny dim mono">{shortId(s.txid, 8, 4)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Tech>
            <dl className="kv">
              <dt>Inscription ID</dt>
              <dd className="mono">{stamp.id}</dd>
              <dt>Collection mint</dt>
              <dd className="mono">
                <Link className="linky" href={`/launches/${stamp.mint}`}>
                  {stamp.mint}
                </Link>
              </dd>
              <dt>Quantity (base)</dt>
              <dd className="mono">
                {stamp.amountBase} · {stamp.decimals} decimals
              </dd>
              <dt>Zcash transaction</dt>
              <dd className="mono">
                {stamp.zcashTx} · height {stamp.zcashHeight} · {stamp.confirmations} confirms
              </dd>
              <dt>Solana burn</dt>
              <dd className="mono">
                {stamp.sourceTx} {stamp.burnLocator}
              </dd>
              <dt>Protocol</dt>
              <dd className="mono">
                {stamp.protocol}/{stamp.version} issuance · stamp-exp/1 ownership
              </dd>
              <dt>Current owner</dt>
              <dd className="mono">
                {stamp.currentOwner} · sequence {stamp.sequence}
              </dd>
              <dt>Verification</dt>
              <dd>{stamp.validation.reason}</dd>
              <dt>Ownership history</dt>
              <dd className="mono">
                {stamp.history.length === 0
                  ? "No transfers"
                  : stamp.history
                      .map(
                        (h) =>
                          `#${h.sequence} ${shortId(h.from, 8, 4)}→${shortId(h.to, 8, 4)}${
                            h.priceZat ? ` for ${formatZec(h.priceZat)} ZEC` : " (gift)"
                          }`,
                      )
                      .join(" · ")}
              </dd>
            </dl>
          </Tech>
        </div>

        <aside className="stack">
          <Panel>
            <div className="panel__head">
              <h2>{isOwner ? "Your stamp" : "Trade"}</h2>
              {simulated && <Badge>Demo</Badge>}
            </div>

            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Asking</dt>
              <dd className="num">
                {liveListing ? `${formatZec(liveListing.priceZat)} ZEC` : "Not listed"}
              </dd>
              <dt>Last sale</dt>
              <dd className="num">
                {lastSale ? `${formatZec(lastSale.priceZat)} ZEC` : "No sales yet"}
              </dd>
              {liveListing && (
                <>
                  <dt>Stage</dt>
                  <dd>{humanState(liveListing.state)}</dd>
                </>
              )}
            </dl>

            {notice && <Note title="Done">{notice}</Note>}
            {error && (
              <Note tone="error" title="Action failed">
                {error}
              </Note>
            )}

            {!wallet && (
              <button className="btn btn--primary btn--wide" onClick={() => void connect()}>
                Connect wallet
              </button>
            )}

            {wallet && liveListing && !isSeller && liveListing.state === "listed" && (
              <>
                <button
                  className="btn btn--primary btn--wide"
                  disabled={busy}
                  onClick={() => void act("reserve")}
                >
                  {busy ? "Working…" : `Buy for ${formatZec(liveListing.priceZat)} ZEC`}
                </button>
                <p className="tiny muted" style={{ marginTop: 8 }}>
                  Reserves this stamp for your wallet, then the seller signs the offer and
                  authorization. {simulated ? "No ZEC moves: this settles against the simulated ledger." : ""}
                </p>
              </>
            )}

            {wallet && liveListing && !isSeller && liveListing.state !== "listed" && (
              <Note tone="quiet">
                This listing is mid-settlement ({humanState(liveListing.state)}). Continue it on the
                Market screen, where each signing step is laid out.
              </Note>
            )}

            {wallet && liveListing && isSeller && (
              <>
                <Link className="btn btn--primary btn--wide" href="/market">
                  Continue on market
                </Link>
                <button
                  className="btn btn--wide"
                  style={{ marginTop: 8 }}
                  disabled={busy}
                  onClick={() => void act("cancel")}
                >
                  Cancel listing
                </button>
              </>
            )}

            {wallet && !liveListing && isOwner && stamp.transferable && (
              <>
                <div className="field" style={{ marginTop: 10 }}>
                  <label htmlFor="ask">Asking price (ZEC)</label>
                  <input
                    id="ask"
                    className="mono"
                    inputMode="decimal"
                    value={priceZec}
                    onChange={(e) => setPriceZec(e.target.value.trim())}
                  />
                  <span className="hint">= {zecToZat(priceZec)} zatoshi</span>
                </div>
                <button
                  className="btn btn--primary btn--wide"
                  disabled={busy}
                  onClick={() => void listForSale()}
                >
                  {busy ? "Working…" : "List for sale"}
                </button>
              </>
            )}

            {wallet && !liveListing && isOwner && !stamp.transferable && (
              <Note tone="warn" title="Listing disabled">
                {stamp.transferabilityNote}
              </Note>
            )}

            {wallet && !liveListing && !isOwner && (
              <Note tone="quiet">
                Not listed. Only the verified current owner can list this stamp, and this wallet is
                not it.
              </Note>
            )}

            <p className="tiny dim" style={{ marginTop: 10 }}>
              {stamp.indexNote}
            </p>
          </Panel>

          <Panel tone="ink">
            <h2>Price meaning</h2>
            <ul className="tiny" style={{ marginTop: 8 }}>
              <li>Prices here are stamp prices in ZEC, not the burned token&apos;s price.</li>
              <li>Asking price is an offer. Only settled transfers count as sales.</li>
              <li>Whole stamps only. No partial fills, no split or merge.</li>
              <li>No market cap, no supply-derived valuation, no USD conversion.</li>
            </ul>
          </Panel>
        </aside>
      </div>
    </>
  );
}
