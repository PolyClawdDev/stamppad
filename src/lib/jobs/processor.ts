import { randomUUID } from "node:crypto";
import { flags } from "../mode";
import {
  acceptIssuance,
  buildClaimPackage,
  canonicalPreimage,
  commitmentOf,
  toHex,
  validateBurn,
  validatePublication,
  type IssuanceFields,
} from "../protocol";
import { executeDemoBurn } from "../solana/demo";
import { getStore, type JobRow, type StampRow } from "../store";
import { estimatePublicationFeeZat, publishDemoStamp, tickConfirmations } from "../zcash/demo";

const DEMO_MIN_CONFIRMS = 2;

export function newJobId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function processDueJobs(): Promise<void> {
  if (flags().mode !== "demo") {
    const { processLiveJobs } = await import("./live");
    await processLiveJobs();
    return;
  }
  const store = getStore();
  const f = flags();
  const { solana, zcash } = await store.loadDemo();
  tickConfirmations(zcash, DEMO_MIN_CONFIRMS);
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
      const tx = solana.txs[job.sourceTx];
      if (!tx) {
        await save(store, {
          ...job,
          state: "manual_review",
          rejectReason: "solana_reorg",
          rejectMessage: "Submitted burn disappeared from the ledger before finalization.",
          updatedAt: nowIso(),
        });
        continue;
      }
      const result = validateBurn(tx, {
        sourceNetwork: f.sourceNetwork,
        destinationNetwork: f.destNetwork,
        mint: job.mint,
        amountBase: BigInt(job.amountBase),
        decimals: job.decimals,
        destination: job.destination,
      });
      if (!result.ok) {
        await save(store, {
          ...job,
          state: "rejected",
          rejectReason: result.reason,
          rejectMessage: result.message,
          updatedAt: nowIso(),
        });
        continue;
      }
      const claim = buildClaimPackage(result.issuance, tx);
      await save(store, {
        ...job,
        state: "burn_finalized",
        burnLocator: result.issuance.burnLocator,
        tokenProgram: result.issuance.tokenProgram,
        burnAuthority: result.issuance.burnAuthority,
        authorityRole: result.issuance.authorityRole,
        intentLocator: result.issuance.intentLocator,
        commitmentHex: toHex(result.commitment),
        claimPackage: claim,
        updatedAt: nowIso(),
      });
      continue;
    }

    if (job.state === "burn_finalized" || job.state === "publication_pending" || job.state === "retryable") {
      if (!job.claimPackage || !job.commitmentHex) continue;
      try {
        const publication = job.zcashTx
          ? zcash.txs[job.zcashTx]
          : publishDemoStamp({
              chain: zcash,
              network: f.destNetwork,
              destination: job.destination,
              commitment: Buffer.from(job.commitmentHex, "hex"),
            });
        if (!publication) {
          await save(store, {
            ...job,
            state: "retryable",
            rejectReason: "zcash_payload_invalid",
            rejectMessage: "Publication tx missing; will retry the same commitment. Do not burn again.",
            updatedAt: nowIso(),
          });
          continue;
        }
        await save(store, {
          ...job,
          state: "zcash_confirmation_pending",
          zcashTx: publication.txid,
          zcashOutputIndex: publication.outputs[0]?.index ?? 0,
          zcashNullDataIndex: publication.outputs[1]?.index ?? 1,
          zcashHeight: publication.height,
          confirmations: publication.confirmations,
          rejectReason: null,
          rejectMessage: null,
          updatedAt: nowIso(),
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        await save(store, {
          ...job,
          state: "retryable",
          rejectReason: code === "insufficient_publication_funds" ? "insufficient_publication_funds" : "zcash_payload_invalid",
          rejectMessage:
            error instanceof Error
              ? error.message
              : "Publication failed. The burn is finalized; export the claim package instead of burning again.",
          updatedAt: nowIso(),
        });
      }
      continue;
    }

    if (job.state === "zcash_confirmation_pending" && job.zcashTx && job.claimPackage) {
      const publication = zcash.txs[job.zcashTx];
      if (!publication || !publication.inBestChain) {
        await save(store, {
          ...job,
          state: "publication_pending",
          zcashTx: null,
          rejectMessage: "Zcash publication left the best chain. Same commitment will be republished.",
          updatedAt: nowIso(),
        });
        continue;
      }
      const issuance = issuanceFromJob(job, f);
      const pub = validatePublication(issuance, publication, DEMO_MIN_CONFIRMS);
      if (!pub.ok) {
        await save(store, {
          ...job,
          confirmations: publication.confirmations,
          updatedAt: nowIso(),
        });
        continue;
      }
      const accepted = acceptIssuance(issuance, publication);
      const stamp: StampRow = {
        id: job.commitmentHex ?? toHex(commitmentOf(issuance)),
        jobId: job.id,
        ...accepted,
        createdAt: nowIso(),
      };
      await store.upsertStamp(stamp);
      const launch = await store.getLaunch(job.mint);
      if (launch) {
        const mint = solana.mints[job.mint];
        await store.upsertLaunch({
          ...launch,
          currentSupply: (mint?.supply ?? BigInt(launch.currentSupply)).toString(10),
        });
      }
      await save(store, {
        ...job,
        state: "confirmed",
        confirmations: publication.confirmations,
        zcashHeight: publication.height,
        updatedAt: nowIso(),
      });
    }
  }

  await store.saveDemo(solana, zcash);
}

export async function submitDemoBurn(input: {
  owner: string;
  mint: string;
  amountBase: bigint;
  destination: string;
  fail?: boolean;
}): Promise<JobRow> {
  const store = getStore();
  const f = flags();
  const { solana } = await store.loadDemo();
  const nonce = Buffer.from(randomUUID().replace(/-/g, "").slice(0, 32), "hex").toString("hex").slice(0, 32);
  const idempotencyKey = `${input.owner}:${input.mint}:${input.amountBase}:${input.destination}:${Date.now()}`;
  const existing = await store.findJobByIdempotency(idempotencyKey);
  if (existing) return existing;

  const tx = executeDemoBurn({
    chain: solana,
    owner: input.owner,
    mint: input.mint,
    amountBase: input.amountBase,
    destinationNetwork: f.destNetwork,
    destination: input.destination,
    nonce,
    fail: input.fail,
  });
  const { zcash } = await store.loadDemo();
  await store.saveDemo(solana, zcash);

  const job: JobRow = {
    id: newJobId(),
    state: "burn_submitted",
    mint: input.mint,
    owner: input.owner,
    amountBase: input.amountBase.toString(10),
    decimals: solana.mints[input.mint]?.decimals ?? 6,
    destination: input.destination,
    nonce,
    sourceTx: tx.signature,
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
  for (let i = 0; i < 8; i++) {
    await processDueJobs();
    const latest = await store.getJob(job.id);
    if (latest && ["confirmed", "rejected", "retryable", "manual_review"].includes(latest.state)) {
      return latest;
    }
  }
  return (await store.getJob(job.id)) ?? job;
}

function issuanceFromJob(job: JobRow, f: ReturnType<typeof flags>): IssuanceFields {
  return {
    protocol: "stamp-exp",
    version: 0,
    sourceNetwork: f.sourceNetwork,
    destinationNetwork: f.destNetwork,
    mint: job.mint,
    tokenProgram: job.tokenProgram ?? "",
    sourceTx: job.sourceTx ?? "",
    burnLocator: job.burnLocator ?? "",
    amountBase: job.amountBase,
    decimals: job.decimals,
    destination: job.destination,
    burnAuthority: job.burnAuthority ?? job.owner,
    authorityRole: (job.authorityRole as "owner" | "delegate") ?? "owner",
    intentLocator: job.intentLocator ?? "",
    nonce: job.nonce,
  };
}

async function save(store: ReturnType<typeof getStore>, job: JobRow) {
  await store.upsertJob(job);
}

export function publicationFeeQuote() {
  return {
    stampFeeBase: "0",
    zip317Zat: estimatePublicationFeeZat().toString(10),
    destinationNoticeZat: "10000",
    note: "Publication fees are paid by the isolated publisher in ZEC. They are not a reserve of burned tokens. STAMP protocol fee is 0 in v0.",
  };
}

export function preimagePreview(fields: IssuanceFields): string {
  return canonicalPreimage(fields);
}
