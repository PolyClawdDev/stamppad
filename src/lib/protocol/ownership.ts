/**
 * Deterministic ownership resolution for stamp-exp/1.
 *
 * Two validators replaying the same canonical records and the same published
 * authorization artifacts must produce identical ownership state.
 */
import { decodeRecord, offerArtifactHash, transferArtifactHash, verifyHashLock, verifyOwnerSignature, transferPreimage, offerPreimage, type OnChainRecord, type SettlementOffer, type TransferAuthorization } from "./transfer";
import { toHex } from "./encoding";
import type { DestNetwork, ZcashPublication } from "./types";

export type OwnershipRejectReason =
  | "unauthorized_transfer"
  | "wrong_sequence"
  | "conflicting_transfer"
  | "conflicting_offer"
  | "offer_mismatch"
  | "hash_lock_unsatisfied"
  | "unknown_stamp"
  | "authorization_unavailable"
  | "wrong_network";

export interface CanonicalRecord {
  txid: string;
  height: number;
  outputIndex: number;
  confirmations: number;
  inBestChain: boolean;
  network: DestNetwork;
  record: OnChainRecord;
}

export interface OwnershipEvent {
  sequence: number;
  from: string;
  to: string;
  txid: string;
  height: number;
  offerHashHex: string;
  priceZat: string | null;
}

export interface StampOwnership {
  stampCommitmentHex: string;
  originalRecipient: string;
  currentOwner: string;
  sequence: number;
  history: OwnershipEvent[];
  boundOffers: Record<number, { offerHashHex: string; offer: SettlementOffer }>;
  transferable: boolean;
}

export interface OwnershipInput {
  destinationNetwork: DestNetwork;
  minConfirmations: number;
  /** Accepted issuances: stamp commitment -> original recipient address. */
  stamps: Array<{ commitmentHex: string; originalRecipient: string }>;
  records: CanonicalRecord[];
  transferArtifacts: TransferAuthorization[];
  offerArtifacts: SettlementOffer[];
}

export interface OwnershipOutput {
  stamps: Record<string, StampOwnership>;
  pending: Array<{ txid: string; stampCommitmentHex: string; reason: string }>;
  rejected: Array<{
    txid: string;
    stampCommitmentHex: string;
    reason: OwnershipRejectReason;
    message: string;
  }>;
  sales: Array<{
    stampCommitmentHex: string;
    sequence: number;
    seller: string;
    buyer: string;
    priceZat: string;
    txid: string;
    height: number;
  }>;
}

/** Canonical order: confirmed height, then txid, then output index. */
export function compareRecords(a: CanonicalRecord, b: CanonicalRecord): number {
  if (a.height !== b.height) return a.height - b.height;
  if (a.txid !== b.txid) return a.txid < b.txid ? -1 : 1;
  return a.outputIndex - b.outputIndex;
}

export function recordsFromPublications(
  publications: ZcashPublication[],
): CanonicalRecord[] {
  const out: CanonicalRecord[] = [];
  for (const publication of publications) {
    for (const output of publication.outputs) {
      if (!output.nullData) continue;
      const record = decodeRecord(output.nullData);
      if (!record) continue;
      out.push({
        txid: publication.txid,
        height: publication.height ?? 0,
        outputIndex: output.index,
        confirmations: publication.confirmations,
        inBestChain: publication.inBestChain,
        network: publication.network,
        record,
      });
    }
  }
  return out.sort(compareRecords);
}

export function resolveOwnership(input: OwnershipInput): OwnershipOutput {
  const stamps: Record<string, StampOwnership> = {};
  for (const stamp of input.stamps) {
    stamps[stamp.commitmentHex] = {
      stampCommitmentHex: stamp.commitmentHex,
      originalRecipient: stamp.originalRecipient,
      currentOwner: stamp.originalRecipient,
      sequence: 0,
      history: [],
      boundOffers: {},
      transferable: true,
    };
  }

  const transfersByHash = new Map<string, TransferAuthorization>();
  for (const auth of input.transferArtifacts) {
    transfersByHash.set(toHex(transferArtifactHash(auth)), auth);
  }
  const offersByHash = new Map<string, SettlementOffer>();
  for (const offer of input.offerArtifacts) {
    offersByHash.set(toHex(offerArtifactHash(offer)), offer);
  }

  const pending: OwnershipOutput["pending"] = [];
  const rejected: OwnershipOutput["rejected"] = [];
  const sales: OwnershipOutput["sales"] = [];

  for (const entry of [...input.records].sort(compareRecords)) {
    const { record } = entry;
    const stamp = stamps[record.stampCommitmentHex];
    if (!stamp) {
      rejected.push({
        txid: entry.txid,
        stampCommitmentHex: record.stampCommitmentHex,
        reason: "unknown_stamp",
        message: "Record references a commitment with no accepted issuance.",
      });
      continue;
    }
    if (entry.network !== input.destinationNetwork) {
      rejected.push({
        txid: entry.txid,
        stampCommitmentHex: record.stampCommitmentHex,
        reason: "wrong_network",
        message: `Record is on ${entry.network}, expected ${input.destinationNetwork}.`,
      });
      continue;
    }
    if (!entry.inBestChain || entry.confirmations < input.minConfirmations) {
      pending.push({
        txid: entry.txid,
        stampCommitmentHex: record.stampCommitmentHex,
        reason: entry.inBestChain ? "awaiting_confirmations" : "not_in_best_chain",
      });
      continue;
    }

    if (record.kind === "offer") {
      const offer = offersByHash.get(record.artifactHashHex);
      if (!offer) {
        pending.push({
          txid: entry.txid,
          stampCommitmentHex: record.stampCommitmentHex,
          reason: "offer_artifact_unavailable",
        });
        continue;
      }
      const check = checkOffer(stamp, offer, record);
      if (!check.ok) {
        rejected.push({
          txid: entry.txid,
          stampCommitmentHex: record.stampCommitmentHex,
          reason: check.reason,
          message: check.message,
        });
        continue;
      }
      if (stamp.boundOffers[record.sequence]) {
        rejected.push({
          txid: entry.txid,
          stampCommitmentHex: record.stampCommitmentHex,
          reason: "conflicting_offer",
          message:
            "Another offer already bound this ownership sequence. The earliest confirmed offer wins; a second sale at the same sequence is refused.",
        });
        continue;
      }
      stamp.boundOffers[record.sequence] = { offerHashHex: record.artifactHashHex, offer };
      continue;
    }

    const auth = transfersByHash.get(record.artifactHashHex);
    if (!auth) {
      pending.push({
        txid: entry.txid,
        stampCommitmentHex: record.stampCommitmentHex,
        reason: "authorization_unavailable",
      });
      continue;
    }
    const check = checkTransfer(stamp, auth, record);
    if (!check.ok) {
      rejected.push({
        txid: entry.txid,
        stampCommitmentHex: record.stampCommitmentHex,
        reason: check.reason,
        message: check.message,
      });
      continue;
    }

    const bound = stamp.boundOffers[record.sequence];
    stamp.history.push({
      sequence: record.sequence,
      from: auth.fromAddress,
      to: auth.toAddress,
      txid: entry.txid,
      height: entry.height,
      offerHashHex: auth.offerHashHex,
      priceZat: bound?.offer.priceZat ?? null,
    });
    stamp.currentOwner = auth.toAddress;
    stamp.sequence = record.sequence;
    if (bound) {
      sales.push({
        stampCommitmentHex: record.stampCommitmentHex,
        sequence: record.sequence,
        seller: auth.fromAddress,
        buyer: auth.toAddress,
        priceZat: bound.offer.priceZat,
        txid: entry.txid,
        height: entry.height,
      });
    }
  }

  return { stamps, pending, rejected, sales };
}

type Check =
  | { ok: true }
  | { ok: false; reason: OwnershipRejectReason; message: string };

function checkTransfer(
  stamp: StampOwnership,
  auth: TransferAuthorization,
  record: OnChainRecord,
): Check {
  if (auth.stampCommitmentHex !== record.stampCommitmentHex || auth.sequence !== record.sequence) {
    return {
      ok: false,
      reason: "unauthorized_transfer",
      message: "Authorization does not match the on-chain record it is committed to.",
    };
  }
  if (record.sequence !== stamp.sequence + 1) {
    return {
      ok: false,
      reason: "wrong_sequence",
      message: `Transfer targets sequence ${record.sequence}; the stamp is at ${stamp.sequence}. Replays and skipped sequences are refused.`,
    };
  }
  if (auth.fromAddress !== stamp.currentOwner) {
    return {
      ok: false,
      reason: "unauthorized_transfer",
      message: "Signer is not the current owner of this stamp.",
    };
  }
  const signature = verifyOwnerSignature({
    address: auth.fromAddress,
    publicKeyHex: auth.ownerPublicKeyHex,
    preimage: transferPreimage(auth),
    signatureHex: auth.signatureHex,
  });
  if (!signature.ok) {
    return { ok: false, reason: "unauthorized_transfer", message: signature.message };
  }

  const bound = stamp.boundOffers[record.sequence];
  if (!bound) {
    if (auth.offerHashHex !== "none") {
      return {
        ok: false,
        reason: "offer_mismatch",
        message: "Transfer references an offer that is not bound on chain at this sequence.",
      };
    }
    return { ok: true };
  }
  if (auth.offerHashHex !== bound.offerHashHex) {
    return {
      ok: false,
      reason: "offer_mismatch",
      message: "A different offer is bound at this sequence. The stamp cannot be sold twice.",
    };
  }
  if (auth.toAddress !== bound.offer.buyerAddress) {
    return {
      ok: false,
      reason: "offer_mismatch",
      message: "Transfer recipient does not match the buyer named in the bound offer.",
    };
  }
  if (!verifyHashLock(bound.offer.hashLockHex, auth.preimageHex)) {
    return {
      ok: false,
      reason: "hash_lock_unsatisfied",
      message:
        "Transfer does not reveal the hash-lock preimage the seller must expose when claiming payment.",
    };
  }
  return { ok: true };
}

function checkOffer(
  stamp: StampOwnership,
  offer: SettlementOffer,
  record: OnChainRecord,
): Check {
  if (offer.stampCommitmentHex !== record.stampCommitmentHex || offer.sequence !== record.sequence) {
    return {
      ok: false,
      reason: "offer_mismatch",
      message: "Offer does not match the on-chain record it is committed to.",
    };
  }
  if (record.sequence !== stamp.sequence + 1) {
    return {
      ok: false,
      reason: "wrong_sequence",
      message: `Offer targets sequence ${record.sequence}; the stamp is at ${stamp.sequence}.`,
    };
  }
  if (offer.sellerAddress !== stamp.currentOwner) {
    return {
      ok: false,
      reason: "unauthorized_transfer",
      message: "Offer was not signed by the current owner.",
    };
  }
  const signature = verifyOwnerSignature({
    address: offer.sellerAddress,
    publicKeyHex: offer.ownerPublicKeyHex,
    preimage: offerPreimage(offer),
    signatureHex: offer.signatureHex,
  });
  if (!signature.ok) {
    return { ok: false, reason: "unauthorized_transfer", message: signature.message };
  }
  return { ok: true };
}
