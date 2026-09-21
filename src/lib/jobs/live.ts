import { flags } from "../mode";
import { acceptPublishedStamp, commitmentOf, toHex, type IssuanceFields } from "../protocol";
import { LiveStampPublisher } from "../modules/publisher";
import { SolanaRpc } from "../solana/rpc";
import { zcashRpcFromEnv } from "../zcash/rpc";
import { randomUUID } from "node:crypto";
import { getStore, type JobRow, type StampRow } from "../store";

function newJobId(): string {
  return randomUUID();
}
function nowIso(): string {
  return new Date().toISOString();
}

export async function submitLiveBurn(input: {
  owner: string;
  mint: string;
  amountBase: bigint;
  decimals: number;
  destination: string;
  sourceTx: string;
}): Promise<JobRow> {
  const store = getStore();
  const idempotencyKey = `${input.owner}:${input.sourceTx}`;
  const existing = await store.findJobByIdempotency(idempotencyKey);
  if (existing) return existing;

  const job: JobRow = {
    id: newJobId(),
    state: "burn_submitted",
    mint: input.mint,
    owner: input.owner,
    amountBase: input.amountBase.toString(10),
    decimals: input.decimals,
    destination: input.destination,
    nonce: input.sourceTx.slice(0, 32),
    sourceTx: input.sourceTx,
    burnLocator: null,
    tokenProgram: null,
    burnAuthority: input.owner,
    authorityRole: "owner",
    intentLocator: null,
    commitmentHex: null,
    zcashTx: null,
    zcashOutputIndex: null,
    zcashNullDataIndex: null,
    zcashHeight: null,
    confirmations: 0,
    rejectReason: null,
    rejectMessage: null,
    claimPackage: null,
    idempotencyKey,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await store.upsertJob(job);
  await processLiveJobs();
  return (await store.getJob(job.id)) ?? job;
}

export async function processLiveJobs(): Promise<void> {
  const store = getStore();
  const f = flags();
  const jobs = await store.listJobs();
  for (const job of jobs) {
    if (
      job.state === "confirmed" ||
      job.state === "rejected" ||
      job.state === "manual_review" ||
      job.state === "awaiting_authorization" ||
      job.state === "draft"
    ) {
      continue;
    }

    if (job.state === "burn_submitted" && job.sourceTx) {
      if (!f.solanaRpc) continue;
      const burns = await new SolanaRpc(f.solanaRpc).fetchBurns(job.sourceTx);
      const match = burns.find((burn) => burn.mint === job.mint && burn.finalized && !burn.err);
      if (!match) continue;
      if (match.amountBase !== job.amountBase) {
        await store.upsertJob({
          ...job,
          state: "rejected",
          rejectReason: "wrong_amount",
          rejectMessage: `Burn destroyed ${match.amountBase}, job expected ${job.amountBase}.`,
          updatedAt: nowIso(),
        });
        continue;
      }
      const memoOk = match.memos.some((memo) => memo.text.includes(job.destination));
      if (!memoOk) {
        await store.upsertJob({
          ...job,
          state: "rejected",
          rejectReason: "missing_intent",
          rejectMessage: "The finalized burn does not name this Zcash destination in its memo.",
          updatedAt: nowIso(),
        });
        continue;
      }
      const issuance = issuanceFrom(job, f);
      await store.upsertJob({
        ...job,
        state: "burn_finalized",
        burnLocator: `${job.sourceTx}:burn`,
        tokenProgram: job.tokenProgram ?? "",
        burnAuthority: match.authority,
        intentLocator: `${job.sourceTx}:memo`,
        commitmentHex: toHex(commitmentOf(issuance)),
        updatedAt: nowIso(),
      });
      continue;
    }

    if (job.state === "burn_finalized" || job.state === "publication_pending" || job.state === "retryable") {
      if (!job.commitmentHex || !job.sourceTx) continue;
      try {
        const publication = await new LiveStampPublisher().publishIssuance({
          destination: job.destination,
          commitmentHex: job.commitmentHex,
          mint: job.mint,
          burn: job.sourceTx,
          amountBase: job.amountBase,
        });
        await store.upsertJob({
          ...job,
          state: "zcash_confirmation_pending",
          zcashTx: publication.txid,
          zcashOutputIndex: publication.outputs[0]?.index ?? 0,
          zcashNullDataIndex: publication.outputs[0]?.index ?? 0,
          zcashHeight: publication.height,
          confirmations: publication.confirmations,
          rejectReason: null,
          rejectMessage: null,
          updatedAt: nowIso(),
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        await store.upsertJob({
          ...job,
          state: "retryable",
          rejectReason: code === "insufficient_publication_funds" ? "insufficient_publication_funds" : "zcash_payload_invalid",
          rejectMessage: error instanceof Error ? error.message : "Publication failed. The burn is finalized; do not burn again.",
          updatedAt: nowIso(),
        });
      }
      continue;
    }

    if (job.state === "zcash_confirmation_pending" && job.zcashTx) {
      if (!f.zcashRpc) continue;
      let height = job.zcashHeight ?? 0;
      let confirmations = job.confirmations;
      let inBestChain = true;
      try {
        const rpc = zcashRpcFromEnv();
        const tip = await rpc.getChainTip();
        const seen = await rpc.getTransaction(job.zcashTx);
        height = seen.height ?? height;
        confirmations = seen.confirmations ?? (seen.height ? tip.height - seen.height + 1 : 0);
        inBestChain = Boolean(seen.height);
      } catch {
        confirmations = job.confirmations;
      }
      if (!inBestChain || confirmations < f.zcashMinConfirmations) {
        await store.upsertJob({
          ...job,
          confirmations,
          zcashHeight: height,
          updatedAt: nowIso(),
        });
        continue;
      }
      const issuance = issuanceFrom(job, f);
      const accepted = acceptPublishedStamp(issuance, {
        txid: job.zcashTx,
        network: f.destNetwork,
        height,
        confirmations,
        inBestChain: true,
        outputs: [{ index: job.zcashOutputIndex ?? 0, valueZat: 546n, address: job.destination, nullData: null }],
      });
      const stamp: StampRow = {
        id: job.commitmentHex ?? accepted.commitmentHex,
        jobId: job.id,
        ...accepted,
        createdAt: nowIso(),
      };
      await store.upsertStamp(stamp);
      await store.upsertJob({
        ...job,
        state: "confirmed",
        confirmations,
        zcashHeight: height,
        updatedAt: nowIso(),
      });
    }
  }
}

function issuanceFrom(job: JobRow, f: ReturnType<typeof flags>): IssuanceFields {
  return {
    protocol: "stamp-exp",
    version: 0,
    sourceNetwork: f.sourceNetwork,
    destinationNetwork: f.destNetwork,
    mint: job.mint,
    tokenProgram: job.tokenProgram ?? "",
    sourceTx: job.sourceTx ?? "",
    burnLocator: job.burnLocator ?? `${job.sourceTx}:burn`,
    amountBase: job.amountBase,
    decimals: job.decimals,
    destination: job.destination,
    burnAuthority: job.burnAuthority ?? job.owner,
    authorityRole: (job.authorityRole as "owner" | "delegate") ?? "owner",
    intentLocator: job.intentLocator ?? `${job.sourceTx}:memo`,
    nonce: job.nonce,
  };
}
