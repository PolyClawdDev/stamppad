/**
 * Marketplace settlement adapter.
 *
 * Delivery design (simulated, whole stamps only):
 *   1. Seller publishes a signed offer record binding one ownership sequence to
 *      one named buyer, a price, and a hash lock H = sha256(R).
 *   2. Seller signs a transfer authorization that contains R and hands it to
 *      the buyer off chain. Handing over R costs the seller nothing: the seller
 *      already knows R and can claim payment unilaterally.
 *   3. Only then does the buyer lock ZEC in a ZIP-300 style P2SH HTLC with a
 *      CLTV refund branch.
 *   4. The buyer publishes the transfer record; the seller claims the payment.
 *
 * This is not consensus atomicity. Zcash does not know what a stamp is, so no
 * script can bind payment to ownership. What the ordering buys is that the
 * buyer never has funds at risk without already holding a complete, valid
 * authorization, and the seller can always claim. Failure modes and the
 * liveness assumptions are listed in docs/PROTOCOL.md.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { flags, liveMoneyMovementBlocked } from "../mode";
import {
  hashLockFor,
  offerArtifactHash,
  offerPreimage,
  toHex,
  transferArtifactHash,
  transferPreimage,
  type SettlementOffer,
  type TransferAuthorization,
} from "../protocol";
import type { ListingRow, StampRow, Store, TransferRow } from "../store/types";
import { claimDemoHtlc, lockDemoHtlc, type DemoZcashChain } from "../zcash/demo";
import type { StampPublisher } from "./publisher";
import { walletAdapter } from "./wallet";

export const HTLC_TIMEOUT_BLOCKS = 48;

export interface SettlementContext {
  store: Store;
  chain: DemoZcashChain;
  publisher: StampPublisher;
  /** Ownership sequence and owner as resolved by the indexer. */
  ownership: { currentOwner: string; sequence: number };
}

export class SettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementError";
  }
}

export interface SettlementAdapter {
  readonly kind: "demo-escrowless-htlc" | "live";
  list(input: ListInput): Promise<ListingRow>;
  reserve(input: { listing: ListingRow; buyerAddress: string; buyerPublicKeyHex: string }): Promise<ListingRow>;
  offerToSign(listing: ListingRow): { hashLockHex: string; preimage: string; offer: UnsignedOffer };
  publishOffer(input: { listing: ListingRow; signatureHex: string; publicKeyHex: string }): Promise<ListingRow>;
  authorizationToSign(listing: ListingRow): { preimage: string; auth: UnsignedTransfer };
  authorize(input: { listing: ListingRow; signatureHex: string; publicKeyHex: string }): Promise<ListingRow>;
  lockPayment(input: { listing: ListingRow }): Promise<ListingRow>;
  publishTransfer(input: { listing: ListingRow }): Promise<ListingRow>;
  claimPayment(input: { listing: ListingRow }): Promise<ListingRow>;
  cancel(input: { listing: ListingRow }): Promise<ListingRow>;
}

export interface ListInput {
  stamp: StampRow;
  sellerAddress: string;
  sellerPublicKeyHex: string;
  priceZat: bigint;
  note?: string;
}

type UnsignedOffer = Omit<SettlementOffer, "signatureHex" | "ownerPublicKeyHex">;
type UnsignedTransfer = Omit<TransferAuthorization, "signatureHex" | "ownerPublicKeyHex">;

function now() {
  return new Date().toISOString();
}

export class DemoSettlementAdapter implements SettlementAdapter {
  readonly kind = "demo-escrowless-htlc" as const;
  constructor(private readonly ctx: SettlementContext) {}

  async list(input: ListInput): Promise<ListingRow> {
    const blocked = liveMoneyMovementBlocked("stampSale");
    if (blocked) throw new SettlementError(blocked);

    const capability = walletAdapter.capability(input.sellerAddress);
    if (!capability.canAuthorize) throw new SettlementError(capability.reason);
    if (input.sellerAddress !== this.ctx.ownership.currentOwner) {
      throw new SettlementError(
        "Only the current owner can list this stamp. Ownership is resolved from confirmed transfer records, not from who burned the tokens.",
      );
    }
    if (walletAdapter.addressForKey(input.sellerPublicKeyHex) !== input.sellerAddress) {
      throw new SettlementError("Seller key does not match the owner address.");
    }
    if (input.priceZat <= 0n) throw new SettlementError("Price must be positive.");

    const active = (await this.ctx.store.listListings()).find(
      (l) => l.stampId === input.stamp.id && isLive(l),
    );
    if (active) {
      throw new SettlementError(
        "This stamp already has a live listing. One stamp cannot be offered twice at the same time.",
      );
    }

    const row: ListingRow = {
      id: randomUUID(),
      stampId: input.stamp.id,
      stampCommitmentHex: input.stamp.commitmentHex,
      sequence: this.ctx.ownership.sequence + 1,
      state: "listed",
      sellerAddress: input.sellerAddress,
      sellerPublicKeyHex: input.sellerPublicKeyHex,
      buyerAddress: null,
      buyerPublicKeyHex: null,
      priceZat: input.priceZat.toString(10),
      hashLockHex: null,
      preimageHex: null,
      offerArtifact: null,
      offerTxid: null,
      transferArtifact: null,
      transferTxid: null,
      escrowId: null,
      expiryHeight: null,
      note: input.note ?? "",
      createdAt: now(),
      updatedAt: now(),
    };
    await this.ctx.store.upsertListing(row);
    return row;
  }

  async reserve(input: { listing: ListingRow; buyerAddress: string; buyerPublicKeyHex: string }) {
    expectState(input.listing, ["listed"]);
    if (walletAdapter.addressForKey(input.buyerPublicKeyHex) !== input.buyerAddress) {
      throw new SettlementError("Buyer key does not match the buyer address.");
    }
    if (input.buyerAddress === input.listing.sellerAddress) {
      throw new SettlementError("Buyer and seller must differ.");
    }
    // The secret belongs to the seller's wallet in a real deployment. The
    // simulation generates and stores it so the reveal can be replayed.
    const preimageHex = randomBytes(32).toString("hex");
    const row: ListingRow = {
      ...input.listing,
      state: "reserved",
      buyerAddress: input.buyerAddress,
      buyerPublicKeyHex: input.buyerPublicKeyHex,
      preimageHex,
      hashLockHex: hashLockFor(preimageHex),
      expiryHeight: this.ctx.chain.height + HTLC_TIMEOUT_BLOCKS,
      updatedAt: now(),
    };
    await this.ctx.store.upsertListing(row);
    return row;
  }

  offerToSign(listing: ListingRow) {
    expectState(listing, ["reserved"]);
    const offer = this.unsignedOffer(listing);
    return { hashLockHex: listing.hashLockHex!, preimage: offerPreimage(offer), offer };
  }

  async publishOffer(input: { listing: ListingRow; signatureHex: string; publicKeyHex: string }) {
    expectState(input.listing, ["reserved"]);
    const unsigned = this.unsignedOffer(input.listing);
    const check = walletAdapter.verify({
      address: input.listing.sellerAddress,
      publicKeyHex: input.publicKeyHex,
      preimage: offerPreimage(unsigned),
      signatureHex: input.signatureHex,
    });
    if (!check.ok) throw new SettlementError(check.message);

    const offer: SettlementOffer = {
      ...unsigned,
      ownerPublicKeyHex: input.publicKeyHex,
      signatureHex: input.signatureHex,
    };
    const publication = await this.ctx.publisher.publishRecord({
      record: {
        kind: "offer",
        stampCommitmentHex: input.listing.stampCommitmentHex,
        sequence: input.listing.sequence,
        artifactHashHex: toHex(offerArtifactHash(offer)),
      },
      noticeAddress: null,
    });
    const row: ListingRow = {
      ...input.listing,
      state: "offer_published",
      offerArtifact: offer,
      offerTxid: publication.txid,
      updatedAt: now(),
    };
    await this.ctx.store.upsertListing(row);
    return row;
  }

  authorizationToSign(listing: ListingRow) {
    expectState(listing, ["offer_published"]);
    const auth = this.unsignedTransfer(listing);
    return { preimage: transferPreimage(auth), auth };
  }

  async authorize(input: { listing: ListingRow; signatureHex: string; publicKeyHex: string }) {
    expectState(input.listing, ["offer_published"]);
    const unsigned = this.unsignedTransfer(input.listing);
    const check = walletAdapter.verify({
      address: input.listing.sellerAddress,
      publicKeyHex: input.publicKeyHex,
      preimage: transferPreimage(unsigned),
      signatureHex: input.signatureHex,
    });
    if (!check.ok) throw new SettlementError(check.message);
    const row: ListingRow = {
      ...input.listing,
      state: "authorized",
      transferArtifact: {
        ...unsigned,
        ownerPublicKeyHex: input.publicKeyHex,
        signatureHex: input.signatureHex,
      },
      updatedAt: now(),
    };
    await this.ctx.store.upsertListing(row);
    return row;
  }

  async lockPayment(input: { listing: ListingRow }) {
    expectState(input.listing, ["authorized"]);
    if (!input.listing.transferArtifact) {
      throw new SettlementError("Refusing to lock funds before a valid transfer authorization exists.");
    }
    const htlc = lockDemoHtlc({
      chain: this.ctx.chain,
      amountZat: BigInt(input.listing.priceZat),
      hashLockHex: input.listing.hashLockHex!,
      buyerAddress: input.listing.buyerAddress!,
      sellerAddress: input.listing.sellerAddress,
      timeoutBlocks: HTLC_TIMEOUT_BLOCKS,
    });
    const row: ListingRow = {
      ...input.listing,
      state: "payment_locked",
      escrowId: htlc.id,
      expiryHeight: htlc.expiryHeight,
      updatedAt: now(),
    };
    await this.ctx.store.upsertListing(row);
    return row;
  }

  async publishTransfer(input: { listing: ListingRow }) {
    expectState(input.listing, ["payment_locked"]);
    const auth = input.listing.transferArtifact!;
    const publication = await this.ctx.publisher.publishRecord({
      record: {
        kind: "transfer",
        stampCommitmentHex: input.listing.stampCommitmentHex,
        sequence: input.listing.sequence,
        artifactHashHex: toHex(transferArtifactHash(auth)),
      },
      noticeAddress: auth.toAddress,
    });
    const transfer: TransferRow = {
      id: `${input.listing.stampCommitmentHex}:${input.listing.sequence}`,
      stampId: input.listing.stampId,
      stampCommitmentHex: input.listing.stampCommitmentHex,
      sequence: input.listing.sequence,
      listingId: input.listing.id,
      txid: publication.txid,
      artifact: auth,
      createdAt: now(),
    };
    await this.ctx.store.upsertTransfer(transfer);
    const row: ListingRow = {
      ...input.listing,
      state: "transfer_published",
      transferTxid: publication.txid,
      updatedAt: now(),
    };
    await this.ctx.store.upsertListing(row);
    return row;
  }

  async claimPayment(input: { listing: ListingRow }) {
    expectState(input.listing, ["payment_locked", "transfer_published"]);
    claimDemoHtlc(this.ctx.chain, input.listing.escrowId!, input.listing.preimageHex!);
    const row: ListingRow = { ...input.listing, updatedAt: now() };
    await this.ctx.store.upsertListing(row);
    return row;
  }

  async cancel(input: { listing: ListingRow }) {
    if (input.listing.state === "payment_locked" || input.listing.state === "transfer_published") {
      throw new SettlementError(
        "Payment is already locked. Wait for settlement or for the CLTV refund height.",
      );
    }
    const row: ListingRow = { ...input.listing, state: "cancelled", updatedAt: now() };
    await this.ctx.store.upsertListing(row);
    return row;
  }

  private unsignedOffer(listing: ListingRow): UnsignedOffer {
    return {
      stampCommitmentHex: listing.stampCommitmentHex,
      sequence: listing.sequence,
      sellerAddress: listing.sellerAddress,
      buyerAddress: listing.buyerAddress!,
      priceZat: listing.priceZat,
      hashLockHex: listing.hashLockHex!,
      expiryHeight: listing.expiryHeight!,
    };
  }

  private unsignedTransfer(listing: ListingRow): UnsignedTransfer {
    return {
      stampCommitmentHex: listing.stampCommitmentHex,
      sequence: listing.sequence,
      fromAddress: listing.sellerAddress,
      toAddress: listing.buyerAddress!,
      offerHashHex: toHex(offerArtifactHash(listing.offerArtifact!)),
      preimageHex: listing.preimageHex!,
    };
  }
}

/** Real ZEC settlement stays behind this wall until the design is verified end to end. */
export class LiveSettlementAdapter implements SettlementAdapter {
  readonly kind = "live" as const;
  private refuse(): never {
    throw new SettlementError(
      liveMoneyMovementBlocked("stampSale") ??
        "Live stamp sales are not implemented: HTLC construction, wallet support for ZIP-300 P2SH redeem scripts, and dispute handling are unverified.",
    );
  }
  async list(): Promise<ListingRow> { this.refuse(); }
  async reserve(): Promise<ListingRow> { this.refuse(); }
  offerToSign(): never { this.refuse(); }
  async publishOffer(): Promise<ListingRow> { this.refuse(); }
  authorizationToSign(): never { this.refuse(); }
  async authorize(): Promise<ListingRow> { this.refuse(); }
  async lockPayment(): Promise<ListingRow> { this.refuse(); }
  async publishTransfer(): Promise<ListingRow> { this.refuse(); }
  async claimPayment(): Promise<ListingRow> { this.refuse(); }
  async cancel(): Promise<ListingRow> { this.refuse(); }
}

export function settlementFor(ctx: SettlementContext): SettlementAdapter {
  return flags().mode === "demo" ? new DemoSettlementAdapter(ctx) : new LiveSettlementAdapter();
}

export function isLive(listing: ListingRow): boolean {
  return !["settled", "cancelled", "expired", "failed"].includes(listing.state);
}

function expectState(listing: ListingRow, allowed: ListingRow["state"][]): void {
  if (!allowed.includes(listing.state)) {
    throw new SettlementError(
      `Listing is ${listing.state}; this step requires ${allowed.join(" or ")}.`,
    );
  }
}
