import { describe, expect, it } from "vitest";
import { emptyZcash, publishDemoStamp } from "../src/lib/zcash/demo";

describe("publication funding", () => {
  it("fails recoverably when the publisher cannot pay ZIP-317 plus notice", () => {
    const chain = emptyZcash();
    chain.fundedZat = 1n;
    expect(() =>
      publishDemoStamp({
        chain,
        network: "zcash:demo",
        destination: "zdemo1holderdestination0001",
        commitment: Buffer.alloc(32, 1),
      }),
    ).toThrow(/Publisher ZEC/);
  });
});
