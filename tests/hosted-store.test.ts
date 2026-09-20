import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initialState, MemoryStore } from "../src/lib/store/memory";

/**
 * A read-only serverless filesystem forces the ledger into temporary storage,
 * where it starts from the committed demo snapshot. Everywhere else still
 * starts empty.
 */
describe("hosted memory store", () => {
  it("starts from the demo snapshot when seeding is on", () => {
    const seeded = initialState(true);
    expect(Object.keys(seeded.launches).length).toBeGreaterThan(0);
    expect(Object.keys(seeded.stamps).length).toBeGreaterThan(0);
    expect(seeded.demo).toBeTruthy();
  });

  it("starts empty otherwise", () => {
    const empty = initialState(false);
    expect(Object.keys(empty.launches)).toHaveLength(0);
    expect(Object.keys(empty.stamps)).toHaveLength(0);
    expect(Object.keys(empty.transfers)).toHaveLength(0);
  });

  it("does not seed a store opened at an explicit path", async () => {
    const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), "stamp-hosted-")), "state.json"));
    expect(await store.listLaunches()).toHaveLength(0);
    expect(await store.listStamps()).toHaveLength(0);
  });

  it("snapshot rows carry the fields the marketplace reads", () => {
    const seeded = initialState(true);
    for (const stamp of Object.values(seeded.stamps)) {
      expect(stamp.mint).toBeTruthy();
      expect(stamp.amountBase).toBeTruthy();
      expect(typeof stamp.decimals).toBe("number");
    }
  });
});
