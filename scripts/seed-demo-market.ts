/**
 * Fills the demo ledger with enough real activity to exercise the marketplace:
 * several stamps of different sizes and a spread of completed sales.
 *
 * Nothing here bypasses the protocol. It drives the same HTTP API the browser
 * uses, signs with the same ed25519 scheme as the demo wallet, and every sale
 * it produces is settled through the ordinary listing flow, so the indexer
 * accepts it on its own terms. Demo mode only.
 *
 *   npm run seed:market -- http://127.0.0.1:3477
 */
import { createHash } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";

const BASE = process.argv[2] ?? "http://127.0.0.1:3477";

interface Wallet {
  label: string;
  publicKey: string;
  publicKeyHex: string;
  secret: Uint8Array;
  zcashAddress: string;
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function makeWallet(label: string): Wallet {
  const kp = nacl.sign.keyPair();
  const publicKeyHex = toHex(kp.publicKey);
  const digest = createHash("sha256").update(Buffer.from(kp.publicKey)).digest();
  return {
    label,
    publicKey: bs58.encode(kp.publicKey),
    publicKeyHex,
    secret: kp.secretKey,
    zcashAddress: `zdemo1${digest.subarray(0, 20).toString("hex")}`,
  };
}

function sign(wallet: Wallet, preimage: string) {
  return {
    signatureHex: toHex(nacl.sign.detached(new TextEncoder().encode(preimage), wallet.secret)),
    publicKeyHex: wallet.publicKeyHex,
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json()) as { data?: T; error?: { message: string } };
  if (json.error) throw new Error(`${path}: ${json.error.message}`);
  return json.data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connect(wallet: Wallet) {
  await api("/api/demo/connect", {
    method: "POST",
    body: JSON.stringify({ owner: wallet.publicKey }),
  });
}

async function mintStamp(owner: Wallet, mint: string, amountDisplay: string): Promise<string> {
  const { job } = await api<{ job: { id: string } }>("/api/convert/submit", {
    method: "POST",
    body: JSON.stringify({
      mint,
      owner: owner.publicKey,
      amountDisplay,
      destination: owner.zcashAddress,
    }),
  });
  for (let i = 0; i < 40; i += 1) {
    const payload = await api<{
      job: { state: string };
      claimPackage?: { commitmentHex?: string };
    }>(`/api/jobs/${job.id}`);
    if (payload.job.state === "rejected") throw new Error("issuance rejected");
    if (payload.job.state === "confirmed") {
      // The commitment in the claim package is the stamp's own identifier.
      const id = payload.claimPackage?.commitmentHex;
      if (!id) throw new Error("confirmed job has no commitment");
      return id;
    }
    await sleep(250);
  }
  throw new Error("issuance did not confirm");
}

/** Walks one stamp through the whole settlement sequence to a confirmed sale. */
async function sell(seller: Wallet, buyer: Wallet, stampId: string, priceZec: string) {
  const priceZat = (BigInt(Math.round(Number(priceZec) * 1e8))).toString(10);
  const listing = await api<{ id: string }>("/api/market/listings", {
    method: "POST",
    body: JSON.stringify({
      stampId,
      sellerAddress: seller.zcashAddress,
      sellerPublicKeyHex: seller.publicKeyHex,
      priceZat,
    }),
  });
  const act = (body: Record<string, unknown>) =>
    api<{ state: string }>(`/api/market/listings/${listing.id}`, {
      method: "POST",
      body: JSON.stringify(body),
    });

  await act({
    action: "reserve",
    buyerAddress: buyer.zcashAddress,
    buyerPublicKeyHex: buyer.publicKeyHex,
  });

  const offer = await api<{ preimage: string }>(`/api/market/listings/${listing.id}?challenge=true`);
  await act({ action: "publishOffer", ...sign(seller, offer.preimage) });

  const auth = await api<{ preimage: string }>(`/api/market/listings/${listing.id}?challenge=true`);
  await act({ action: "authorize", ...sign(seller, auth.preimage) });

  await act({ action: "lockPayment" });
  await act({ action: "publishTransfer" });
  await act({ action: "claimPayment" });
  return priceZat;
}

async function main() {
  const status = await api<{ mode: string }>("/api/status");
  if (status.mode !== "demo") throw new Error(`refusing to seed in ${status.mode} mode`);

  const alice = makeWallet("Seed A");
  const bob = makeWallet("Seed B");
  const carol = makeWallet("Seed C");
  // Connecting credits the demo balance and seeds the sample mint on first use.
  for (const w of [alice, bob, carol]) await connect(w);

  const { launches } = await api<{ launches: Array<{ mint: string; symbol: string }> }>(
    "/api/launches",
  );
  const mint = launches[0]?.mint;
  if (!mint) throw new Error("no launch to burn from");

  // Different represented quantities, so per-unit normalisation is meaningful.
  const plan: Array<{ owner: Wallet; amount: string; sales: Array<[Wallet, string]> }> = [
    { owner: alice, amount: "40", sales: [[bob, "0.0180"], [carol, "0.0225"]] },
    { owner: bob, amount: "10", sales: [[carol, "0.0052"], [alice, "0.0061"], [bob, "0.0058"]] },
    { owner: carol, amount: "120", sales: [[alice, "0.0480"]] },
    { owner: alice, amount: "25", sales: [] },
    { owner: bob, amount: "60", sales: [[carol, "0.0300"]] },
  ];

  for (const step of plan) {
    const stampId = await mintStamp(step.owner, mint, step.amount);
    let holder = step.owner;
    for (const [buyer, price] of step.sales) {
      await sell(holder, buyer, stampId, price);
      holder = buyer;
      // Spread settlements apart so the time axis is not a single instant.
      await sleep(1200);
    }
    console.log(`stamp ${stampId.slice(0, 12)}… ${step.amount} units, ${step.sales.length} sales`);
  }

  // One stamp left listed, so the marketplace has a live asking price.
  const open = await mintStamp(carol, mint, "15");
  await api("/api/market/listings", {
    method: "POST",
    body: JSON.stringify({
      stampId: open,
      sellerAddress: carol.zcashAddress,
      sellerPublicKeyHex: carol.publicKeyHex,
      priceZat: "900000",
    }),
  });
  console.log(`stamp ${open.slice(0, 12)}… listed at 0.009 ZEC`);

  const { sales } = await api<{ sales: unknown[] }>("/api/sales");
  console.log(`seeded ${sales.length} completed sales`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
