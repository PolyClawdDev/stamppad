import { describe, expect, it } from "vitest";
import { quoteLaunch } from "../src/lib/app";
import { ZEC_QUOTE, ZEC_QUOTE_MINT } from "../src/lib/protocol";
import { FIXTURE_PAIRS } from "../src/lib/stonk/fixtures";

describe("ZEC is the stamp launch quote", () => {
  it("names the live Stonk Zcash pair", () => {
    expect(ZEC_QUOTE.mint).toBe("A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS");
    expect(ZEC_QUOTE.symbol).toBe("ZEC");
    const pair = FIXTURE_PAIRS.find((entry) => entry.mint === ZEC_QUOTE_MINT);
    expect(pair).toMatchObject({
      symbol: "ZEC",
      name: "Zcash",
      launchable: true,
      launchLabReady: true,
    });
  });

  it("quotes a launch against ZEC without the caller picking another pair", async () => {
    const quoted = await quoteLaunch(ZEC_QUOTE_MINT);
    expect(quoted.pair.mint).toBe(ZEC_QUOTE_MINT);
    expect(quoted.pair.symbol).toBe("ZEC");
    expect(quoted.costs.initialPurchase).toMatch(/ZEC-paired/);
  });
});
