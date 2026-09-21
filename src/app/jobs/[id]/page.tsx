"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StampImage, stampTitle } from "@/components/AssetCards";
import { Badge, Loading, Note, Panel, Tech } from "@/components/ui";
import { formatUnits, humanState, shortId } from "@/lib/format";

const ORDER = [
  "draft",
  "awaiting_authorization",
  "burn_submitted",
  "burn_finalized",
  "publication_pending",
  "zcash_confirmation_pending",
  "confirmed",
];

const EXPLAIN: Record<string, string> = {
  draft: "Prepared, nothing has been sent.",
  awaiting_authorization: "Waiting for the burn authority's signature.",
  burn_submitted: "Burn sent to Solana, not final yet.",
  burn_finalized: "Supply is destroyed. This cannot be undone.",
  publication_pending: "Writing the inscription to Zcash.",
  zcash_confirmation_pending: "Published, waiting for confirmations.",
  confirmed: "Stamp issued and verified by the indexer.",
};

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const [payload, setPayload] = useState<{
    job: Record<string, unknown>;
    /** The launch this stamp is being cut from, served with the job. */
    collection: { name: string | null; symbol: string; imageDataUrl: string | null };
    claimPackage?: unknown;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    async function load() {
      const res = await fetch(`/api/jobs/${id}`);
      const json = await res.json();
      if (cancel) return;
      if (json.error) setError(json.error.message);
      else setPayload(json.data);
    }
    void load();
    const t = setInterval(() => void load(), 1500);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, [id]);

  if (error) {
    return (
      <Note tone="error" title="Job unavailable">
        {error}
      </Note>
    );
  }
  if (!payload) {
    return (
      <Panel>
        <Loading label="Loading job" />
      </Panel>
    );
  }

  const job = payload.job;
  const collection = payload.collection;
  const state = String(job.state);
  const decimals = Number(job.decimals ?? 0);
  const reached = ORDER.indexOf(state);

  return (
    <div className="split">
      <Panel>
        <div className="panel__head">
          <h1>Issuance</h1>
          <Badge state={state === "confirmed" ? "settled" : state}>{humanState(state)}</Badge>
        </div>

        <div className="assethead">
          {/* Only the uploaded artwork appears here. The generated motif is seeded
              from the inscription identifier, which does not exist until the stamp
              is cut, so drawing one now would show a face that then changed. */}
          {collection.imageDataUrl && (
            <div className="assethead__art">
              <div className="stampcard stampcard--static">
                <div className="stampcard__art">
                  <StampImage
                    stamp={{ id: String(id), name: collection.name, imageDataUrl: collection.imageDataUrl }}
                  />
                  <span className="stampcard__denom">
                    {formatUnits(String(job.amountBase), decimals)} {collection.symbol}
                  </span>
                </div>
              </div>
            </div>
          )}
          <div className="stack-sm" style={{ minWidth: 0 }}>
            <h2>{stampTitle(collection.name)}</h2>
            <p className="lede muted">
              Burning{" "}
              <strong className="num">
                {formatUnits(String(job.amountBase), decimals)} {collection.symbol || "tokens"}
              </strong>{" "}
              into one Zcash stamp.
            </p>
          </div>
        </div>

        <div className="steps" style={{ marginTop: 14 }}>
          {ORDER.map((s, i) => {
            const done = reached >= 0 && i < reached;
            const now = s === state;
            return (
              <div className={`step${now ? " step--now" : ""}`} key={s}>
                <span className={done ? "muted" : undefined}>{humanState(s)}</span>
                <span className="tiny dim">{now ? EXPLAIN[s] : done ? "done" : ""}</span>
              </div>
            );
          })}
        </div>

        {state === "rejected" && (
          <Note tone="error" title="Rejected">
            {String(job.rejectMessage)}
          </Note>
        )}
        {state === "retryable" && (
          <Note tone="warn" title="Publication failed after a finalized burn">
            {String(job.rejectMessage)} The burn must not be repeated; export the claim package so
            the inscription can be published later.
          </Note>
        )}

        <div className="cluster" style={{ marginTop: 14 }}>
          {Boolean(job.hasClaimPackage) && (
            <a className="btn" href={`/api/claims/${id}`}>
              Export claim package
            </a>
          )}
          {state === "confirmed" && Boolean(job.mint) && (
            <Link className="btn btn--primary" href={`/launches/${String(job.mint)}`}>
              View coin
            </Link>
          )}
          <Link className="btn" href="/portfolio">
            Portfolio
          </Link>
        </div>
      </Panel>

      <aside className="stack">
        <Panel tone="ink">
          <h2>Why this takes steps</h2>
          <p className="tiny" style={{ marginTop: 8 }}>
            Solana and Zcash do not settle together. The burn must be final before anything is
            inscribed, so a finalized burn can sit waiting on publication. Nothing here is
            reversible once supply is destroyed.
          </p>
        </Panel>

        <Tech>
          <dl className="kv">
            <dt>Job</dt>
            <dd className="mono">{String(id)}</dd>
            <dt>Amount (base)</dt>
            <dd className="mono">
              {String(job.amountBase)} · {decimals} decimals
            </dd>
            <dt>Solana tx</dt>
            <dd className="mono">{job.sourceTx ? shortId(String(job.sourceTx), 20, 8) : "—"}</dd>
            <dt>Zcash tx</dt>
            <dd className="mono">{job.zcashTx ? shortId(String(job.zcashTx), 20, 8) : "—"}</dd>
            <dt>Destination</dt>
            <dd className="mono">{String(job.destination)}</dd>
          </dl>
        </Tech>
      </aside>
    </div>
  );
}
