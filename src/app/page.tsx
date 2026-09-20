"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BlankStampArt, CoinArt } from "@/components/art/PixelArt";
import { PostOffice } from "@/components/art/PostOffice";
import { CoinRow, StampCard, type StampCardData } from "@/components/AssetCards";
import { Empty, Note, Panel, Tech } from "@/components/ui";
import { formatUnits, formatZec, shortId, stampNumbers } from "@/lib/format";

interface Launch {
  mint: string;
  name: string;
  symbol: string;
  quoteSymbol: string;
  currentSupply: string;
  launchSupply: string;
  decimals: number;
  imageDataUrl: string | null;
  createdAt: string;
}

interface Stamp {
  id: string;
  mint: string;
  amountBase: string;
  decimals: number;
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

type Tab = "coins" | "stamps";

export default function ExplorePage() {
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [status, setStatus] = useState<{
    statePersistence?: string;
    stonk?: { paidLaunchesEnabled?: boolean };
  } | null>(null);
  const [tab, setTab] = useState<Tab>("stamps");
  const [query, setQuery] = useState("");
  const [venue, setVenue] = useState("all");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [l, s, m, st, h] = await Promise.all([
        fetch("/api/launches").then((r) => r.json()),
        fetch("/api/stamps").then((r) => r.json()),
        fetch("/api/market").then((r) => r.json()),
        fetch("/api/status").then((r) => r.json()),
        fetch("/api/sales").then((r) => r.json()),
      ]);
      if (cancelled) return;
      setLaunches(l.data?.launches ?? []);
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

  const collections = useMemo(
    () => new Map(launches.map((l) => [l.mint, l])),
    [launches],
  );
  const numbers = useMemo(() => stampNumbers(stamps), [stamps]);
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
        const launch = collections.get(s.mint);
        const sale = lastSales.get(s.id);
        return {
          id: s.id,
          mint: s.mint,
          amountBase: s.amountBase,
          decimals: s.decimals,
          collection: launch?.name ?? "Unlisted collection",
          symbol: launch?.symbol ?? "",
          number: numbers.get(s.id) ?? 1,
          listing: liveListing.get(s.id) ?? null,
          lastSale: sale
            ? { priceZat: sale.priceZat, settledAt: sale.settledAt, height: sale.height }
            : null,
        };
      }),
    [stamps, collections, numbers, liveListing, lastSales],
  );

  const q = query.trim().toLowerCase();
  const visibleStamps = stampCards.filter((s) => {
    if (venue === "listed" && !s.listing) return false;
    if (venue === "unlisted" && s.listing) return false;
    if (!q) return true;
    return (
      s.id.toLowerCase().includes(q) ||
      s.collection.toLowerCase().includes(q) ||
      s.symbol.toLowerCase().includes(q) ||
      s.mint.toLowerCase().includes(q)
    );
  });
  const visibleCoins = launches.filter((l) => {
    if (venue === "listed" || venue === "unlisted") return true;
    if (!q) return true;
    return (
      l.name.toLowerCase().includes(q) ||
      l.symbol.toLowerCase().includes(q) ||
      l.mint.toLowerCase().includes(q)
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
        line: `Stamp issued · ${formatUnits(s.amountBase, s.decimals)} ${
          collections.get(s.mint)?.symbol ?? ""
        }`.trim(),
        sub: `height ${s.zcashHeight} · ${shortId(s.id, 8, 4)}`,
        href: `/collections/${s.mint}/stamps/${s.id}`,
      });
    }
    for (const l of launches) {
      events.push({
        key: `launch-${l.mint}`,
        when: 0,
        line: `Coin launched · ${l.symbol}`,
        sub: shortId(l.mint, 8, 4),
        href: `/launches/${l.mint}`,
      });
    }
    return events.sort((a, b) => b.when - a.when).slice(0, 6);
  }, [sales, stamps, launches, collections]);

  return (
    <>
      <Panel className="intro-panel">
        <div className="intro">
          <div className="intro__copy">
            <p className="eyebrow">StampPad · post office for onchain assets</p>
            <h1>Small stamps. Big ideas.</h1>
            <p className="lede muted">
              Discover Solana coins and Zcash stamps. Burn a coin to issue a stamp on Zcash, then
              own it, send it, or sell the whole stamp for ZEC.
            </p>
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Tradable for ZEC · Records the exact quantity burned · Published on Zcash
            </p>
            <div className="cluster" style={{ marginTop: 14 }}>
              <a className="btn btn--primary" href="#assets">
                Explore assets
              </a>
              <Link className="btn" href="/launch">
                Launch
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
              <div className="tabs" role="tablist" aria-label="Asset type">
                <button
                  role="tab"
                  className="tab"
                  aria-selected={tab === "stamps"}
                  onClick={() => setTab("stamps")}
                >
                  Zcash stamps <span className="count">{stampCards.length}</span>
                </button>
                <button
                  role="tab"
                  className="tab"
                  aria-selected={tab === "coins"}
                  onClick={() => setTab("coins")}
                >
                  Solana coins <span className="count">{launches.length}</span>
                </button>
              </div>
              <div className="grow">
                <label className="sr-only" htmlFor="q">
                  Search assets
                </label>
                <input
                  id="q"
                  value={query}
                  placeholder={tab === "stamps" ? "Search stamps or collections" : "Search coins"}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div>
                <label className="sr-only" htmlFor="venue">
                  Market
                </label>
                <select id="venue" value={venue} onChange={(e) => setVenue(e.target.value)}>
                  <option value="all">All markets</option>
                  <option value="listed">Stamps: listed for ZEC</option>
                  <option value="unlisted">Stamps: not listed</option>
                </select>
              </div>
            </div>

            <p className="tiny muted" style={{ marginTop: 10 }}>
              {tab === "stamps"
                ? "Stamps are transparent Zcash inscriptions, traded whole and never split. Prices below are stamp listings in ZEC, unrelated to any Solana market price."
                : "Coins trade on their Solana venue. Stamp listings are a separate market and are not shown here."}
            </p>
          </Panel>

          {tab === "stamps" ? (
            <section aria-label="Zcash stamps">
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
                  Every stamp starts as a coin burn, and nobody has burned anything here yet. Burn
                  tokens you already hold, or launch a coin first and stamp that.
                </Empty>
              ) : visibleStamps.length === 0 ? (
                <Empty
                  title="Nothing matches"
                  action={
                    <button className="btn" onClick={() => setQuery("")}>
                      Clear search
                    </button>
                  }
                >
                  No stamp on this instance matches that search.
                </Empty>
              ) : (
                <div className="stampgrid">
                  {visibleStamps.map((s) => (
                    <StampCard key={s.id} stamp={s} />
                  ))}
                  {visibleStamps.length < 3 && (
                    <Link className="stampcard stampcard--ghost" href="/convert">
                      <div className="stampcard__art dither">
                        <BlankStampArt />
                      </div>
                      <div className="stampcard__body">
                        <span className="stampcard__name">Issue a stamp</span>
                        <span className="tiny muted">Burn tokens you hold to mint the next one.</span>
                      </div>
                      <div className="stampcard__foot">
                        <span className="tiny dim">Convert</span>
                        <span className="linky">Start</span>
                      </div>
                    </Link>
                  )}
                </div>
              )}
            </section>
          ) : (
            <section aria-label="Solana coins" className="coinlist">
              {visibleCoins.length === 0 ? (
                <Empty
                  art={<CoinArt seed="stamppad" />}
                  title={launches.length === 0 ? "No coins launched yet" : "Nothing matches"}
                  action={
                    launches.length === 0 ? (
                      <Link className="btn btn--primary" href="/launch">
                        Launch a coin
                      </Link>
                    ) : (
                      <button className="btn" onClick={() => setQuery("")}>
                        Clear search
                      </button>
                    )
                  }
                >
                  {launches.length === 0
                    ? "Every coin listed here was launched on this deployment, quoted against Zcash. Yours would be the first."
                    : "No coin on this instance matches that search."}
                </Empty>
              ) : (
                visibleCoins.map((l) => (
                  <CoinRow
                    key={l.mint}
                    coin={l}
                    href={`/launches/${l.mint}`}
                    action="Trade"
                    detail={
                      <span className="tiny muted">
                        vs {l.quoteSymbol} · {formatUnits(l.currentSupply, l.decimals)} supply
                      </span>
                    }
                  />
                ))
              )}
            </section>
          )}
        </div>

        <aside className="stack">
          <Panel>
            <h2>How it works</h2>
            <p className="tiny muted" style={{ marginTop: 8 }}>
              A stamp is a collectible asset on Zcash that records a coin burn. One stamp, one
              owner, one exact quantity.
            </p>
            <ol className="howto" style={{ marginTop: 10 }}>
              <li>
                Launch or choose a coin. Coins trade on Solana, quoted in ZEC.
              </li>
              <li>
                Convert tokens into a stamp. The tokens are destroyed and the stamp is published on
                Zcash with the amount it represents.
              </li>
              <li>Collect or trade. Stamps move to a new owner as a whole, priced in ZEC.</li>
            </ol>
            <div className="cluster" style={{ marginTop: 14 }}>
              <Link className="btn btn--sm btn--primary" href="/convert">
                Convert
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
        A stamp is a burn receipt. It is not a reserve-backed wrapper, is not redeemable, carries no
        price parity with the burned token, and is a transparent inscription — not a shielded asset.
      </Note>
    </>
  );
}
