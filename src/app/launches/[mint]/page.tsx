"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CoinArt } from "@/components/art/PixelArt";
import { Badge, Empty, Loading, Note, Panel, Tech } from "@/components/ui";
import { formatUnits, humanState, shortId } from "@/lib/format";

export default function LaunchDetailPage() {
  const { mint } = useParams<{ mint: string }>();
  const [view, setView] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/launches/${mint}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setError(j.error.message);
        else setView(j.data);
      });
  }, [mint]);

  if (error) {
    return (
      <Note tone="error" title="Coin unavailable">
        {error}
      </Note>
    );
  }
  if (!view) {
    return (
      <Panel>
        <Loading label="Loading coin" />
      </Panel>
    );
  }

  const launch = view.launch as {
    name: string;
    symbol: string;
    mint: string;
    launchTx: string;
    stonkUrl: string;
    currentSupply: string;
    launchSupply: string;
    quoteSymbol: string;
    creator: string;
    source: string;
    decimals: number;
    description: string;
    imageDataUrl: string | null;
  };
  const stamps = (view.stamps as Array<{ id: string; amountBase: string; zcashTx: string }>) ?? [];
  const jobs = (view.jobs as Array<{ id: string; state: string; amountBase: string }>) ?? [];
  const market = view.solanaMarket as { note: string; error?: string; source: string };
  const dp = launch.decimals;

  return (
    <>
      <Panel>
        <div className="coinhead">
          <span className="coinhead__art">
            {launch.imageDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={launch.imageDataUrl} alt="" />
            ) : (
              <CoinArt seed={launch.mint} />
            )}
          </span>
          <div className="stack-sm" style={{ minWidth: 0 }}>
            <div className="cluster">
              <h1>{launch.name}</h1>
              <Badge tone="solid">{launch.symbol}</Badge>
              <Badge>vs {launch.quoteSymbol}</Badge>
            </div>
            <p className="muted">{launch.description || "No description was provided."}</p>
            <div className="cluster">
              <Link className="btn btn--sm btn--primary" href={`/convert?mint=${launch.mint}`}>
                Convert to a stamp
              </Link>
              <a className="btn btn--sm" href={launch.stonkUrl} target="_blank" rel="noreferrer">
                Trade on venue
              </a>
            </div>
          </div>
        </div>
      </Panel>

      <div className="columns">
        <div className="stack">
          <Panel>
            <h2>Supply and burns</h2>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Launch supply</dt>
              <dd className="num">
                {formatUnits(launch.launchSupply, dp)} {launch.symbol}
              </dd>
              <dt>Current supply</dt>
              <dd className="num">
                {formatUnits(String(view.currentSupply), dp)} {launch.symbol}
              </dd>
              <dt>Eligible to burn</dt>
              <dd className="num">
                {formatUnits(String(view.eligibleBurnsBase), dp)} {launch.symbol}
              </dd>
              <dt>Pending issuance</dt>
              <dd className="num">
                {formatUnits(String(view.pendingIssuanceBase), dp)} {launch.symbol}
              </dd>
              <dt>Stamped so far</dt>
              <dd className="num">
                {formatUnits(String(view.confirmedStampUnitsBase), dp)} {launch.symbol}
              </dd>
            </dl>
          </Panel>

          <Panel>
            <h2>Stamps from this collection</h2>
            {stamps.length === 0 ? (
              <div style={{ marginTop: 10 }}>
                <Empty
                  title="No stamps issued"
                  action={
                    <Link className="btn btn--sm btn--primary" href={`/convert?mint=${launch.mint}`}>
                      Convert tokens
                    </Link>
                  }
                >
                  Burning units of {launch.symbol} issues the first stamp for this collection.
                </Empty>
              </div>
            ) : (
              <div className="steps" style={{ marginTop: 8 }}>
                {stamps.map((s) => (
                  <Link className="step" key={s.id} href={`/collections/${launch.mint}/stamps/${s.id}`}>
                    <span className="mono tiny">{shortId(s.id, 12, 6)}</span>
                    <span className="num tiny">
                      {formatUnits(s.amountBase, dp)} {launch.symbol}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <aside className="stack">
          <Panel>
            <h2>Solana market</h2>
            <p className="tiny muted" style={{ marginTop: 8 }}>
              {market.note}
            </p>
            <p className="tiny dim">{market.error ?? market.source}</p>
            <p className="tiny dim">
              Stamp listings are a separate market in ZEC and are never mixed into the figures
              above.
            </p>
          </Panel>

          {jobs.length > 0 && (
            <Panel>
              <h2>Issuance jobs</h2>
              <div className="steps" style={{ marginTop: 8 }}>
                {jobs.map((j) => (
                  <Link className="step" key={j.id} href={`/jobs/${j.id}`}>
                    <span className="tiny num">
                      {formatUnits(j.amountBase, dp)} {launch.symbol}
                    </span>
                    <Badge state={j.state === "confirmed" ? "settled" : j.state}>
                      {humanState(j.state)}
                    </Badge>
                  </Link>
                ))}
              </div>
            </Panel>
          )}

          <Tech>
            <dl className="kv">
              <dt>Mint</dt>
              <dd className="mono">{launch.mint}</dd>
              <dt>Launch tx</dt>
              <dd className="mono">{launch.launchTx}</dd>
              <dt>Decimals</dt>
              <dd className="mono">{dp}</dd>
              <dt>Supply (base)</dt>
              <dd className="mono">{String(view.currentSupply)}</dd>
              <dt>Creator</dt>
              <dd className="mono">{launch.creator}</dd>
              <dt>Source</dt>
              <dd className="mono">{launch.source}</dd>
              <dt>Venue page</dt>
              <dd>
                <a className="linky" href={launch.stonkUrl} target="_blank" rel="noreferrer">
                  {launch.stonkUrl}
                </a>
              </dd>
            </dl>
            <p className="tiny dim" style={{ marginTop: 10 }}>
              Adoption on the venue is independent of this deployment; demo mints are not mainnet
              launches.
            </p>
          </Tech>
        </aside>
      </div>
    </>
  );
}
