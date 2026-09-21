/**
 * Marketplace and ownership application service.
 *
 * Every read derives ownership from the indexer, never from listing state, so
 * the UI cannot show a sale the protocol would not accept.
 */
import { randomUUID } from "node:crypto";
import { DEMO_MIN_CONFIRMS, indexFromStore, ownerOf, type IndexedState } from "./indexer";
import { flags, stampMode } from "./mode";
import { publisherFor } from "./modules/publisher";
import {
  SettlementError,
  isLive,
  settlementFor,
  type SettlementAdapter,
} from "./modules/settlement";
import { walletAdapter, type OwnerScheme } from "./modules/wallet";
import {
  toHex,
  transferArtifactHash,
  transferPreimage,
  type TransferAuthorization,
} from "./protocol";
import { getStore, type ListingRow, type StampRow } from "./store";
import type { CookieSession } from "./wallet/cookie";
import { proofStore, sessionKey } from "./wallet/taddr-proof";
import { tickConfirmations, type DemoZcashChain } from "./zcash/demo";

export interface MarketContextResult {
  adapter: SettlementAdapter;
  chain: DemoZcashChain;
  state: IndexedState;
}

async function withMarket<T>(
  stampCommitmentHex: string | null,
  fallbackRecipient: string,
  fn: (ctx: MarketContextResult) => Promise<T>,
): Promise<T> {
  const store = getStore();
  const state = await reconcileListings();
  const { solana, zcash } = await store.loadDemo();
  const ownership = stampCommitmentHex
    ? ownerOf(state, stampCommitmentHex, fallbackRecipient)
    : { currentOwner: fallbackRecipient, sequence: 0 };
  const adapter = settlementFor({
    store,
    chain: zcash,
    publisher: publisherFor(zcash),
    ownership,
  });
  const result = await fn({ adapter, chain: zcash, state });
  tickConfirmations(zcash, DEMO_MIN_CONFIRMS);
  await store.saveDemo(solana, zcash);
  return result;
}

/**
 * Closes out listings whose outcome the indexer has already decided. Listing
 * state is bookkeeping; the ledger decides whether a sale happened.
 */
export async function reconcileListings(state?: IndexedState): Promise<IndexedState> {
  const store = getStore();
  const indexed = state ?? (await indexFromStore());
  const { zcash } = await store.loadDemo();
  for (const listing of await store.listListings()) {
    if (!isLive(listing)) continue;
    const owned = indexed.ownership.stamps[listing.stampCommitmentHex];
    const applied = owned?.history.some(
      (h) => h.sequence === listing.sequence && h.to === listing.buyerAddress,
    );
    if (applied) {
      await store.upsertListing({ ...listing, state: "settled", updatedAt: new Date().toISOString() });
      continue;
    }
    const beforePayment = ["listed", "reserved", "offer_published", "authorized"].includes(
      listing.state,
    );
    if (beforePayment && listing.expiryHeight !== null && zcash.height > listing.expiryHeight) {
      await store.upsertListing({ ...listing, state: "expired", updatedAt: new Date().toISOString() });
    }
  }
  return indexed;
}

/**
 * `proven` names the transparent addresses the viewing session has proved
 * control of. It is what turns a t-address stamp listable, and it is deliberately
 * per-request: the same stamp is listable for the session holding the proof and
 * not for anyone else.
 */
export async function stampWithOwnership(
  stamp: StampRow,
  state?: IndexedState,
  proven?: Iterable<string>,
) {
  const indexed = state ?? (await indexFromStore());
  const owned = indexed.ownership.stamps[stamp.commitmentHex];
  const currentOwner = owned?.currentOwner ?? stamp.destination;
  const capability = walletAdapter.capability(currentOwner);
  const controlProved = new Set(proven ?? []).has(currentOwner);
  const pending = indexed.ownership.pending.filter(
    (p) => p.stampCommitmentHex === stamp.commitmentHex,
  );
  const rejected = indexed.ownership.rejected.filter(
    (r) => r.stampCommitmentHex === stamp.commitmentHex,
  );
  return {
    ...stamp,
    originalRecipient: stamp.destination,
    currentOwner,
    sequence: owned?.sequence ?? 0,
    history: owned?.history ?? [],
    transferable: capability.canAuthorize,
    transferabilityNote: capability.reason,
    // Listing asks for the owner's public key before any signature exists, and
    // only an ed25519 destination can hand one over up front. A transparent
    // holder proves control by signing instead, once, and the key is recovered
    // from that signature, so listing waits on a proof that transferring does not.
    listable:
      capability.canAuthorize && (capability.scheme === "ed25519" || controlProved),
    listabilityNote: listabilityNote(capability.scheme, capability.reason, controlProved),
    /** True when the owner is one control proof away from being able to list. */
    needsControlProof: capability.scheme === "zcash-signmessage" && !controlProved,
    pendingOwnershipRecords: pending,
    rejectedOwnershipRecords: rejected,
    indexed: Boolean(owned),
    indexNote: owned
      ? "Ownership derived from confirmed records replayed by the indexer."
      : "Issuance is not yet confirmed by the indexer, so ownership still resolves to the original recipient.",
  };
}

function listabilityNote(
  scheme: OwnerScheme,
  reason: string,
  controlProved: boolean,
): string {
  if (scheme !== "zcash-signmessage") return reason;
  if (controlProved) {
    return "You proved control of this transparent address for this session, so it can be listed. Disconnecting gives the proof up.";
  }
  return "Transfers from this transparent address are verified by signing with your Zcash wallet. Listing it for sale additionally needs a one-time proof of control: sign the statement on this page in that wallet and paste the signature back.";
}

export async function marketOverview() {
  const store = getStore();
  const state = await reconcileListings();
  const [listings, stamps] = await Promise.all([store.listListings(), store.listStamps()]);
  const byId = new Map(stamps.map((s) => [s.id, s]));
  const rows = await Promise.all(
    listings.map(async (listing) => {
      const stamp = byId.get(listing.stampId);
      return {
        ...publicListing(listing),
        stamp: stamp ? await stampWithOwnership(stamp, state) : null,
      };
    }),
  );
  return {
    mode: stampMode(),
    settlement: settlementDisclosure(),
    listings: rows.filter((r) => isLive(r as unknown as ListingRow)),
    history: rows.filter((r) => !isLive(r as unknown as ListingRow)),
    confirmedSales: state.ownership.sales,
    note:
      "Listings and sales shown here are records this deployment produced. No external order flow, liquidity, or trade history is imported.",
  };
}

export function settlementDisclosure() {
  const f = flags();
  return {
    adapter: f.mode === "demo" ? "escrowless-htlc (this deployment)" : "live (disabled)",
    liveSalesEnabled: false,
    custody: "None. The app never holds a stamp or the buyer's ZEC.",
    mechanism:
      "Seller publishes a signed offer binding one ownership sequence to one buyer and a hash lock, hands the buyer a signed transfer authorization containing the preimage, and only then does the buyer lock ZEC in a ZIP-300 style P2SH HTLC with a CLTV refund.",
    atomicity:
      "Not consensus-atomic. Zcash cannot enforce stamp ownership, so no script binds payment to the record. The ordering means the buyer never has funds at risk without already holding a complete authorization.",
    partialFills: "Not supported. Whole stamps only; split and merge rules do not exist.",
    risks: [
      "If the seller never claims the HTLC, the buyer's transfer still stands and the funds refund at the CLTV height.",
      "A reorg that removes the offer or transfer record rolls ownership back deterministically.",
      "Authorization artifacts are published off chain; a withheld artifact leaves a transfer unresolved until it appears.",
    ],
  };
}

export async function portfolio(input: { owner: string; zcashAddress: string | null }) {
  const store = getStore();
  const state = await reconcileListings();
  const [stamps, jobs, listings, launches] = await Promise.all([
    store.listStamps(),
    store.listJobs(),
    store.listListings(),
    store.listLaunches(),
  ]);
  const { solana } = await store.loadDemo();

  const balances = Object.values(solana.accounts)
    .filter((a) => a.owner === input.owner && a.amount > 0n)
    .map((a) => {
      const mint = solana.mints[a.mint];
      return {
        mint: a.mint,
        symbol: mint?.symbol ?? "?",
        name: mint?.name ?? "Unknown mint",
        decimals: mint?.decimals ?? 0,
        amountBase: a.amount.toString(10),
      };
    })
    .sort((a, b) => (a.symbol < b.symbol ? -1 : 1));

  const owned = [];
  for (const stamp of stamps) {
    const view = await stampWithOwnership(stamp, state);
    const mine =
      (input.zcashAddress && view.currentOwner === input.zcashAddress) ||
      stamp.burnAuthority === input.owner;
    if (mine) {
      owned.push({
        ...view,
        isCurrentOwner: Boolean(input.zcashAddress) && view.currentOwner === input.zcashAddress,
        listing: publicListingOrNull(
          listings.find((l) => l.stampId === stamp.id && isLive(l)) ?? null,
        ),
      });
    }
  }

  return {
    owner: input.owner,
    zcashAddress: input.zcashAddress,
    balances,
    launches: launches.filter((l) => l.creator === input.owner),
    stamps: owned,
    jobs: jobs.filter((j) => j.owner === input.owner),
    listings: listings
      .filter((l) => l.sellerAddress === input.zcashAddress || l.buyerAddress === input.zcashAddress)
      .map(publicListing),
  };
}

export async function createListing(input: {
  stampId: string;
  sellerAddress: string;
  /** Ignored for a transparent seller, whose key comes from their control proof. */
  sellerPublicKeyHex?: string;
  priceZat: string;
  note?: string;
  session?: Pick<CookieSession, "publicKey" | "verifiedAt"> | null;
}) {
  const stamp = await requireStamp(input.stampId);
  const sellerPublicKeyHex = sellerKeyFor(input);
  return withMarket(stamp.commitmentHex, stamp.destination, async ({ adapter }) =>
    publicListing(
      await adapter.list({
        stamp,
        sellerAddress: input.sellerAddress,
        sellerPublicKeyHex,
        priceZat: BigInt(input.priceZat),
        note: input.note,
      }),
    ),
  );
}

/**
 * The key a listing records for its seller.
 *
 * For a transparent address this is the key recovered from that session's
 * control proof, never a key the caller supplied. That is the whole point of the
 * proof: a stamp can carry only one live listing, so if naming an address were
 * enough to create one, anyone could name someone else's address and keep the
 * real owner from ever listing their own stamp. They could not complete such a
 * sale, but blocking the owner would not need them to.
 */
function sellerKeyFor(input: {
  sellerAddress: string;
  sellerPublicKeyHex?: string;
  session?: Pick<CookieSession, "publicKey" | "verifiedAt"> | null;
}): string {
  if (walletAdapter.capability(input.sellerAddress).scheme !== "zcash-signmessage") {
    if (!input.sellerPublicKeyHex) {
      throw new SettlementError("The seller's public key is required to list a stamp.");
    }
    return input.sellerPublicKeyHex;
  }
  if (!input.session) {
    throw new SettlementError(
      "Listing a stamp held at a transparent address needs a connected wallet, because the proof that you control the address is kept against that session.",
    );
  }
  const proof = proofStore.find(sessionKey(input.session), input.sellerAddress);
  if (!proof) {
    throw new SettlementError(
      "This session has not proved control of that transparent address. Sign the ownership statement in the Zcash wallet that holds it and paste the signature back, then list.",
    );
  }
  return proof.publicKeyHex;
}

export async function reserveListing(input: {
  listingId: string;
  buyerAddress: string;
  buyerPublicKeyHex: string;
}) {
  const stamp = await requireStamp((await requireListing(input.listingId)).stampId);
  return withMarket(stamp.commitmentHex, stamp.destination, async ({ adapter }) =>
    publicListing(
      await adapter.reserve({
        listing: await requireListing(input.listingId),
        buyerAddress: input.buyerAddress,
        buyerPublicKeyHex: input.buyerPublicKeyHex,
      }),
    ),
  );
}

/** Returns the exact text the seller's wallet must sign for the next step. */
export async function listingChallenge(listingId: string) {
  const stamp = await requireStamp((await requireListing(listingId)).stampId);
  return withMarket(stamp.commitmentHex, stamp.destination, async ({ adapter }) => {
    const listing = await requireListing(listingId);
    if (listing.state === "reserved") {
      const { preimage, hashLockHex } = adapter.offerToSign(listing);
      return { step: "offer" as const, preimage, hashLockHex };
    }
    if (listing.state === "offer_published") {
      const { preimage } = adapter.authorizationToSign(listing);
      return { step: "authorize" as const, preimage, hashLockHex: listing.hashLockHex };
    }
    throw new SettlementError(`Listing state ${listing.state} does not need a signature.`);
  });
}

export async function advanceListing(input: {
  listingId: string;
  action:
    | "publishOffer"
    | "authorize"
    | "lockPayment"
    | "publishTransfer"
    | "claimPayment"
    | "cancel";
  signatureHex?: string;
  publicKeyHex?: string;
}) {
  const stamp = await requireStamp((await requireListing(input.listingId)).stampId);
  return withMarket(stamp.commitmentHex, stamp.destination, async ({ adapter }) => {
    const listing = await requireListing(input.listingId);
    switch (input.action) {
      case "publishOffer":
        return publicListing(
          await adapter.publishOffer({
            listing,
            signatureHex: requireSig(input.signatureHex),
            publicKeyHex: signerKey(listing, input.publicKeyHex),
          }),
        );
      case "authorize":
        return publicListing(
          await adapter.authorize({
            listing,
            signatureHex: requireSig(input.signatureHex),
            publicKeyHex: signerKey(listing, input.publicKeyHex),
          }),
        );
      case "lockPayment":
        return publicListing(await adapter.lockPayment({ listing }));
      case "publishTransfer":
        return publicListing(await adapter.publishTransfer({ listing }));
      case "claimPayment":
        return publicListing(await adapter.claimPayment({ listing }));
      case "cancel":
        return publicListing(await adapter.cancel({ listing }));
    }
  });
}

/** A gift transfer: ownership moves with no payment leg. */
export async function transferChallenge(input: { stampId: string; toAddress: string }) {
  const stamp = await requireStamp(input.stampId);
  const state = await indexFromStore();
  const { currentOwner, sequence } = ownerOf(state, stamp.commitmentHex, stamp.destination);
  const capability = walletAdapter.capability(currentOwner);
  if (!capability.canAuthorize) throw new SettlementError(capability.reason);
  const unsigned = {
    stampCommitmentHex: stamp.commitmentHex,
    sequence: sequence + 1,
    fromAddress: currentOwner,
    toAddress: input.toAddress,
    offerHashHex: "none",
    preimageHex: "none",
  };
  return { preimage: transferPreimage(unsigned), unsigned, currentOwner };
}

export async function submitTransfer(input: {
  stampId: string;
  toAddress: string;
  signatureHex: string;
  publicKeyHex: string;
}) {
  const stamp = await requireStamp(input.stampId);
  const store = getStore();
  const challenge = await transferChallenge({ stampId: input.stampId, toAddress: input.toAddress });
  const check = walletAdapter.verify({
    address: challenge.currentOwner,
    publicKeyHex: input.publicKeyHex,
    preimage: challenge.preimage,
    signatureHex: input.signatureHex,
  });
  if (!check.ok) throw new SettlementError(check.message);

  const listings = await store.listListings();
  if (listings.some((l) => l.stampId === stamp.id && isLive(l))) {
    throw new SettlementError(
      "This stamp has a live listing. Cancel it before transferring, or the sale and the gift would compete for the same ownership sequence.",
    );
  }

  const auth: TransferAuthorization = {
    ...challenge.unsigned,
    ownerPublicKeyHex: input.publicKeyHex,
    signatureHex: input.signatureHex,
  };
  const { solana, zcash } = await store.loadDemo();
  const publisher = publisherFor(zcash);
  const publication = await publisher.publishRecord({
    record: {
      kind: "transfer",
      stampCommitmentHex: auth.stampCommitmentHex,
      sequence: auth.sequence,
      artifactHashHex: toHex(transferArtifactHash(auth)),
    },
    noticeAddress: auth.toAddress,
  });
  await store.upsertTransfer({
    id: `${auth.stampCommitmentHex}:${auth.sequence}`,
    stampId: stamp.id,
    stampCommitmentHex: auth.stampCommitmentHex,
    sequence: auth.sequence,
    listingId: null,
    txid: publication.txid,
    artifact: auth,
    createdAt: new Date().toISOString(),
  });
  tickConfirmations(zcash, DEMO_MIN_CONFIRMS);
  await store.saveDemo(solana, zcash);
  return { txid: publication.txid, sequence: auth.sequence, to: auth.toAddress };
}

export async function tickDemoChain() {
  const store = getStore();
  const { solana, zcash } = await store.loadDemo();
  tickConfirmations(zcash, DEMO_MIN_CONFIRMS);
  zcash.height += 1;
  await store.saveDemo(solana, zcash);
  return { height: zcash.height, minConfirmations: DEMO_MIN_CONFIRMS };
}

export function publicListing(listing: ListingRow) {
  return {
    id: listing.id,
    stampId: listing.stampId,
    stampCommitmentHex: listing.stampCommitmentHex,
    sequence: listing.sequence,
    state: listing.state,
    sellerAddress: listing.sellerAddress,
    buyerAddress: listing.buyerAddress,
    priceZat: listing.priceZat,
    hashLockHex: listing.hashLockHex,
    offerTxid: listing.offerTxid,
    transferTxid: listing.transferTxid,
    escrowId: listing.escrowId,
    expiryHeight: listing.expiryHeight,
    note: listing.note,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
  };
}

function publicListingOrNull(listing: ListingRow | null) {
  return listing ? publicListing(listing) : null;
}

async function requireStamp(id: string): Promise<StampRow> {
  const stamp = await getStore().getStamp(id);
  if (!stamp) throw new SettlementError("Unknown stamp.");
  return stamp;
}

async function requireListing(id: string): Promise<ListingRow> {
  const listing = await getStore().getListing(id);
  if (!listing) throw new SettlementError("Unknown listing.");
  return listing;
}

function requireSig(sig?: string): string {
  if (!sig) throw new SettlementError("A wallet signature is required for this step.");
  return sig;
}

/**
 * The key a signature on a live listing is recorded under.
 *
 * A transparent seller cannot name one: their key is recovered from whatever they
 * sign. The listing already carries the key recovered when control of the address
 * was proved, so that is used instead of asking the browser for something it has
 * no way to know.
 */
function signerKey(listing: ListingRow, claimed?: string): string {
  if (claimed) return claimed;
  if (walletAdapter.capability(listing.sellerAddress).scheme === "zcash-signmessage") {
    return listing.sellerPublicKeyHex;
  }
  throw new SettlementError("The signing public key is required for this step.");
}

export function newListingId(): string {
  return randomUUID();
}
