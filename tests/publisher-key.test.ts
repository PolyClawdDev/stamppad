import { describe, expect, it } from "vitest";
import { seedFromMnemonic, deriveScalar, ZCASH_BIP44_ACCOUNT0 } from "../src/lib/zcash/hd";
import { scalarFromSecret } from "../src/lib/zcash/publisher-key";
import { hash160 } from "../src/lib/protocol/hash160";
import { encodeP2pkhAddress } from "../src/lib/protocol/taddr";
import { publicKeyFromScalar } from "../src/lib/zcash/sign";

const ABANDON =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("publisher key material", () => {
  it("matches the published BIP39 seed for the abandon phrase", () => {
    expect(seedFromMnemonic(ABANDON).toString("hex")).toBe(
      "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4",
    );
  });

  it("derives a stable t-address from that phrase", () => {
    const scalar = deriveScalar(seedFromMnemonic(ABANDON), ZCASH_BIP44_ACCOUNT0);
    const address = encodeP2pkhAddress(hash160(publicKeyFromScalar(scalar)));
    expect(address.startsWith("t1")).toBe(true);
    expect(scalarFromSecret(ABANDON)).toBe(scalar);
  });

  it("refuses a t-address used as if it were the key", () => {
    expect(() => scalarFromSecret("t1Tt6TRLAGyPsf9pWbihiuHMPeRnsoPrWfT")).toThrow(/t-address/i);
  });

  it("accepts 0x-prefixed hex", () => {
    const hex = "11".repeat(32);
    expect(scalarFromSecret(`0x${hex}`)).toBe(scalarFromSecret(hex));
  });
});
