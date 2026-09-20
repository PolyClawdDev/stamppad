import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { convert } from "../src/lib/app";
import { indexFromStore } from "../src/lib/indexer";
import {
  advanceListing,
  createListing,
  listingChallenge,
  marketOverview,
  portfolio,
  stampWithOwnership,
  submitTransfer,
  tickDemoChain,
  transferChallenge,
} from "../src/lib/market";
import { demoAddressForKey, encodeBase58, toHex } from "../src/lib/protocol";
import { getStore, setStoreForTests } from "../src/lib/store";
import { MemoryStore } from "../src/lib/store/memory";
import { launchFundedCoin } from "./helpers";

function identity(seed: string) {
  const kp = nacl.sign.keyPair.fromSeed(Buffer.alloc(32, seed));
  const publicKeyHex = toHex(kp.publicKey);
  return {
    solana: encodeBase58(kp.publicKey),
    publicKeyHex,
    address: demoAddressForKey(publicKeyHex),
    sign(preimage: string) {
      return toHex(nacl.sign.detached(new TextEncoder().encode(preimage), kp.secretKey));
    },
  };
}

type Identity = ReturnType<typeof identity>;

async function mintStamp(owner: Identity, amountDisplay = "5", destination = owner.address) {
  const coin = await launchFundedCoin(owner.solana);
  const job = await convert({
    mint: coin.mint,
    owner: owner.solana,
    amountDisplay,
    destination,
  });
  expect(job.state).toBe("confirmed");
  return job.commitmentHex!;
}

async function signStep(listingId: string, who: Identity) {
  const challenge = await listingChallenge(listingId);
  return { signatureHex: who.sign(challenge.preimage), publicKeyHex: who.publicKeyHex };
}

async function runSale(seller: Identity, buyer: Identity, stampId: string, priceZat = "120000") {
  const listing = await createListing({
    stampId,
    sellerAddress: seller.address,
    sellerPublicKeyHex: seller.publicKeyHex,
    priceZat,
  });
  await import("../src/lib/market").then((m) =>
    m.reserveListing({
      listingId: listing.id,
      buyerAddress: buyer.address,
      buyerPublicKeyHex: buyer.publicKeyHex,
    }),
  );
  await advanceListing({
    listingId: listing.id,
    action: "publishOffer",
    ...(await signStep(listing.id, seller)),
  });
  await advanceListing({
    listingId: listing.id,
    action: "authorize",
    ...(await signStep(listing.id, seller)),
  });
  await advanceListing({ listingId: listing.id, action: "lockPayment" });
  await advanceListing({ listingId: listing.id, action: "publishTransfer" });
  await advanceListing({ listingId: listing.id, action: "claimPayment" });
  await tickDemoChain();
  await tickDemoChain();
  return listing.id;
}

describe("stamp marketplace", () => {
  beforeEach(() => {
    process.env.STAMP_MODE = "demo";
    process.env.STAMP_STORE = "memory";
    setStoreForTests(new MemoryStore(join(mkdtempSync(join(tmpdir(), "stamp-mkt-")), "state.json")));
  });

  it("settles a whole-stamp sale and moves ownership", async () => {
    const seller = identity("s");
    const buyer = identity("b");
    const stampId = await mintStamp(seller);

    const listingId = await runSale(seller, buyer, stampId);

    const state = await indexFromStore();
    expect(state.ownership.stamps[stampId]!.currentOwner).toBe(buyer.address);
    expect(state.ownership.sales).toHaveLength(1);
    expect(state.ownership.sales[0]!.priceZat).toBe("120000");
    expect(state.invariants.conflictingSales).toBe(0);
    expect(state.invariants.ownershipChainsContiguous).toBe(true);

    const { zcash } = await getStore().loadDemo();
    const escrow = Object.values(zcash.escrows)[0]!;
    expect(escrow.state).toBe("claimed");
    expect(escrow.amountZat).toBe(120000n);

    const listing = await getStore().getListing(listingId);
    expect(listing?.state).toBe("transfer_published");

    const overview = await marketOverview();
    expect(overview.confirmedSales).toHaveLength(1);
    expect(overview.settlement.liveSalesEnabled).toBe(false);
  });

  it("refuses a second live listing for the same stamp", async () => {
    const seller = identity("s2");
    const stampId = await mintStamp(seller);
    await createListing({
      stampId,
      sellerAddress: seller.address,
      sellerPublicKeyHex: seller.publicKeyHex,
      priceZat: "50000",
    });
    await expect(
      createListing({
        stampId,
        sellerAddress: seller.address,
        sellerPublicKeyHex: seller.publicKeyHex,
        priceZat: "60000",
      }),
    ).rejects.toThrow(/already has a live listing/i);
  });

  it("refuses to re-sell a stamp after ownership has moved", async () => {
    const seller = identity("s3");
    const buyer = identity("b3");
    const stampId = await mintStamp(seller);
    await runSale(seller, buyer, stampId);

    await expect(
      createListing({
        stampId,
        sellerAddress: seller.address,
        sellerPublicKeyHex: seller.publicKeyHex,
        priceZat: "999999",
      }),
    ).rejects.toThrow(/current owner/i);

    const relisted = await createListing({
      stampId,
      sellerAddress: buyer.address,
      sellerPublicKeyHex: buyer.publicKeyHex,
      priceZat: "150000",
    });
    expect(relisted.sequence).toBe(2);
  });

  it("refuses a listing signed by a key that is not the owner's", async () => {
    const seller = identity("s4");
    const mallory = identity("m4");
    const stampId = await mintStamp(seller);
    await expect(
      createListing({
        stampId,
        sellerAddress: seller.address,
        sellerPublicKeyHex: mallory.publicKeyHex,
        priceZat: "1000",
      }),
    ).rejects.toThrow(/does not match/i);
  });

  it("refuses ownership operations on a stamp issued to an external address", async () => {
    const owner = identity("s5");
    // A valid demo destination that is not derived from a key this build can verify.
    const stampId = await mintStamp(owner, "2", "zdemo1externalcustodydest01");
    const stamp = (await getStore().getStamp(stampId))!;
    const view = await stampWithOwnership(stamp);
    expect(view.transferable).toBe(false);
    await expect(
      createListing({
        stampId,
        sellerAddress: owner.address,
        sellerPublicKeyHex: owner.publicKeyHex,
        priceZat: "1000",
      }),
    ).rejects.toThrow(/current owner|key binding/i);
  });

  it("moves ownership on a signed gift transfer and blocks a competing listing", async () => {
    const owner = identity("s6");
    const friend = identity("f6");
    const stampId = await mintStamp(owner, "3");

    const challenge = await transferChallenge({ stampId, toAddress: friend.address });
    await submitTransfer({
      stampId,
      toAddress: friend.address,
      signatureHex: owner.sign(challenge.preimage),
      publicKeyHex: owner.publicKeyHex,
    });
    await tickDemoChain();
    await tickDemoChain();

    const state = await indexFromStore();
    expect(state.ownership.stamps[stampId]!.currentOwner).toBe(friend.address);
    expect(state.ownership.sales).toHaveLength(0);

    await createListing({
      stampId,
      sellerAddress: friend.address,
      sellerPublicKeyHex: friend.publicKeyHex,
      priceZat: "80000",
    });
    const second = await transferChallenge({ stampId, toAddress: owner.address });
    await expect(
      submitTransfer({
        stampId,
        toAddress: owner.address,
        signatureHex: friend.sign(second.preimage),
        publicKeyHex: friend.publicKeyHex,
      }),
    ).rejects.toThrow(/live listing/i);
  });

  it("refuses to lock payment before a transfer authorization exists", async () => {
    const seller = identity("s7");
    const buyer = identity("b7");
    const stampId = await mintStamp(seller);
    const listing = await createListing({
      stampId,
      sellerAddress: seller.address,
      sellerPublicKeyHex: seller.publicKeyHex,
      priceZat: "70000",
    });
    const { reserveListing } = await import("../src/lib/market");
    await reserveListing({
      listingId: listing.id,
      buyerAddress: buyer.address,
      buyerPublicKeyHex: buyer.publicKeyHex,
    });
    await expect(
      advanceListing({ listingId: listing.id, action: "lockPayment" }),
    ).rejects.toThrow(/requires authorized/i);
  });

  it("reports the buyer as owner in the portfolio after settlement", async () => {
    const seller = identity("s8");
    const buyer = identity("b8");
    const stampId = await mintStamp(seller);
    await runSale(seller, buyer, stampId);

    const buyerView = await portfolio({ owner: buyer.solana, zcashAddress: buyer.address });
    const owned = buyerView.stamps.find((s) => s.id === stampId);
    expect(owned?.isCurrentOwner).toBe(true);

    const sellerView = await portfolio({ owner: seller.solana, zcashAddress: seller.address });
    expect(sellerView.stamps.find((s) => s.id === stampId)?.isCurrentOwner).toBe(false);
  });
});
