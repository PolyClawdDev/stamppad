/**
 * The wall between building a mainnet transaction and being allowed to.
 *
 * Every path that can move real money is off unless its own flag is set, and
 * the reason it is off has to be the current reason rather than a stale note
 * about some endpoint that was down once. These tests are about the default
 * being safe: a deployment that sets STAMP_MODE=mainnet and nothing else must
 * still refuse to launch, burn or publish.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flags, liveMoneyMovementBlocked } from "../src/lib/mode";
import { resolveMetadataUri } from "../src/lib/solana/live-launch";
import { DemoLaunchIntegration, LiveLaunchIntegration } from "../src/lib/modules/launch";

const KINDS = ["launch", "burn", "publish", "stampSale"] as const;
const ENV_KEYS = [
  "STAMP_MODE",
  "STAMP_ALLOW_LIVE_LAUNCH",
  "STAMP_ALLOW_LIVE_BURNS",
  "STAMP_ALLOW_LIVE_ZCASH_PUBLISH",
  "STAMP_ALLOW_LIVE_STAMP_SALES",
  "STAMP_GO_LIVE",
  "SOLANA_RPC_URL",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("live money movement is off by default", () => {
  it("refuses every kind on mainnet when no flag is set", () => {
    process.env.STAMP_MODE = "mainnet";
    for (const kind of KINDS) {
      expect(liveMoneyMovementBlocked(kind)).toBeTruthy();
    }
  });

  it("refuses every kind on testnet too", () => {
    process.env.STAMP_MODE = "testnet";
    for (const kind of KINDS) {
      expect(liveMoneyMovementBlocked(kind)).toBeTruthy();
    }
  });

  it("opens launch, burn and publish together from STAMP_GO_LIVE", () => {
    process.env.STAMP_MODE = "mainnet";
    process.env.STAMP_GO_LIVE = "true";
    expect(liveMoneyMovementBlocked("launch")).toBeNull();
    expect(liveMoneyMovementBlocked("burn")).toBeNull();
    expect(liveMoneyMovementBlocked("publish")).toBeNull();
    expect(liveMoneyMovementBlocked("stampSale")).toBeTruthy();
  });

  it("opens only the kind whose own flag is set", () => {
    process.env.STAMP_MODE = "mainnet";
    process.env.STAMP_ALLOW_LIVE_LAUNCH = "true";
    expect(liveMoneyMovementBlocked("launch")).toBeNull();
    // Enabling launches must not enable burning or publishing.
    expect(liveMoneyMovementBlocked("burn")).toBeTruthy();
    expect(liveMoneyMovementBlocked("publish")).toBeTruthy();
    expect(liveMoneyMovementBlocked("stampSale")).toBeTruthy();
  });

  it("treats anything other than the exact string true as off", () => {
    process.env.STAMP_MODE = "mainnet";
    for (const value of ["1", "yes", "TRUE", "True", " true", ""]) {
      process.env.STAMP_ALLOW_LIVE_LAUNCH = value;
      expect(flags().allowLiveLaunch).toBe(false);
      expect(liveMoneyMovementBlocked("launch")).toBeTruthy();
    }
  });

  it("blocks nothing in demo mode, because demo moves nothing", () => {
    process.env.STAMP_MODE = "demo";
    for (const kind of KINDS) {
      expect(liveMoneyMovementBlocked(kind)).toBeNull();
    }
  });

  it("explains a blocked launch by what it would cost, not by a past outage", () => {
    process.env.STAMP_MODE = "mainnet";
    const reason = liveMoneyMovementBlocked("launch")!;
    expect(reason).toMatch(/real mint on Solana mainnet/);
    expect(reason).toMatch(/STAMP_ALLOW_LIVE_LAUNCH/);
    expect(reason).not.toMatch(/503/);
  });
});

describe("the live integration refuses before it builds", () => {
  it("will not prepare a launch while the flag is off", async () => {
    process.env.STAMP_MODE = "mainnet";
    process.env.SOLANA_RPC_URL = "https://example.invalid";
    await expect(
      new LiveLaunchIntegration().prepare({
        creator: "ByiAbN9MJhfQKGK5WJrfgko6XS88qqERQVRLWZTsvyTf",
        name: "N",
        symbol: "S",
        metadataUriTemplate: "https://e.test/{mint}",
        quoteMint: "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS",
        quoteAmountIn: 1n,
      }),
    ).rejects.toThrow(/Live launches are disabled/);
  });

  it("will not build a launch without an RPC to prove it against", async () => {
    process.env.STAMP_MODE = "mainnet";
    process.env.STAMP_ALLOW_LIVE_LAUNCH = "true";
    await expect(
      new LiveLaunchIntegration().prepare({
        creator: "ByiAbN9MJhfQKGK5WJrfgko6XS88qqERQVRLWZTsvyTf",
        name: "N",
        symbol: "S",
        metadataUriTemplate: "https://e.test/{mint}",
        quoteMint: "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS",
        quoteAmountIn: 1n,
      }),
    ).rejects.toThrow(/SOLANA_RPC_URL is required/);
  });

  it("never claims to have created a launch it could not have signed", async () => {
    process.env.STAMP_MODE = "mainnet";
    process.env.STAMP_ALLOW_LIVE_LAUNCH = "true";
    process.env.SOLANA_RPC_URL = "https://example.invalid";
    await expect(new LiveLaunchIntegration().create()).rejects.toThrow(
      /signed by the creator's own wallet/,
    );
  });

  it("says plainly that the demo ledger has nothing to sign", async () => {
    const demo = new DemoLaunchIntegration({} as never);
    await expect(demo.prepare()).rejects.toThrow(/no Solana transaction to sign/);
  });
});

describe("metadata URI", () => {
  const mint = "6GoDm8yxiqmLZ4KGZJbY3fAc5x7h4AQfcS983idu7pvX";

  it("resolves the mint into the template", () => {
    expect(resolveMetadataUri("https://s.test/api/launches/{mint}/metadata", mint)).toBe(
      `https://s.test/api/launches/${mint}/metadata`,
    );
  });

  it("refuses a template that would give every launch the same metadata", () => {
    expect(() => resolveMetadataUri("https://s.test/metadata.json", mint)).toThrow(
      /must contain \{mint\}/,
    );
  });

  it("refuses a URI that is not https, because the mint keeps it forever", () => {
    expect(() => resolveMetadataUri("http://s.test/{mint}", mint)).toThrow(/must be https/);
  });
});
