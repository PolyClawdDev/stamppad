import { describe, expect, it } from "vitest";
import { quoteLaunch } from "../src/lib/app";
import { NATIVE_MINT, SOL_QUOTE, ZEC_QUOTE, ZEC_QUOTE_MINT } from "../src/lib/protocol";
import { FIXTURE_PAIRS } from "../src/lib/stonk/fixtures";

describe("Stonk launch quote", () => {
  it("defaults StampPad launches to Stonk's SOL pair", () => {
    expect(SOL_QUOTE.mint).toBe(NATIVE_MINT);
    expect(SOL_QUOTE.symbol).toBe("SOL");
    const pair = FIXTURE_PAIRS.find((entry) => entry.mint === NATIVE_MINT);
    expect(pair).toMatchObject({
      symbol: "SOL",
      launchable: true,
      launchLabReady: true,
    });
  });

  it("still knows ZEC is a launchable Stonk pair", () => {
    expect(ZEC_QUOTE.mint).toBe(ZEC_QUOTE_MINT);
    const pair = FIXTURE_PAIRS.find((entry) => entry.mint === ZEC_QUOTE_MINT);
    expect(pair).toMatchObject({
      symbol: "ZEC",
      name: "Zcash",
      launchable: true,
      launchLabReady: true,
    });
  });

  it("quotes a launch against SOL", async () => {
    const quoted = await quoteLaunch(NATIVE_MINT);
    expect(quoted.pair.mint).toBe(NATIVE_MINT);
    expect(quoted.pair.symbol).toBe("SOL");
    expect(quoted.costs.initialPurchase).toMatch(/Paid in SOL/);
  });
});
