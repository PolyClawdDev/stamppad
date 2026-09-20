/**
 * Deterministic indexer.
 *
 * Everything the product shows about issuance and ownership is derived here by
 * replaying canonical chain data. Nothing is read back from mutable app state,
 * so an independent operator with the same chain data and the same published
 * authorization artifacts computes the same ledger.
 */
import { flags } from "../mode";
import {
  rebuildLedger,
  recordsFromPublications,
  resolveOwnership,
  type AcceptedIssuance,
  type CanonicalSolanaTx,
  type OwnershipOutput,
  type RebuildOutput,
  type SettlementOffer,
  type TransferAuthorization,
  type ZcashPublication,
} from "../protocol";
import { getStore } from "../store";
import type { ListingRow } from "../store/types";

export const DEMO_MIN_CONFIRMS = 2;

export interface IndexInput {
  solana: CanonicalSolanaTx[];
  zcash: ZcashPublication[];
  transferArtifacts: TransferAuthorization[];
  offerArtifacts: SettlementOffer[];
  minZcashConfirmations?: number;
}

export interface IndexedState {
  issuance: RebuildOutput;
  ownership: OwnershipOutput;
  invariants: {
    acceptedStampUnits: Record<string, string>;
    ownershipChainsContiguous: boolean;
    conflictingSales: number;
    unresolvedRecords: number;
  };
}

export function indexChains(input: IndexInput): IndexedState {
  const f = flags();
  const min = input.minZcashConfirmations ?? (f.mode === "demo" ? DEMO_MIN_CONFIRMS : f.zcashMinConfirmations);

  const issuance = rebuildLedger({
    sourceNetwork: f.sourceNetwork,
    destinationNetwork: f.destNetwork,
    minZcashConfirmations: min,
    solana: input.solana,
    zcash: input.zcash,
  });

  const ownership = resolveOwnership({
    destinationNetwork: f.destNetwork,
    minConfirmations: min,
    stamps: issuance.accepted.map((row: AcceptedIssuance) => ({
      commitmentHex: row.commitmentHex,
      originalRecipient: row.destination,
    })),
    records: recordsFromPublications(input.zcash),
    transferArtifacts: [...input.transferArtifacts].sort(byTransfer),
    offerArtifacts: [...input.offerArtifacts].sort(byOffer),
  });

  const chains = Object.values(ownership.stamps);
  const contiguous = chains.every((s) =>
    s.history.every((event, i) => event.sequence === i + 1),
  );

  return {
    issuance,
    ownership,
    invariants: {
      acceptedStampUnits: issuance.acceptedStampUnits,
      ownershipChainsContiguous: contiguous,
      conflictingSales: ownership.rejected.filter(
        (r) => r.reason === "conflicting_offer" || r.reason === "conflicting_transfer",
      ).length,
      unresolvedRecords: ownership.pending.length,
    },
  };
}

export async function indexFromStore(): Promise<IndexedState> {
  const store = getStore();
  const { solana, zcash } = await store.loadDemo();
  const [transfers, listings] = await Promise.all([store.listTransfers(), store.listListings()]);
  return indexChains({
    solana: Object.values(solana.txs),
    zcash: Object.values(zcash.txs),
    transferArtifacts: transfers.map((t) => t.artifact),
    offerArtifacts: offersFrom(listings),
  });
}

export function offersFrom(listings: ListingRow[]): SettlementOffer[] {
  return listings.flatMap((l) => (l.offerArtifact ? [l.offerArtifact] : []));
}

/** Ownership for one stamp, defaulting to the issuance recipient. */
export function ownerOf(
  state: IndexedState,
  commitmentHex: string,
  fallbackRecipient: string,
): { currentOwner: string; sequence: number } {
  const row = state.ownership.stamps[commitmentHex];
  return row
    ? { currentOwner: row.currentOwner, sequence: row.sequence }
    : { currentOwner: fallbackRecipient, sequence: 0 };
}

function byTransfer(a: TransferAuthorization, b: TransferAuthorization): number {
  if (a.stampCommitmentHex !== b.stampCommitmentHex) {
    return a.stampCommitmentHex < b.stampCommitmentHex ? -1 : 1;
  }
  return a.sequence - b.sequence;
}

function byOffer(a: SettlementOffer, b: SettlementOffer): number {
  if (a.stampCommitmentHex !== b.stampCommitmentHex) {
    return a.stampCommitmentHex < b.stampCommitmentHex ? -1 : 1;
  }
  return a.sequence - b.sequence;
}
