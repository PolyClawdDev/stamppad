/**
 * Completed-sale history.
 *
 * Price history comes from the indexer's accepted ownership records, so a sale
 * only appears here once the protocol itself would recognise the transfer.
 * Listings that failed, were cancelled, expired, or are still mid-settlement
 * never reach this list, and a stamp's asking price is never mixed into it.
 *
 * The chain data carries block height but no wall clock, so the timestamp is
 * the moment this deployment published the settling record. It is annotation,
 * not consensus: `timeSource` says which of the two a caller is looking at.
 */
import { indexFromStore, type IndexedState } from "./indexer";
import { stampMode } from "./mode";
import { getStore, type LaunchRow, type StampRow } from "./store";

export interface CompletedSale {
  /** Collection identifier: the Solana mint the burned units came from. */
  mint: string;
  collection: string;
  symbol: string;
  decimals: number;
  /** Inscription identifier: the stamp commitment. */
  stampId: string;
  stampNumber: number;
  /** Quantity the stamp represents, in base units. */
  amountBase: string;
  sequence: number;
  seller: string;
  buyer: string;
  priceZat: string;
  /** Price divided by represented quantity, in zatoshi per whole token. */
  unitPriceZat: string | null;
  txid: string;
  height: number;
  settledAt: string | null;
  timeSource: "record_published" | "block_height_only";
  simulated: boolean;
}

export interface SaleHistory {
  sales: CompletedSale[];
  simulated: boolean;
  note: string;
}

/**
 * Stamp numbers are positional within a collection, ordered by the height the
 * issuance was inscribed at, so the same stamp always carries the same number.
 */
export function numberStamps(stamps: StampRow[]): Map<string, number> {
  const byMint = new Map<string, StampRow[]>();
  for (const stamp of stamps) {
    const list = byMint.get(stamp.mint) ?? [];
    list.push(stamp);
    byMint.set(stamp.mint, list);
  }
  const out = new Map<string, number>();
  for (const list of byMint.values()) {
    list
      .slice()
      .sort((a, b) => a.zcashHeight - b.zcashHeight || (a.id < b.id ? -1 : 1))
      .forEach((stamp, i) => out.set(stamp.id, i + 1));
  }
  return out;
}

export async function saleHistory(state?: IndexedState): Promise<SaleHistory> {
  const store = getStore();
  const indexed = state ?? (await indexFromStore());
  const [stamps, launches, transfers, listings] = await Promise.all([
    store.listStamps(),
    store.listLaunches(),
    store.listTransfers(),
    store.listListings(),
  ]);

  const byCommitment = new Map<string, StampRow>(stamps.map((s) => [s.commitmentHex, s]));
  const byMint = new Map<string, LaunchRow>(launches.map((l) => [l.mint, l]));
  const numbers = numberStamps(stamps);
  // Settlement time: the transfer record first, then the listing it closed.
  const publishedAt = new Map<string, string>();
  for (const t of transfers) publishedAt.set(t.txid, t.createdAt);
  for (const l of listings) {
    if (l.state === "settled" && l.transferTxid && !publishedAt.has(l.transferTxid)) {
      publishedAt.set(l.transferTxid, l.updatedAt);
    }
  }

  const simulated = stampMode() === "demo";
  const seen = new Set<string>();
  const sales: CompletedSale[] = [];

  for (const sale of indexed.ownership.sales) {
    // One accepted record per ownership sequence; drop any replayed duplicate.
    const key = `${sale.stampCommitmentHex}:${sale.sequence}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const stamp = byCommitment.get(sale.stampCommitmentHex);
    if (!stamp) continue;
    const launch = byMint.get(stamp.mint);
    const settledAt = publishedAt.get(sale.txid) ?? null;

    sales.push({
      mint: stamp.mint,
      collection: launch?.name ?? "Unlisted collection",
      symbol: launch?.symbol ?? "",
      decimals: stamp.decimals,
      stampId: stamp.id,
      stampNumber: numbers.get(stamp.id) ?? 1,
      amountBase: stamp.amountBase,
      sequence: sale.sequence,
      seller: sale.seller,
      buyer: sale.buyer,
      priceZat: sale.priceZat,
      unitPriceZat: unitPrice(sale.priceZat, stamp.amountBase, stamp.decimals),
      txid: sale.txid,
      height: sale.height,
      settledAt,
      timeSource: settledAt ? "record_published" : "block_height_only",
      simulated,
    });
  }

  sales.sort((a, b) => a.height - b.height || (a.txid < b.txid ? -1 : 1));

  return {
    sales,
    simulated,
    note: simulated
      ? "Every sale below was settled against this deployment's simulated Zcash ledger. No external trade history is imported."
      : "Sales are derived from accepted ownership records replayed by the indexer.",
  };
}

/**
 * Zatoshi paid per whole represented token, rounded down. Stamps of different
 * sizes are only comparable once price is divided by what each one represents.
 */
export function unitPrice(priceZat: string, amountBase: string, decimals: number): string | null {
  try {
    const amount = BigInt(amountBase);
    if (amount <= 0n) return null;
    const scale = 10n ** BigInt(decimals);
    return ((BigInt(priceZat) * scale) / amount).toString(10);
  } catch {
    return null;
  }
}

/** Newest accepted sale for one stamp, or null when it has never sold. */
export function lastSaleOf(history: CompletedSale[], stampId: string): CompletedSale | null {
  let out: CompletedSale | null = null;
  for (const sale of history) if (sale.stampId === stampId) out = sale;
  return out;
}
