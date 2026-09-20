"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
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
    claimPackage?: unknown;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("");

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

  const mint = payload?.job.mint ? String(payload.job.mint) : "";
  useEffect(() => {
    if (!mint) return;
    void fetch(`/api/launches/${mint}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.data?.launch) setSymbol(j.data.launch.symbol);
      });
  }, [mint]);

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
        <p className="lede muted">
          Burning{" "}
          <strong className="num">
            {formatUnits(String(job.amountBase), decimals)} {symbol || "tokens"}
          </strong>{" "}
          into one Zcash stamp.
        </p>

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
