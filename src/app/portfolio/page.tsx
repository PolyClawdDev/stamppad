"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet, walletStateLine } from "@/components/Wallet";
import { CoinRow, StampCard, type StampCardData } from "@/components/AssetCards";
import { Badge, Empty, Loading, Note, Panel, Tech } from "@/components/ui";
import { formatUnits, humanState, shortId } from "@/lib/format";
import { PHANTOM_SITE } from "@/lib/wallet/provider";
import { truncateKey } from "@/lib/wallet/session";

interface Balance {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  amountBase: string;
}

/** Served with the identity of the launch the stamp was cut from. */
interface StampView {
  id: string;
  mint: string;
  amountBase: string;
  decimals: number;
  name: string | null;
  symbol: string;
  imageDataUrl: string | null;
  number: number;
  currentOwner: string;
  originalRecipient: string;
  sequence: number;
  transferable: boolean;
  transferabilityNote: string;
  isCurrentOwner: boolean;
  zcashHeight: number;
  listing: { id: string; state: string; priceZat: string } | null;
}

interface Job {
  id: string;
  state: string;
  mint: string;
  amountBase: string;
  decimals?: number;
  rejectMessage: string | null;
}

export default function PortfolioPage() {
  const { wallet, phase, connect, ready, zcashDestination } = useWallet();
  const [data, setData] = useState<{
    balances: Balance[];
    stamps: StampView[];
    jobs: Job[];
    launches: Array<{ mint: string; name: string; symbol: string; imageDataUrl?: string | null }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stamps arrive already named. Token balances do not, and a balance can be in
  // a coin this wallet did not launch, so the public launch list supplies their
  // artwork.
  const [catalogue, setCatalogue] = useState<
    Array<{ mint: string; name: string; symbol: string; imageDataUrl?: string | null }>
  >([]);

  const [lastSales, setLastSales] = useState<
    Map<string, { priceZat: string; settledAt: string | null; height: number }>
  >(new Map());

  useEffect(() => {
    void fetch("/api/launches")
      .then((r) => r.json())
      .then((j) => setCatalogue(j.data?.launches ?? []));
    void fetch("/api/sales")
      .then((r) => r.json())
      .then((j) => {
        const map = new Map<string, { priceZat: string; settledAt: string | null; height: number }>();
        for (const s of j.data?.sales ?? []) {
          map.set(s.stampId, { priceZat: s.priceZat, settledAt: s.settledAt, height: s.height });
        }
        setLastSales(map);
      });
  }, []);

  const load = useCallback(async () => {
    if (!wallet) return;
    const query = new URLSearchParams({ owner: wallet.publicKey });
    if (zcashDestination) query.set("zcashAddress", zcashDestination);
    const res = await fetch(`/api/portfolio?${query}`);
    const json = await res.json();
    if (json.error) setError(json.error.message);
    else setData(json.data);
  }, [wallet, zcashDestination]);

  useEffect(() => {
    void load();
  }, [load]);

  const collections = useMemo(
    () => new Map([...catalogue, ...(data?.launches ?? [])].map((l) => [l.mint, l])),
    [data, catalogue],
  );

  if (!ready) {
    return (
      <Panel>
        <Loading label="Looking for Phantom" />
      </Panel>
    );
  }

  if (!wallet) {
    return (
      <Panel>
        <h1>Portfolio</h1>
        <p className="lede muted" style={{ marginTop: 6 }}>
          Balances, stamps and issuance jobs are keyed to your Phantom public key, so this screen
          stays empty until that key has been proved.
        </p>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          {walletStateLine(phase)}
        </p>
        {phase === "unavailable" ? (
          <a
            className="btn btn--primary"
            style={{ marginTop: 14 }}
            href={PHANTOM_SITE}
            target="_blank"
            rel="noreferrer"
          >
            Install Phantom
          </a>
        ) : (
          <button
            className="btn btn--primary"
            style={{ marginTop: 14 }}
            disabled={phase === "connecting" || phase === "verifying"}
            onClick={() => void connect()}
          >
            {phase === "unverified" ? "Prove ownership" : "Connect wallet"}
          </button>
        )}
      </Panel>
    );
  }

  const stampCards: StampCardData[] = (data?.stamps ?? []).map((s) => ({
    id: s.id,
    mint: s.mint,
    amountBase: s.amountBase,
    decimals: s.decimals,
    name: s.name,
    symbol: s.symbol,
    imageDataUrl: s.imageDataUrl,
    number: s.number,
    listing: s.listing,
    lastSale: lastSales.get(s.id) ?? null,
    ownedByViewer: s.isCurrentOwner,
  }));

  return (
    <>
      <Panel>
        <div className="panel__head">
          <h1>Portfolio</h1>
          <Badge tone="live">{truncateKey(wallet.publicKey)}</Badge>
        </div>
        <dl className="kv" style={{ marginTop: 6 }}>
          <dt>Phantom wallet</dt>
          <dd className="mono">{wallet.publicKey}</dd>
          <dt>Stamp destination</dt>
          <dd className="mono">
            {zcashDestination ?? (
              <span className="dim">
                Not set. Name a Zcash address on{" "}
                <Link className="linky" href="/convert">
                  Convert
                </Link>{" "}
                and it is remembered for this wallet.
              </span>
            )}
          </dd>
        </dl>
      </Panel>

      {error && (
        <Note tone="error" title="Could not load portfolio">
          {error}
        </Note>
      )}

      <div className="columns">
        <div className="stack">
          <div className="spread">
            <h2>Stamps</h2>
            <Link className="linky" href="/market">
              Market
            </Link>
          </div>
          {stampCards.length === 0 ? (
            <Empty
              title="No stamps yet"
              action={
                <Link className="btn btn--primary" href="/launch">
                  Launch a stamp
                </Link>
              }
            >
              Stamps appear here when ownership resolves to this wallet&apos;s destination.
            </Empty>
          ) : (
            <div className="stampgrid">
              {stampCards.map((s) => (
                <StampCard key={s.id} stamp={s} />
              ))}
            </div>
          )}

          <h2 style={{ marginTop: 6 }}>Token balances</h2>
          {!data || data.balances.length === 0 ? (
            <Empty
              title="No balances"
              action={
                <Link className="btn" href="/launch">
                  Launch a coin
                </Link>
              }
            >
              Launching a coin credits your optional initial purchase here, ready to burn.
            </Empty>
          ) : (
            <div className="coinlist">
              {data.balances.map((b) => (
                <CoinRow
                  key={b.mint}
                  coin={{
                    mint: b.mint,
                    name: b.name,
                    symbol: b.symbol,
                    imageDataUrl: collections.get(b.mint)?.imageDataUrl ?? null,
                  }}
                  href={`/convert?mint=${b.mint}`}
                  action="Convert"
                  detail={
                    <span className="num">
                      {formatUnits(b.amountBase, b.decimals)} {b.symbol}
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </div>

        <aside className="stack">
          <Panel>
            <h2>Issuance jobs</h2>
            {!data || data.jobs.length === 0 ? (
              <p className="tiny muted" style={{ marginTop: 8 }}>
                No issuance job has been started by this wallet.
              </p>
            ) : (
              <div className="steps" style={{ marginTop: 8 }}>
                {data.jobs.map((j) => (
                  <Link className="step" key={j.id} href={`/jobs/${j.id}`}>
                    <span className="tiny mono">{shortId(j.id, 8, 4)}</span>
                    <Badge state={j.state === "confirmed" ? "settled" : j.state}>
                      {humanState(j.state)}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel tone="ink">
            <h2>Ownership rules</h2>
            <ul className="tiny" style={{ marginTop: 8 }}>
              <li>Only the current owner can transfer or list a stamp.</li>
              <li>Spending the inscription output does not move a stamp.</li>
              <li>Stamps sent to outside addresses cannot be transferred here.</li>
            </ul>
          </Panel>

          <Tech>
            <dl className="kv">
              <dt>Public key (hex)</dt>
              <dd className="mono">{wallet.publicKeyHex}</dd>
              <dt>Stamps indexed</dt>
              <dd className="mono">{data?.stamps.length ?? 0}</dd>
              <dt>Raw balances</dt>
              <dd className="mono">
                {(data?.balances ?? [])
                  .map((b) => `${b.amountBase} base (${b.decimals} dp)`)
                  .join(", ") || "none"}
              </dd>
            </dl>
          </Tech>
        </aside>
      </div>
    </>
  );
}
