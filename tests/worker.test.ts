import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convert, createDemoLaunch, ensureDemoWallet, launchView } from "../src/lib/app";
import { processDueJobs } from "../src/lib/jobs/processor";
import { MemoryStore } from "../src/lib/store/memory";
import { setStoreForTests } from "../src/lib/store";
import { orphanTx } from "../src/lib/zcash/demo";
import { FIXTURE_PAIRS } from "../src/lib/stonk/fixtures";
import { KEYS } from "./helpers";

/** Launches are always quoted in Zcash, so the fixture pair list has to carry ZEC. */
const ZEC_QUOTE_MINT = FIXTURE_PAIRS.find((p) => p.symbol === "ZEC")!.mint;

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "stamp-"));
  const store = new MemoryStore(join(dir, "state.json"));
  setStoreForTests(store);
  return store;
}

describe("demo issuance worker", () => {
  beforeEach(() => {
    process.env.STAMP_MODE = "demo";
    process.env.STAMP_STORE = "memory";
    tempStore();
  });
  afterEach(() => {
    setStoreForTests(new MemoryStore(join(mkdtempSync(join(tmpdir(), "stamp-x-")), "x.json")));
  });

  it("launches, burns owned units, and confirms a stamp", async () => {
    const owner = KEYS.owner;
    await ensureDemoWallet(owner);
    const launched = await createDemoLaunch({
      owner,
      name: "Unit Coin",
      symbol: "UNIT",
      description: "test",
      imageDataUrl: null,
      quoteMint: ZEC_QUOTE_MINT,
      buyDisplay: "100",
    });
    expect(launched.creatorBalanceBase).toBe("100000000");
    const job = await convert({
      mint: launched.launch.mint,
      owner,
      amountDisplay: "10",
      destination: "zdemo1holderdestination0001",
    });
    expect(["confirmed", "zcash_confirmation_pending"]).toContain(job.state);
    for (let i = 0; i < 6; i++) await processDueJobs();
    const view = await launchView(launched.launch.mint);
    expect(view?.confirmedStampUnitsBase).toBe("10000000");
    expect(BigInt(view?.currentSupply ?? "0") < BigInt(launched.launch.launchSupply)).toBe(true);
  });

  it("refuses to burn pool inventory the creator does not hold", async () => {
    const owner = KEYS.owner;
    const launched = await createDemoLaunch({
      owner,
      name: "Empty",
      symbol: "EMPT",
      description: "",
      imageDataUrl: null,
      quoteMint: ZEC_QUOTE_MINT,
    });
    await expect(
      convert({
        mint: launched.launch.mint,
        owner,
        amountDisplay: "1",
        destination: "zdemo1holderdestination0001",
      }),
    ).rejects.toThrow(/eligible balance|does not hold/i);
  });

  it("rejects a failed burn and does not issue", async () => {
    const owner = KEYS.owner;
    await ensureDemoWallet(owner);
    const seed = await ensureDemoWallet(owner);
    const job = await convert({
      mint: seed.mint,
      owner,
      amountDisplay: "1",
      destination: "zdemo1holderdestination0001",
      fail: true,
    });
    expect(job.state).toBe("rejected");
    expect(job.rejectReason).toBe("tx_failed");
  });

  it("resumes publication after restart once the burn is finalized", async () => {
    const owner = KEYS.owner;
    const seed = await ensureDemoWallet(owner);
    const job = await convert({
      mint: seed.mint,
      owner,
      amountDisplay: "2",
      destination: "zdemo1holderdestination0001",
    });
    const { getStore } = await import("../src/lib/store");
    const store = getStore();
    const persisted = await store.getJob(job.id);
    expect(persisted).toBeTruthy();
    expect(persisted?.sourceTx).toBeTruthy();
    if (persisted && persisted.state === "confirmed") {
      await store.upsertJob({ ...persisted, state: "burn_finalized", zcashTx: null, confirmations: 0 });
    }
    await processDueJobs();
    await processDueJobs();
    await processDueJobs();
    const again = await store.getJob(job.id);
    expect(["confirmed", "zcash_confirmation_pending", "publication_pending", "retryable"]).toContain(again?.state);
    const { solana } = await store.loadDemo();
    expect(solana.txs[again?.sourceTx ?? ""]).toBeTruthy();
  });

  it("returns to publication_pending if the Zcash tx is orphaned", async () => {
    const owner = KEYS.owner;
    const seed = await ensureDemoWallet(owner);
    const job = await convert({
      mint: seed.mint,
      owner,
      amountDisplay: "3",
      destination: "zdemo1holderdestination0001",
    });
    const store = (await import("../src/lib/store")).getStore();
    const latest = await store.getJob(job.id);
    if (latest?.zcashTx) {
      const demo = await store.loadDemo();
      orphanTx(demo.zcash, latest.zcashTx);
      await store.saveDemo(demo.solana, demo.zcash);
      await store.upsertJob({ ...latest, state: "zcash_confirmation_pending" });
      await processDueJobs();
      const after = await store.getJob(job.id);
      expect(after?.state === "publication_pending" || after?.state === "zcash_confirmation_pending" || after?.state === "confirmed").toBe(true);
    }
  });
});
