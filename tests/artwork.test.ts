/**
 * Stamp artwork is the only user-supplied field that can be megabytes long, and
 * it arrives base64-encoded, so the limit has to be measured on the decoded
 * bytes. The browser check is a convenience; these cover the server control.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoLaunch } from "../src/lib/app";
import { ARTWORK_MAX_BYTES, artworkProblem, dataUrlByteLength } from "../src/lib/artwork";
import { setStoreForTests } from "../src/lib/store";
import { MemoryStore } from "../src/lib/store/memory";
import { KEYS, ZEC_QUOTE_MINT } from "./helpers";

function pngDataUrl(bytes: number): string {
  return `data:image/png;base64,${Buffer.alloc(bytes, 1).toString("base64")}`;
}

describe("stamp artwork limit", () => {
  beforeEach(() => {
    process.env.STAMP_MODE = "demo";
    process.env.STAMP_STORE = "memory";
    setStoreForTests(new MemoryStore(join(mkdtempSync(join(tmpdir(), "stamp-art-")), "state.json")));
  });

  it("measures the decoded size, not the encoded length", () => {
    const url = pngDataUrl(ARTWORK_MAX_BYTES);
    expect(dataUrlByteLength(url)).toBe(ARTWORK_MAX_BYTES);
    expect(url.length).toBeGreaterThan(ARTWORK_MAX_BYTES);
  });

  it("accepts artwork at the limit and rejects a byte over it", () => {
    expect(artworkProblem(pngDataUrl(ARTWORK_MAX_BYTES))).toBeNull();
    expect(artworkProblem(pngDataUrl(ARTWORK_MAX_BYTES + 1))).toBe(
      "Artwork must be 2 MB or smaller.",
    );
  });

  it("treats missing artwork as fine and rejects anything that is not an image data URL", () => {
    expect(artworkProblem(null)).toBeNull();
    expect(artworkProblem("")).toBeNull();
    expect(artworkProblem("https://example.com/stamp.png")).toContain("data URL");
    expect(artworkProblem("data:text/html;base64,PHNjcmlwdD4=")).toContain("data URL");
  });

  it("refuses to store an oversized launch even when the browser check is skipped", async () => {
    await expect(
      createDemoLaunch({
        owner: KEYS.owner,
        name: "Big Coin",
        symbol: "BIG",
        description: "",
        imageDataUrl: pngDataUrl(ARTWORK_MAX_BYTES + 1),
        quoteMint: ZEC_QUOTE_MINT,
        buyDisplay: "1",
      }),
    ).rejects.toThrow("Artwork must be 2 MB or smaller.");
  });

  it("keeps a launch that is just under the limit", async () => {
    const launched = await createDemoLaunch({
      owner: KEYS.owner,
      name: "Small Coin",
      symbol: "SMALL",
      description: "",
      imageDataUrl: pngDataUrl(ARTWORK_MAX_BYTES - 1024),
      quoteMint: ZEC_QUOTE_MINT,
      buyDisplay: "1",
    });
    expect(launched.launch.imageDataUrl).not.toBeNull();
    expect(dataUrlByteLength(launched.launch.imageDataUrl!)).toBe(ARTWORK_MAX_BYTES - 1024);
  });
});
