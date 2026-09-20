import type {
  CanonicalSolanaTx,
  ClaimPackage,
  JobState,
  RejectReason,
  SettlementOffer,
  TransferAuthorization,
  ZcashPublication,
} from "../protocol";
import type { DemoChainState, DemoMintState } from "../solana/demo";
import type { DemoZcashChain } from "../zcash/demo";

export interface LaunchRow {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  imageDataUrl: string | null;
  quoteMint: string;
  quoteSymbol: string;
  tokenProgram: string;
  decimals: number;
  launchSupply: string;
  poolBase: string;
  currentSupply: string;
  creator: string;
  launchTx: string;
  stonkUrl: string;
  source: string;
  createdAt: string;
}

export interface JobRow {
  id: string;
  state: JobState;
  mint: string;
  owner: string;
  amountBase: string;
  decimals: number;
  destination: string;
  nonce: string;
  sourceTx: string | null;
  burnLocator: string | null;
  tokenProgram: string | null;
  burnAuthority: string | null;
  authorityRole: string | null;
  intentLocator: string | null;
  commitmentHex: string | null;
  zcashTx: string | null;
  zcashOutputIndex: number | null;
  zcashNullDataIndex: number | null;
  zcashHeight: number | null;
  confirmations: number;
  rejectReason: RejectReason | null;
  rejectMessage: string | null;
  claimPackage: ClaimPackage | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface StampRow {
  id: string;
  jobId: string;
  protocol: "stamp-exp";
  version: 0;
  sourceNetwork: string;
  destinationNetwork: string;
  mint: string;
  tokenProgram: string;
  sourceTx: string;
  burnLocator: string;
  amountBase: string;
  decimals: number;
  destination: string;
  burnAuthority: string;
  authorityRole: string;
  intentLocator: string;
  nonce: string;
  commitmentHex: string;
  zcashTx: string;
  zcashOutputIndex: number;
  zcashNullDataIndex: number;
  zcashHeight: number;
  confirmations: number;
  createdAt: string;
}

export type ListingState =
  | "listed"
  | "reserved"
  | "offer_published"
  | "authorized"
  | "payment_locked"
  | "transfer_published"
  | "settled"
  | "cancelled"
  | "expired"
  | "failed";

export interface ListingRow {
  id: string;
  stampId: string;
  stampCommitmentHex: string;
  /** Ownership sequence this listing consumes: current sequence + 1. */
  sequence: number;
  state: ListingState;
  sellerAddress: string;
  sellerPublicKeyHex: string;
  buyerAddress: string | null;
  buyerPublicKeyHex: string | null;
  priceZat: string;
  hashLockHex: string | null;
  /**
   * Demo-only. A seller's wallet would hold this secret; the simulation keeps
   * it so the hash-lock reveal can be replayed without a real wallet.
   */
  preimageHex: string | null;
  offerArtifact: SettlementOffer | null;
  offerTxid: string | null;
  transferArtifact: TransferAuthorization | null;
  transferTxid: string | null;
  escrowId: string | null;
  expiryHeight: number | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransferRow {
  id: string;
  stampId: string;
  stampCommitmentHex: string;
  sequence: number;
  listingId: string | null;
  txid: string;
  artifact: TransferAuthorization;
  createdAt: string;
}

export interface Store {
  listLaunches(): Promise<LaunchRow[]>;
  getLaunch(mint: string): Promise<LaunchRow | null>;
  upsertLaunch(row: LaunchRow): Promise<void>;
  listJobs(): Promise<JobRow[]>;
  getJob(id: string): Promise<JobRow | null>;
  findJobByIdempotency(key: string): Promise<JobRow | null>;
  upsertJob(row: JobRow): Promise<void>;
  listStamps(): Promise<StampRow[]>;
  getStamp(id: string): Promise<StampRow | null>;
  stampsForMint(mint: string): Promise<StampRow[]>;
  upsertStamp(row: StampRow): Promise<void>;
  listListings(): Promise<ListingRow[]>;
  getListing(id: string): Promise<ListingRow | null>;
  upsertListing(row: ListingRow): Promise<void>;
  listTransfers(): Promise<TransferRow[]>;
  upsertTransfer(row: TransferRow): Promise<void>;
  loadDemo(): Promise<{ solana: DemoChainState; zcash: DemoZcashChain }>;
  saveDemo(solana: DemoChainState, zcash: DemoZcashChain): Promise<void>;
}

export interface SerializedTx {
  tx: CanonicalSolanaTx;
  zcash?: ZcashPublication;
}

export function mintFromLaunch(row: LaunchRow, supply: bigint): DemoMintState {
  return {
    address: row.mint,
    programId: row.tokenProgram,
    supply,
    decimals: row.decimals,
    initialized: true,
    extensions: [],
    name: row.name,
    symbol: row.symbol,
    description: row.description,
    imageDataUrl: row.imageDataUrl,
    quoteMint: row.quoteMint,
    quoteSymbol: row.quoteSymbol,
    launchSupply: row.launchSupply,
    poolBase: row.poolBase,
    creator: row.creator,
    launchTx: row.launchTx,
    createdAt: row.createdAt,
  };
}
