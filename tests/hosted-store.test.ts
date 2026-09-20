import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initialState, MemoryStore } from "../src/lib/store/memory";

/**
 * Nothing is ever pre-filled. A read-only serverless filesystem pushes the
 * ledger into temporary storage, but it still opens empty and only fills up
 * from activity that actually happened on the instance.
 */
describe("memory store", () => {
  it("starts empty", () => {
    const state = initialState();
    expect(Object.keys(state.launches)).toHaveLength(0);
    expect(Object.keys(state.stamps)).toHaveLength(0);
    expect(Object.keys(state.listings)).toHaveLength(0);
    expect(Object.keys(state.transfers)).toHaveLength(0);
    expect(Object.keys(state.jobs)).toHaveLength(0);
  });

  it("carries an empty pair of ledgers rather than no ledger at all", () => {
    const state = initialState();
    expect(state.demo).toBeTruthy();
    expect(Object.keys(state.demo.solana.mints)).toHaveLength(0);
    expect(Object.keys(state.demo.zcash.txs)).toHaveLength(0);
  });

  it("opens empty at an explicit path", async () => {
    const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), "stamp-hosted-")), "state.json"));
    expect(await store.listLaunches()).toHaveLength(0);
    expect(await store.listStamps()).toHaveLength(0);
    expect(await store.listListings()).toHaveLength(0);
  });
});
