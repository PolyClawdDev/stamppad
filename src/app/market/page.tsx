"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@/components/Wallet";
import { BlankStampArt, StampArt } from "@/components/art/PixelArt";
import {
  ListingStateBadge,
  StampCard,
  stampHref,
  type StampCardData,
} from "@/components/AssetCards";
import { Empty, Note, Panel, Tech } from "@/components/ui";
import { formatUnits, formatZec, humanState, shortId, stampNumbers } from "@/lib/format";

interface Listing {
  id: string;
  stampId: string;
  sequence: number;
  state: string;
  sellerAddress: string;
  buyerAddress: string | null;
  priceZat: string;
  offerTxid: string | null;
  transferTxid: string | null;
  escrowId: string | null;
  expiryHeight: number | null;
  note: string;
  stamp: { amountBase: string; decimals: number; mint: string; currentOwner: string } | null;
}

interface Disclosure {
  adapter: string;
  liveSalesEnabled: boolean;
  custody: string;
  mechanism: string;
  atomicity: string;
  partialFills: string;
  risks: string[];
}

interface Sale {
  stampCommitmentHex: string;
  sequence: number;
  seller: string;
  buyer: string;
  priceZat: string;
  txid: string;
}

interface StampSummary {
  id: string;
  mint: string;
  amountBase: string;
  decimals: number;
  currentOwner: string;
  zcashHeight: number;
}

interface CompletedSale {
  stampId: string;
  priceZat: string;
  settledAt: string | null;
  height: number;
}

const STEP_HELP: Record<string, string> = {
  listed:
    "Waiting for a buyer to be named. Offers are targeted at one buyer, which is what stops two buyers racing for one stamp.",
  reserved: "The seller publishes a signed offer binding this ownership sequence to this buyer.",
  offer_published:
    "The seller signs the transfer authorization that carries the hash-lock preimage.",
  authorized: "The buyer holds a complete authorization and can safely lock ZEC in the HTLC.",
  payment_locked: "Publish the transfer record, then the seller claims the payment.",
  transfer_published:
    "The transfer is on chain. The seller claims the HTLC; ownership applies once the record confirms.",
  settled: "Settled. The indexer applied the ownership change.",
};

export default function MarketPage() {
  const { wallet, sign, connect } = useWallet();
  const [listings, setListings] = useState<Listing[]>([]);
  const [history, setHistory] = useState<Listing[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Listings carry a mint; names and tickers come from the launch catalogue.
  const [collections, setCollections] = useState<Map<string, { name: string; symbol: string }>>(
    new Map(),
  );
  const [stamps, setStamps] = useState<StampSummary[]>([]);
  const [saleHistory, setSaleHistory] = useState<CompletedSale[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetch("/api/launches")
      .then((r) => r.json())
      .then((j) =>
        setCollections(
          new Map(
            (j.data?.launches ?? []).map(
              (l: { mint: string; name: string; symbol: string }) => [l.mint, l] as const,
            ),
          ),
        ),
      );
  }, []);

  const load = useCallback(async () => {
    const [json, stampsJson, salesJson] = await Promise.all([
      fetch("/api/market").then((r) => r.json()),
      fetch("/api/stamps").then((r) => r.json()),
      fetch("/api/sales").then((r) => r.json()),
    ]);
    if (json.error) return setError(json.error.message);
    setListings(json.data.listings ?? []);
    setHistory(json.data.history ?? []);
    setSales(json.data.confirmedSales ?? []);
    setDisclosure(json.data.settlement);
    setStamps(stampsJson.data?.stamps ?? []);
    setSaleHistory(salesJson.data?.sales ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const numbers = useMemo(() => stampNumbers(stamps), [stamps]);
  const mintOf = useMemo(() => new Map(stamps.map((s) => [s.id, s.mint])), [stamps]);
  /** Canonical detail URL when the collection is known; the flat alias otherwise. */
  const hrefFor = (stampId: string) => {
    const mint = mintOf.get(stampId);
    return mint ? stampHref({ mint, id: stampId }) : `/stamps/${stampId}`;
  };
  const lastSales = useMemo(() => {
    const map = new Map<string, CompletedSale>();
    for (const s of saleHistory) map.set(s.stampId, s);
    return map;
  }, [saleHistory]);
  const liveByStamp = useMemo(() => {
    const map = new Map<string, Listing>();
    for (const l of listings) map.set(l.stampId, l);
    return map;
  }, [listings]);

  const cards: StampCardData[] = useMemo(
    () =>
      stamps.map((s) => {
        const launch = collections.get(s.mint);
        const sale = lastSales.get(s.id);
        const listing = liveByStamp.get(s.id);
        return {
          id: s.id,
          mint: s.mint,
          amountBase: s.amountBase,
          decimals: s.decimals,
          collection: launch?.name ?? "Unlisted collection",
          symbol: launch?.symbol ?? "",
          number: numbers.get(s.id) ?? 1,
          listing: listing ? { state: listing.state, priceZat: listing.priceZat } : null,
          lastSale: sale
            ? { priceZat: sale.priceZat, settledAt: sale.settledAt, height: sale.height }
            : null,
          ownedByViewer: Boolean(wallet && s.currentOwner === wallet.zcashAddress),
        };
      }),
    [stamps, collections, numbers, lastSales, liveByStamp, wallet],
  );

  async function act(listing: Listing, action: string) {
    if (!wallet) return connect();
    setBusy(listing.id);
    setError(null);
    try {
      const body: Record<string, unknown> = { action };
      if (action === "reserve") {
        body.buyerAddress = wallet.zcashAddress;
        body.buyerPublicKeyHex = wallet.publicKeyHex;
      }
      if (action === "publishOffer" || action === "authorize") {
        const challenge = await (
          await fetch(`/api/market/listings/${listing.id}?challenge=true`)
        ).json();
        if (challenge.error) throw new Error(challenge.error.message);
        const signed = await sign(challenge.data.preimage);
        body.signatureHex = signed.signatureHex;
        body.publicKeyHex = signed.publicKeyHex;
      }
      const res = await fetch(`/api/market/listings/${listing.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(null);
    }
  }

  function actionsFor(listing: Listing) {
    const isSeller = wallet?.zcashAddress === listing.sellerAddress;
    const isBuyer = wallet?.zcashAddress === listing.buyerAddress;
    const out: Array<{ action: string; label: string; allowed: boolean; primary?: boolean }> = [];
    if (listing.state === "listed") {
      out.push({ action: "reserve", label: "Buy this stamp", allowed: !isSeller, primary: true });
      out.push({ action: "cancel", label: "Cancel listing", allowed: isSeller });
    }
    if (listing.state === "reserved") {
      out.push({
        action: "publishOffer",
        label: "Sign + publish offer",
        allowed: isSeller,
        primary: true,
      });
    }
    if (listing.state === "offer_published") {
      out.push({
        action: "authorize",
        label: "Sign transfer authorization",
        allowed: isSeller,
        primary: true,
      });
    }
    if (listing.state === "authorized") {
      out.push({ action: "lockPayment", label: "Lock ZEC in HTLC", allowed: isBuyer, primary: true });
    }
    if (listing.state === "payment_locked") {
      out.push({
        action: "publishTransfer",
        label: "Publish transfer record",
        allowed: isBuyer,
        primary: true,
      });
    }
    if (listing.state === "payment_locked" || listing.state === "transfer_published") {
      out.push({ action: "claimPayment", label: "Claim payment", allowed: isSeller });
    }
    return out;
  }

  return (
    <>
      <Panel>
        <h1>Market</h1>
        <p className="lede muted" style={{ marginTop: 6 }}>
          Whole stamps, priced in ZEC. Every listing here was created on this deployment; no
          external order flow or price history is imported.
        </p>
      </Panel>

      {error && (
        <Note tone="error" title="Action failed">
          {error}
        </Note>
      )}

      <div className="columns">
        <div className="stack">
          <div className="spread">
            <h2>Stamps</h2>
            <span className="tiny dim">
              {cards.length} inscription{cards.length === 1 ? "" : "s"} on this deployment
            </span>
          </div>
          {!loaded ? (
            <div className="stampgrid">
              {[0, 1, 2].map((i) => (
                <div key={i} className="stampcard" aria-hidden="true">
                  <div className="stampcard__art dither" />
                  <div className="stampcard__body">
                    <div className="skeleton" />
                  </div>
                </div>
              ))}
            </div>
          ) : cards.length === 0 ? (
            <Empty
              art={<BlankStampArt />}
              title="Nothing has been issued yet"
              action={
                <>
                  <Link className="btn btn--primary" href="/convert">
                    Issue a stamp
                  </Link>
                  <Link className="btn" href="/launch">
                    Launch a coin
                  </Link>
                </>
              }
            >
              This marketplace only trades stamps that were issued here. Burning tokens creates the
              first one.
            </Empty>
          ) : (
            <div className="stampgrid">
              {cards.map((c) => (
                <StampCard key={c.id} stamp={c} />
              ))}
            </div>
          )}

          <h2 style={{ marginTop: 6 }}>Open listings</h2>

          {listings.length === 0 ? (
            <Empty
              title="No live listings"
              action={
                <Link className="btn btn--primary" href="/portfolio">
                  Open your portfolio
                </Link>
              }
            >
              A stamp you own can be listed from its own page.
            </Empty>
          ) : (
            listings.map((l) => {
              const isSeller = wallet?.zcashAddress === l.sellerAddress;
              const isBuyer = wallet?.zcashAddress === l.buyerAddress;
              return (
                <Panel key={l.id}>
                  <div className="listing">
                    <Link className="listing__art" href={hrefFor(l.stampId)}>
                      <StampArt seed={l.stampId} />
                    </Link>
                    <div className="stack-sm" style={{ minWidth: 0 }}>
                      <div className="spread">
                        <Link className="listing__id" href={hrefFor(l.stampId)}>
                          {(l.stamp && collections.get(l.stamp.mint)?.name) ?? "Zcash stamp"}
                        </Link>
                        <ListingStateBadge state={l.state} />
                      </div>
                      <div className="cluster">
                        <span className="price">{formatZec(l.priceZat)} ZEC</span>
                        {l.stamp && (
                          <span className="tiny muted">
                            represents {formatUnits(l.stamp.amountBase, l.stamp.decimals)}{" "}
                            {collections.get(l.stamp.mint)?.symbol ?? "tokens"}
                          </span>
                        )}
                      </div>
                      <span className="tiny dim mono">{shortId(l.stampId, 14, 6)}</span>
                      <p className="tiny muted">{STEP_HELP[l.state] ?? l.note}</p>
                      <p className="tiny dim">
                        {isSeller
                          ? "You are the seller."
                          : isBuyer
                            ? "You are the named buyer."
                            : l.buyerAddress
                              ? "Reserved for another buyer."
                              : "Open to any buyer other than the seller."}
                      </p>
                    </div>
                  </div>

                  <div className="cluster" style={{ marginTop: 12 }}>
                    {actionsFor(l).map((a) => (
                      <button
                        key={a.action}
                        className={`btn btn--sm${a.primary ? " btn--primary" : ""}`}
                        disabled={!a.allowed || busy === l.id}
                        title={
                          a.allowed
                            ? undefined
                            : "Only the counterparty for this step can take this action."
                        }
                        onClick={() => void act(l, a.action)}
                      >
                        {busy === l.id ? "Working…" : a.label}
                      </button>
                    ))}
                    {!wallet && (
                      <span className="tiny muted">Connect a wallet to act on this listing.</span>
                    )}
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <Tech summary="Settlement record">
                      <dl className="kv">
                        <dt>Price</dt>
                        <dd className="mono">{l.priceZat} zatoshi</dd>
                        <dt>Ownership sequence</dt>
                        <dd className="mono">{l.sequence}</dd>
                        <dt>Seller</dt>
                        <dd className="mono">{l.sellerAddress}</dd>
                        <dt>Buyer</dt>
                        <dd className="mono">{l.buyerAddress ?? "not reserved"}</dd>
                        {l.offerTxid && (
                          <>
                            <dt>Offer record</dt>
                            <dd className="mono">{l.offerTxid}</dd>
                          </>
                        )}
                        {l.transferTxid && (
                          <>
                            <dt>Transfer record</dt>
                            <dd className="mono">{l.transferTxid}</dd>
                          </>
                        )}
                        {l.escrowId && (
                          <>
                            <dt>HTLC</dt>
                            <dd className="mono">
                              {l.escrowId} · refund at height {l.expiryHeight}
                            </dd>
                          </>
                        )}
                      </dl>
                    </Tech>
                  </div>
                </Panel>
              );
            })
          )}

          <h2 style={{ marginTop: 6 }}>Confirmed sales</h2>
          {sales.length === 0 ? (
            <p className="tiny muted">The indexer has not confirmed a sale on this instance.</p>
          ) : (
            <Panel>
              <div className="steps">
                {sales.map((s) => (
                  <Link
                    className="step"
                    key={`${s.stampCommitmentHex}:${s.sequence}`}
                    href={hrefFor(s.stampCommitmentHex)}
                  >
                    <span className="mono">{shortId(s.stampCommitmentHex, 12, 6)}</span>
                    <span className="cluster">
                      <span className="tiny muted mono">seq {s.sequence}</span>
                      <span className="price">{formatZec(s.priceZat)} ZEC</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Panel>
          )}

          {history.length > 0 && (
            <>
              <h2 style={{ marginTop: 6 }}>Closed listings</h2>
              <Panel>
                <div className="steps">
                  {history.map((l) => (
                    <Link className="step" key={l.id} href={hrefFor(l.stampId)}>
                      <span className="mono">{shortId(l.stampId, 12, 6)}</span>
                      <span className="cluster">
                        <span className="tiny muted">{humanState(l.state)}</span>
                        <span className="tiny mono">{formatZec(l.priceZat)} ZEC</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </Panel>
            </>
          )}
        </div>

        <aside className="stack">
          <Panel tone="ink">
            <h2>Before you buy</h2>
            <ul className="tiny" style={{ marginTop: 8 }}>
              <li>Real ZEC sales are disabled in this build.</li>
              <li>Delivery is an ordered sequence, not an atomic swap.</li>
              <li>Whole stamps only. No partial fills exist.</li>
              <li>The app never holds your stamp or your ZEC.</li>
            </ul>
          </Panel>

          {disclosure && (
            <Panel>
              <h2>Settlement</h2>
              <p className="tiny muted" style={{ marginTop: 8 }}>
                {disclosure.mechanism}
              </p>
              <div style={{ marginTop: 10 }}>
                <Tech summary="Escrow design and failure modes">
                  <dl className="kv">
                    <dt>Adapter</dt>
                    <dd className="mono">{disclosure.adapter}</dd>
                    <dt>Live sales</dt>
                    <dd className="mono">{String(disclosure.liveSalesEnabled)}</dd>
                    <dt>Atomicity</dt>
                    <dd>{disclosure.atomicity}</dd>
                    <dt>Partial fills</dt>
                    <dd>{disclosure.partialFills}</dd>
                    <dt>Custody</dt>
                    <dd>{disclosure.custody}</dd>
                  </dl>
                  <ul className="tiny" style={{ marginTop: 10 }}>
                    {disclosure.risks.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </Tech>
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
