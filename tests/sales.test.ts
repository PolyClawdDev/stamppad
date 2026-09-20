import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { convert, ensureDemoWallet } from "../src/lib/app";
import {
  advanceListing,
  createListing,
  listingChallenge,
  reserveListing,
  tickDemoChain,
} from "../src/lib/market";
import { demoAddressForKey, encodeBase58, toHex } from "../src/lib/protocol";
import { saleHistory, unitPrice } from "../src/lib/sales";
import { setStoreForTests } from "../src/lib/store";
import { MemoryStore } from "../src/lib/store/memory";

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

async function mintStamp(owner: Identity, amountDisplay: string) {
  const seed = await ensureDemoWallet(owner.solana);
  const job = await convert({
    mint: seed.mint,
    owner: owner.solana,
    amountDisplay,
    destination: owner.address,
  });
  return job.commitmentHex!;
}

async function settleSale(seller: Identity, buyer: Identity, stampId: string, priceZat: string) {
  const listing = await createListing({
    stampId,
    sellerAddress: seller.address,
    sellerPublicKeyHex: seller.publicKeyHex,
    priceZat,
  });
  await reserveListing({
    listingId: listing.id,
    buyerAddress: buyer.address,
    buyerPublicKeyHex: buyer.publicKeyHex,
  });
  for (const action of ["publishOffer", "authorize"] as const) {
    const challenge = await listingChallenge(listing.id);
    await advanceListing({
      listingId: listing.id,
      action,
      signatureHex: seller.sign(challenge.preimage),
      publicKeyHex: seller.publicKeyHex,
    });
  }
  await advanceListing({ listingId: listing.id, action: "lockPayment" });
  await advanceListing({ listingId: listing.id, action: "publishTransfer" });
  await advanceListing({ listingId: listing.id, action: "claimPayment" });
  await tickDemoChain();
  await tickDemoChain();
  return listing.id;
}

describe("completed sale history", () => {
  beforeEach(() => {
    process.env.STAMP_MODE = "demo";
    process.env.STAMP_STORE = "memory";
    setStoreForTests(new MemoryStore(join(mkdtempSync(join(tmpdir(), "stamp-sales-")), "state.json")));
  });

  it("reports one record per settled sale, with quantity and timestamp", async () => {
    const seller = identity("sale-a");
    const buyer = identity("sale-b");
    const stampId = await mintStamp(seller, "40");
    await settleSale(seller, buyer, stampId, "1800000");

    const { sales, simulated } = await saleHistory();
    expect(sales).toHaveLength(1);
    const sale = sales[0]!;
    expect(sale.stampId).toBe(stampId);
    expect(sale.priceZat).toBe("1800000");
    expect(sale.amountBase).toBe("40000000");
    expect(sale.buyer).toBe(buyer.address);
    expect(sale.settledAt).not.toBeNull();
    expect(sale.timeSource).toBe("record_published");
    expect(simulated).toBe(true);
  });

  it("keeps an asking price out of the history until it settles", async () => {
    const seller = identity("ask-a");
    const stampId = await mintStamp(seller, "10");
    await createListing({
      stampId,
      sellerAddress: seller.address,
      sellerPublicKeyHex: seller.publicKeyHex,
      priceZat: "999999",
    });

    const { sales } = await saleHistory();
    expect(sales).toHaveLength(0);
  });

  it("excludes a cancelled listing from the history", async () => {
    const seller = identity("cancel-a");
    const stampId = await mintStamp(seller, "10");
    const listing = await createListing({
      stampId,
      sellerAddress: seller.address,
      sellerPublicKeyHex: seller.publicKeyHex,
      priceZat: "500000",
    });
    await advanceListing({ listingId: listing.id, action: "cancel" });

    const { sales } = await saleHistory();
    expect(sales).toHaveLength(0);
  });

  it("orders repeat sales of one stamp by the height they settled at", async () => {
    const a = identity("chain-a");
    const b = identity("chain-b");
    const c = identity("chain-c");
    const stampId = await mintStamp(a, "10");
    await settleSale(a, b, stampId, "520000");
    await settleSale(b, c, stampId, "610000");

    const { sales } = await saleHistory();
    expect(sales.map((s) => s.priceZat)).toEqual(["520000", "610000"]);
    expect(sales.map((s) => s.sequence)).toEqual([1, 2]);
    expect(sales[0]!.height).toBeLessThanOrEqual(sales[1]!.height);
  });

  it("normalises price per represented unit so different sizes compare", () => {
    // 0.018 ZEC for 40 tokens, 6 decimals: 45000 zatoshi per whole token.
    expect(unitPrice("1800000", "40000000", 6)).toBe("45000");
    expect(unitPrice("1800000", "0", 6)).toBeNull();
  });
});
