import { describe, expect, it } from "vitest";
import { jupiterQuoteUrl, quoteShortfall } from "../src/lib/solana/jupiter";
import { NATIVE_MINT, ZEC_QUOTE_MINT } from "../src/lib/protocol";

describe("funding a ZEC-quoted launch from SOL", () => {
  it("asks Jupiter for the missing ZEC, not the whole buy, when some is already held", () => {
    expect(quoteShortfall(0n, 1_000_000n)).toBe(1_000_000n);
    expect(quoteShortfall(400_000n, 1_000_000n)).toBe(600_000n);
    expect(quoteShortfall(1_000_000n, 1_000_000n)).toBe(0n);
    expect(quoteShortfall(2_000_000n, 1_000_000n)).toBe(0n);
  });

  it("builds an ExactOut SOL → ZEC quote URL", () => {
    const url = jupiterQuoteUrl({ outputMint: ZEC_QUOTE_MINT, amountOut: 1_000_000n, slippageBps: 50 });
    expect(url).toContain("swapMode=ExactOut");
    expect(url).toContain(`inputMint=${NATIVE_MINT}`);
    expect(url).toContain(`outputMint=${ZEC_QUOTE_MINT}`);
    expect(url).toContain("amount=1000000");
  });
});
