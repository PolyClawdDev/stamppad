"use client";

/**
 * Stamp detail: asset header, compact statistics, chart beside the trade panel
 * on desktop and stacked on mobile.
 *
 * Every price on this page is a stamp price in ZEC, taken only from sales this
 * deployment settled. An asking price is never counted as a sale.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { StampImage, stampTitle } from "@/components/AssetCards";
import { PriceChart, toCandles, type ChartPoint } from "@/components/PriceChart";
import { useWallet } from "@/components/Wallet";
import { TransparentControlProof, signsWithZcashWallet } from "@/components/ZcashSign";
import { Badge, Loading, Note, Panel, Tech } from "@/components/ui";
import { formatUnits, formatZec, humanState, shortId } from "@/lib/format";
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
}

interface StampView {
  id: string;
  mint: string;
  amountBase: string;
  decimals: number;
  /** Identity of the launch this stamp was cut from, served with the stamp. */
  name: string | null;
  symbol: string;
  imageDataUrl: string | null;
  number: number;
  destinationNetwork: string;
  sourceTx: string;
  burnLocator: string;
  tokenProgram: string;
  burnAuthority: string;
  originalRecipient: string;
  currentOwner: string;
  sequence: number;
  transferable: boolean;
  listable: boolean;
  listabilityNote: string;
  /** True when the owner is one Zcash-wallet signature away from being able to list. */
  needsControlProof: boolean;
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
const NO_DESTINATION =
  "Name the Zcash address your stamps live at on the Convert screen first. Ownership here is keyed to that address, not to your Solana key.";
const RANGES = [
  { id: "24h", label: "24H", ms: 24 * 3600_000 },
  { id: "7d", label: "7D", ms: 7 * 24 * 3600_000 },
  { id: "30d", label: "30D", ms: 30 * 24 * 3600_000 },
  { id: "all", label: "All", ms: Infinity },
] as const;

export default function StampDetailPage() {
  const { mint, id } = useParams<{ mint: string; id: string }>();
  const { wallet, sign, connect, zcashDestination } = useWallet();

  const [stamp, setStamp] = useState<StampView | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [collectionSales, setCollectionSales] = useState<Sale[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [priceZec, setPriceZec] = useState("0.010");
  const [scope, setScope] = useState<"stamp" | "collection">("stamp");
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("all");

  const load = useCallback(async () => {
    // The stamp carries its own name, ticker, artwork and catalogue number, so
    // this page does not have to reassemble them from the launch catalogue.
    const [s, sale] = await Promise.all([
      fetch(`/api/stamps/${id}`).then((r) => r.json()),
      fetch(`/api/sales?mint=${mint}`).then((r) => r.json()),
    ]);
    if (s.error) return setError(s.error.message);
    setStamp(s.data);
    const all: Sale[] = sale.data?.sales ?? [];
    setCollectionSales(all);
    setSales(all.filter((x) => x.stampId === id));
  }, [id, mint]);

  useEffect(() => {
    void load();
  }, [load]);

  const liveListing = stamp?.listings.find((l) => !CLOSED.includes(l.state)) ?? null;
  const lastSale = sales.length ? sales[sales.length - 1]! : null;
  // Ownership lives at a Zcash address, so the viewer only matches once they have
  // told this app which address is theirs.
  const isOwner = Boolean(zcashDestination && stamp && zcashDestination === stamp.currentOwner);
  const isSeller = Boolean(
    zcashDestination && liveListing && zcashDestination === liveListing.sellerAddress,
  );

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
    if (!zcashDestination) return setError(NO_DESTINATION);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/market/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stampId: id,
          sellerAddress: zcashDestination,
          // A transparent seller's key is the one recovered from their control
          // proof. Phantom's Solana key does not speak for that address, so it
          // is not offered as if it did.
          sellerPublicKeyHex: signsWithZcashWallet(zcashDestination)
            ? undefined
            : wallet.publicKeyHex,
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
    if (action === "reserve" && !zcashDestination) return setError(NO_DESTINATION);
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
                buyerAddress: zcashDestination,
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

  const name = stampTitle(stamp.name);
  const symbol = stamp.symbol;
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
      </div>

      <Panel>
        <div className="assethead">
          <div className="assethead__art">
            <div className="stampcard stampcard--static">
              <div className="stampcard__art">
                <StampImage stamp={{ id: stamp.id, name, imageDataUrl: stamp.imageDataUrl }} />
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
            </div>
            <p className="muted">
              Stamp No. {stamp.number} · denomination{" "}
              <strong className="num">
                {formatUnits(stamp.amountBase, stamp.decimals)} {symbol || "units"}
              </strong>
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
          {/* The wall is in the trade panel; the way through it belongs where
              there is room to read a statement and paste a signature. */}
          {wallet && isOwner && !liveListing && stamp.needsControlProof && (
            <TransparentControlProof
              address={stamp.currentOwner}
              note={stamp.listabilityNote}
              onProven={() => void load()}
            />
          )}

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
            <p className="tiny dim">
              Prices come from settlements this deployment recorded; no external market data is
              imported, and no percentage change is inferred.
            </p>
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
            <h2>{isOwner ? "Your stamp" : "Trade"}</h2>

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

            {wallet && !zcashDestination && <Note tone="quiet">{NO_DESTINATION}</Note>}

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
                  authorization. Sales complete on StampPad&apos;s own ledger, so ownership moves
                  but no ZEC changes hands.
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

            {wallet && !liveListing && isOwner && stamp.listable && (
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

            {wallet && !liveListing && isOwner && !stamp.listable && (
              <Note tone="warn" title={stamp.needsControlProof ? "One signature away" : "Listing disabled"}>
                {stamp.listabilityNote}
              </Note>
            )}

            {wallet && zcashDestination && !liveListing && !isOwner && (
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
              <li>Every price here is a whole-stamp price in ZEC.</li>
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
