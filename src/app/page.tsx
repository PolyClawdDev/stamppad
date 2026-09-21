"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BlankStampArt } from "@/components/art/PixelArt";
import { PostOffice } from "@/components/art/PostOffice";
import { StampCard, type StampCardData } from "@/components/AssetCards";
import { Empty, Note, Panel, Tech } from "@/components/ui";
import { formatUnits, formatZec, shortId } from "@/lib/format";

/** The stamp API serves each stamp with the identity of the launch it came from. */
interface Stamp {
  id: string;
  mint: string;
  amountBase: string;
  decimals: number;
  name: string | null;
  symbol: string;
  imageDataUrl: string | null;
  number: number;
  currentOwner: string;
  sequence: number;
  transferable: boolean;
  zcashHeight: number;
  zcashTx: string;
  createdAt: string;
}

interface Listing {
  id: string;
  stampId: string;
  state: string;
  priceZat: string;
}

interface Sale {
  stampId: string;
  mint: string;
  symbol: string;
  sequence: number;
  buyer: string;
  priceZat: string;
  txid: string;
  settledAt: string | null;
  height: number;
}

export default function ExplorePage() {
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [status, setStatus] = useState<{
    statePersistence?: string;
    stonk?: { paidLaunchesEnabled?: boolean };
  } | null>(null);
  const [query, setQuery] = useState("");
  const [forSaleOnly, setForSaleOnly] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [s, m, st, h] = await Promise.all([
        fetch("/api/stamps").then((r) => r.json()),
        fetch("/api/market").then((r) => r.json()),
        fetch("/api/status").then((r) => r.json()),
        fetch("/api/sales").then((r) => r.json()),
      ]);
      if (cancelled) return;
      setStamps(s.data?.stamps ?? []);
      setListings([...(m.data?.listings ?? []), ...(m.data?.history ?? [])]);
      setSales(h.data?.sales ?? []);
      setStatus(st.data);
      setLoaded(true);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const liveListing = useMemo(() => {
    const map = new Map<string, Listing>();
    for (const l of listings) {
      if (l.state === "cancelled" || l.state === "expired" || l.state === "failed") continue;
      map.set(l.stampId, l);
    }
    return map;
  }, [listings]);

  /** Newest settled sale per stamp. Asking prices never enter this map. */
  const lastSales = useMemo(() => {
    const map = new Map<string, Sale>();
    for (const s of sales) map.set(s.stampId, s);
    return map;
  }, [sales]);

  const stampCards: StampCardData[] = useMemo(
    () =>
      stamps.map((s) => {
        const sale = lastSales.get(s.id);
        return {
          id: s.id,
          mint: s.mint,
          amountBase: s.amountBase,
          decimals: s.decimals,
          name: s.name,
          symbol: s.symbol,
          imageDataUrl: s.imageDataUrl,
          number: s.number,
          listing: liveListing.get(s.id) ?? null,
          lastSale: sale
            ? { priceZat: sale.priceZat, settledAt: sale.settledAt, height: sale.height }
            : null,
        };
      }),
    [stamps, liveListing, lastSales],
  );

  const q = query.trim().toLowerCase();
  const visibleStamps = stampCards.filter((s) => {
    if (forSaleOnly && !s.listing) return false;
    if (!q) return true;
    return (
      s.id.toLowerCase().includes(q) ||
      (s.name ?? "").toLowerCase().includes(q) ||
      s.symbol.toLowerCase().includes(q) ||
      s.mint.toLowerCase().includes(q)
    );
  });

  const activity = useMemo(() => {
    const events: Array<{ key: string; when: number; line: string; sub: string; href: string }> = [];
    for (const s of sales) {
      events.push({
        key: `sale-${s.stampId}-${s.sequence}`,
        when: Number.MAX_SAFE_INTEGER - 1,
        line: `Sold for ${formatZec(s.priceZat)} ZEC`,
        sub: `seq ${s.sequence} · ${shortId(s.txid, 10, 4)}`,
        href: `/collections/${s.mint}/stamps/${s.stampId}`,
      });
    }
    for (const s of stamps) {
      events.push({
        key: `stamp-${s.id}`,
        when: s.zcashHeight,
        line: `Stamp issued · ${formatUnits(s.amountBase, s.decimals)} ${s.symbol}`.trim(),
        sub: `height ${s.zcashHeight} · ${shortId(s.id, 8, 4)}`,
        href: `/collections/${s.mint}/stamps/${s.id}`,
      });
    }
    return events.sort((a, b) => b.when - a.when).slice(0, 6);
  }, [sales, stamps]);

  return (
    <>
      <Panel className="intro-panel">
        <div className="intro">
          <div className="intro__copy">
            <p className="eyebrow">StampPad · post office for onchain stamps</p>
            <h1>Small stamps. Big ideas.</h1>
            <p className="lede muted">
              Collectible stamps published on Zcash. Issue one with your own artwork and ticker,
              then own it, send it, or sell the whole stamp for ZEC.
            </p>
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Tradable for ZEC · Whole stamps only · Published on Zcash
            </p>
            <div className="cluster" style={{ marginTop: 14 }}>
              <a className="btn btn--primary" href="#assets">
                Explore stamps
              </a>
              <Link className="btn" href="/launch">
                Launch a stamp
              </Link>
            </div>
          </div>
          <div className="intro__art">
            <PostOffice />
          </div>
        </div>
      </Panel>

      <div className="columns" id="assets">
        <div className="stack">
          <Panel>
            <div className="toolbar" role="search">
              <span className="eyebrow toolbar__label">
                Stamps <span className="count">{stampCards.length}</span>
              </span>
              <div className="grow">
                <label className="sr-only" htmlFor="q">
                  Search stamps
                </label>
                <input
                  id="q"
                  value={query}
                  placeholder="Search by name, ticker or identifier"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="rangetabs" role="group" aria-label="Filter stamps">
                <button aria-pressed={!forSaleOnly} onClick={() => setForSaleOnly(false)}>
                  All
                </button>
                <button aria-pressed={forSaleOnly} onClick={() => setForSaleOnly(true)}>
                  For sale
                </button>
              </div>
            </div>

            <p className="tiny muted" style={{ marginTop: 10 }}>
              Stamps are traded whole and never split. Every price here is a stamp price in ZEC
              recorded on this deployment.
            </p>
          </Panel>

          <section aria-label="Stamps">
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
            ) : stampCards.length === 0 ? (
              <Empty
                art={<BlankStampArt />}
                title="No stamps issued yet"
                action={
                  <Link className="btn btn--primary" href="/launch">
                    Launch a stamp
                  </Link>
                }
              >
                Nobody has issued a stamp on this deployment. Pick a name, a ticker and some
                artwork, and yours is the first one on the wall.
              </Empty>
            ) : visibleStamps.length === 0 ? (
              <Empty
                title={forSaleOnly && !q ? "Nothing is for sale" : "Nothing matches"}
                action={
                  <button
                    className="btn"
                    onClick={() => {
                      setQuery("");
                      setForSaleOnly(false);
                    }}
                  >
                    Show all stamps
                  </button>
                }
              >
                {forSaleOnly && !q
                  ? "No stamp on this instance is listed right now. Owners can list one from its own page."
                  : "No stamp on this instance matches that search."}
              </Empty>
            ) : (
              <div className="stampgrid">
                {visibleStamps.map((s) => (
                  <StampCard key={s.id} stamp={s} />
                ))}
                {visibleStamps.length < 3 && (
                  <Link className="stampcard stampcard--ghost" href="/launch">
                    <div className="stampcard__art dither">
                      <BlankStampArt />
                    </div>
                    <div className="stampcard__body">
                      <span className="stampcard__name">Launch a stamp</span>
                      <span className="tiny muted">Your artwork, your ticker, your stamp.</span>
                    </div>
                    <div className="stampcard__foot">
                      <span className="tiny dim">Issue</span>
                      <span className="linky">Start</span>
                    </div>
                  </Link>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="stack">
          <Panel>
            <h2>How it works</h2>
            <p className="tiny muted" style={{ marginTop: 8 }}>
              A stamp is a collectible asset on Zcash. One stamp, one owner, one exact
              denomination.
            </p>
            <ol className="howto" style={{ marginTop: 10 }}>
              <li>Launch a stamp with the name, ticker and artwork you want it to carry.</li>
              <li>
                It is published on Zcash as a transparent inscription recording the denomination it
                represents.
              </li>
              <li>Collect or trade. Stamps move to a new owner as a whole, priced in ZEC.</li>
            </ol>
            <div className="cluster" style={{ marginTop: 14 }}>
              <Link className="btn btn--sm btn--primary" href="/launch">
                Launch a stamp
              </Link>
              <Link className="btn btn--sm" href="/market">
                Market
              </Link>
            </div>
          </Panel>

          <Panel>
            <h2>Activity</h2>
            {activity.length === 0 ? (
              <p className="tiny muted" style={{ marginTop: 8 }}>
                Nothing has happened here yet. Launches, burns and sales appear the moment someone
                makes one.
              </p>
            ) : (
              <div className="activity">
                {activity.map((a) => (
                  <Link className="activity__row" key={a.key} href={a.href}>
                    <span>{a.line}</span>
                    <span className="tiny muted mono">{a.sub}</span>
                  </Link>
                ))}
              </div>
            )}
            <p className="tiny dim" style={{ marginTop: 10 }}>
              Every event listed is one this deployment recorded. No external activity is imported.
            </p>
          </Panel>

          <Tech>
            <dl className="kv">
              <dt>Stonk paid launches</dt>
              <dd className="mono">{String(status?.stonk?.paidLaunchesEnabled ?? false)}</dd>
              <dt>Stamp protocol</dt>
              <dd className="mono">stamp-exp/0 issuance · stamp-exp/1 ownership</dd>
              <dt>State</dt>
              <dd>
                {status?.statePersistence === "ephemeral"
                  ? "This instance keeps its ledger in temporary storage. Anything you do here is lost when the instance restarts."
                  : status?.statePersistence === "durable"
                    ? "Stored in Postgres."
                    : "Stored in a local file."}
              </dd>
              <dt>State source</dt>
              <dd>
                <Link className="linky" href="/api/indexer">
                  Deterministic indexer replay
                </Link>
              </dd>
            </dl>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              Ownership and sales are rebuilt from chain records and published authorizations, not
              from application state.
            </p>
          </Tech>
        </aside>
      </div>

      <Note tone="quiet">
        A stamp is a collectible, not a claim: it is not reserve-backed, is not redeemable, and is a
        transparent inscription rather than a shielded asset. Sales complete on StampPad&apos;s own
        ledger, so ownership moves but no ZEC changes hands.
      </Note>
    </>
  );
}
