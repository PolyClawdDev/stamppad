import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convert, createDemoLaunch } from "../src/lib/app";
import { processDueJobs } from "../src/lib/jobs/processor";
import { launchIdentity, withStampIdentity } from "../src/lib/stamps";
import { getStore, setStoreForTests } from "../src/lib/store";
import { MemoryStore } from "../src/lib/store/memory";
import { KEYS, ZEC_QUOTE_MINT } from "./helpers";

const FACE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function tempStore() {
  setStoreForTests(new MemoryStore(join(mkdtempSync(join(tmpdir(), "stamp-id-")), "state.json")));
}

describe("a stamp inherits the launch it was cut from", () => {
  beforeEach(() => {
    process.env.STAMP_MODE = "demo";
    process.env.STAMP_STORE = "memory";
    tempStore();
  });
  afterEach(() => {
    setStoreForTests(new MemoryStore(join(mkdtempSync(join(tmpdir(), "stamp-id-x-")), "x.json")));
  });

  it("keeps the name, ticker and artwork on the issued stamp", async () => {
    const launched = await createDemoLaunch({
      owner: KEYS.owner,
      name: "Golden Letter",
      symbol: "GLTR",
      description: "a real face",
      imageDataUrl: FACE,
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

    const issued = (await getStore().listStamps()).filter((s) => s.jobId === job.id);
    const [stamp] = await withStampIdentity(issued);
    expect(stamp?.name).toBe("Golden Letter");
    expect(stamp?.symbol).toBe("GLTR");
    expect(stamp?.imageDataUrl).toBe(FACE);
    expect(stamp?.number).toBe(1);
  });

  it("does not invent a name for a launch that never had one", () => {
    expect(launchIdentity(null).name).toBeNull();
    expect(launchIdentity(null).imageDataUrl).toBeNull();
    expect(launchIdentity(undefined).symbol).toBe("");
  });
});
