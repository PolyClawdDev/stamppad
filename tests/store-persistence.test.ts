import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { convert, createDemoLaunch } from "../src/lib/app";
import { processDueJobs } from "../src/lib/jobs/processor";
import { storeKind } from "../src/lib/mode";
import { setStoreForTests } from "../src/lib/store";
import { durability, durabilityProblem } from "../src/lib/store/durability";
import { MemoryStore } from "../src/lib/store/memory";
import { closePool, PostgresStore } from "../src/lib/store/postgres";
import type { Store } from "../src/lib/store/types";
import { KEYS, ZEC_QUOTE_MINT } from "./helpers";

/**
 * A launch, the job it produces, and the stamp that job settles into. Anything
 * that claims to be a ledger has to hand all three back unchanged after the
 * process that wrote them is gone.
 */
async function writeALaunch() {
  const launched = await createDemoLaunch({
    owner: KEYS.owner,
    name: "Durable Coin",
    symbol: "DUR",
    description: "survives a restart",
    imageDataUrl: null,
    quoteMint: ZEC_QUOTE_MINT,
    buyDisplay: "100",
  });
  const job = await convert({
    mint: launched.launch.mint,
    owner: KEYS.owner,
    amountDisplay: "10",
    destination: "zdemo1holderdestination0001",
  });
  for (let i = 0; i < 6; i++) await processDueJobs();
  return { mint: launched.launch.mint, jobId: job.id };
}

async function snapshot(store: Store, mint: string, jobId: string) {
  return {
    launch: await store.getLaunch(mint),
    job: await store.getJob(jobId),
    stamps: await store.stampsForMint(mint),
  };
}

describe("a launch outlives the process that wrote it", () => {
  it("comes back identical from a file ledger reopened from scratch", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "stamp-persist-")), "state.json");
    setStoreForTests(new MemoryStore(path));
    const { mint, jobId } = await writeALaunch();
    const before = await snapshot(new MemoryStore(path), mint, jobId);

    // A second store object over the same ledger is what a restart looks like
    // to the data: nothing of the first one is still in memory.
    const after = await snapshot(new MemoryStore(path), mint, jobId);

    expect(after.launch).toEqual(before.launch);
    expect(after.job).toEqual(before.job);
    expect(after.stamps).toEqual(before.stamps);
    expect(after.launch?.mint).toBe(mint);
    expect(after.stamps).toHaveLength(1);
    expect(after.stamps[0]?.amountBase).toBe("10000000");
  });

  it("keeps amounts as exact integers rather than anything a float touched", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "stamp-exact-")), "state.json");
    const store = new MemoryStore(path);
    // Larger than Number.MAX_SAFE_INTEGER, so a float round trip would show.
    const supply = "18446744073709551615";
    await store.upsertLaunch({
      mint: "ExactMint",
      name: "Exact",
      symbol: "EXA",
      description: "",
      imageDataUrl: null,
      website: "",
      twitter: "",
      telegram: "",
      quoteMint: "Q",
      quoteSymbol: "ZEC",
      tokenProgram: "TP",
      decimals: 9,
      launchSupply: supply,
      poolBase: supply,
      currentSupply: supply,
      creator: KEYS.owner,
      launchTx: "tx",
      stonkUrl: "https://example.invalid",
      source: "test",
      createdAt: "2026-09-21T00:11:22.345Z",
    });
    const read = await new MemoryStore(path).getLaunch("ExactMint");
    expect(read?.launchSupply).toBe(supply);
    expect(BigInt(read?.currentSupply ?? "0")).toBe(BigInt(supply));
    expect(read?.createdAt).toBe("2026-09-21T00:11:22.345Z");
  });
});

describe("an ephemeral ledger is a misconfiguration, not a mode", () => {
  function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
    const before: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(env)) {
      before[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      return fn();
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  it("calls a database durable and a working copy a file", () => {
    withEnv(
      {
        DATABASE_URL: "postgres://stamp:stamp@127.0.0.1:5432/stamp",
        POSTGRES_URL: undefined,
        STAMP_STORE: undefined,
      },
      () => {
        expect(durability()).toBe("durable");
        expect(durabilityProblem()).toBeNull();
      },
    );
    withEnv(
      {
        DATABASE_URL: undefined,
        POSTGRES_URL: undefined,
        POSTGRES_PRISMA_URL: undefined,
        DATABASE_URL_UNPOOLED: undefined,
        POSTGRES_URL_NON_POOLING: undefined,
        STAMP_STORE: undefined,
      },
      () => {
        // A writable working copy is a file ledger. A read-only host without
        // a database is ephemeral. Neither is durable.
        expect(durability()).not.toBe("durable");
        if (durability() === "ephemeral") expect(durabilityProblem()).toBeTruthy();
        else expect(durabilityProblem()).toBeNull();
      },
    );
  });

  it("chooses postgres from a connection string alone", () => {
    withEnv({ DATABASE_URL: "postgres://stamp:stamp@127.0.0.1:5432/stamp", STAMP_STORE: undefined }, () => {
      expect(storeKind()).toBe("postgres");
    });
    withEnv({ DATABASE_URL: "postgres://stamp:stamp@127.0.0.1:5432/stamp", STAMP_STORE: "memory" }, () => {
      expect(storeKind()).toBe("memory");
    });
    withEnv({ DATABASE_URL: undefined, STAMP_STORE: undefined }, () => {
      expect(storeKind()).toBe("memory");
    });
    withEnv(
      {
        DATABASE_URL: undefined,
        POSTGRES_URL: "postgres://stamp:stamp@127.0.0.1:5432/stamp",
        STAMP_STORE: undefined,
      },
      () => {
        expect(storeKind()).toBe("postgres");
        expect(durability()).toBe("durable");
      },
    );
  });
});

/**
 * The real thing, against a real server. Skipped without a database because a
 * skipped test is honest and a mocked one would not be evidence of anything.
 */
const PG = process.env.DATABASE_URL || process.env.POSTGRES_URL;

describe.skipIf(!PG)("postgres keeps the ledger", () => {
  beforeEach(async () => {
    const store = new PostgresStore();
    setStoreForTests(store);
    const { withClient } = await import("../src/lib/store/postgres");
    await withClient(async (c) => {
      await c.query("TRUNCATE transfers, listings, stamps, jobs, launches, demo_state");
    });
  });

  afterAll(async () => {
    await closePool();
  });

  it("hands the launch, its job and its stamp back after the pool is thrown away", async () => {
    const { mint, jobId } = await writeALaunch();
    const before = await snapshot(new PostgresStore(), mint, jobId);
    expect(before.launch).toBeTruthy();
    expect(before.stamps).toHaveLength(1);

    // Dropping the pool drops every connection and the memo that says the
    // schema is already there, which is all a cold start has in common with
    // the instance before it.
    await closePool();

    const after = await snapshot(new PostgresStore(), mint, jobId);
    expect(after.launch).toEqual(before.launch);
    expect(after.job).toEqual(before.job);
    expect(after.stamps).toEqual(before.stamps);
  });

  it("migrates from nothing when several cold starts race each other", async () => {
    await closePool();
    await Promise.all(Array.from({ length: 8 }, () => new PostgresStore().listLaunches()));
    expect(await new PostgresStore().listLaunches()).toEqual([]);
  });

  it("refuses an amount that has been through a float", async () => {
    const { withClient } = await import("../src/lib/store/postgres");
    await expect(
      withClient((c) =>
        c.query(
          `INSERT INTO launches (mint,name,symbol,description,image_data_url,quote_mint,quote_symbol,
             token_program,decimals,launch_supply,pool_base,current_supply,creator,launch_tx,stonk_url,source,created_at)
           VALUES ('Floaty','F','F','',NULL,'Q','ZEC','TP',9,'1e+21','0','0','c','tx','u','test',NOW())`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("stores a claim package without tripping over its bigints", async () => {
    const { mint, jobId } = await writeALaunch();
    const job = await new PostgresStore().getJob(jobId);
    expect(job?.claimPackage).toBeTruthy();
    expect(job?.claimPackage?.solana.transaction.mint.supply).toBeTypeOf("bigint");
    expect(job?.mint).toBe(mint);
  });
});
