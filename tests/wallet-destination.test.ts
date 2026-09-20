/**
 * The Zcash destination a wallet owner supplies. Phantom cannot produce one, so
 * this is typed in and has to be checked properly before it is memoed into a
 * burn: the checks below run in the browser, which is why they carry their own
 * SHA-256 rather than leaning on node:crypto.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { previewConvert } from "../src/lib/app";
import { encodeBase58, encodeMainnetLikeTestVector, validateDestination } from "../src/lib/protocol";
import { sha256, validateTransparentAddress } from "../src/lib/protocol/taddr";
import { setStoreForTests } from "../src/lib/store";
import { MemoryStore } from "../src/lib/store/memory";
import { readDestination, writeDestination, type StorageLike } from "../src/lib/wallet/destination";
import { launchFundedCoin } from "./helpers";

/** Base58check with node's hash, so the pure implementation is checked against it. */
function transparentAddress(versionHex: string, fill = 7): string {
  const payload = Buffer.concat([Buffer.from(versionHex, "hex"), Buffer.alloc(20, fill)]);
  const checksum = createHash("sha256")
    .update(createHash("sha256").update(payload).digest())
    .digest()
    .subarray(0, 4);
  return encodeBase58(Buffer.concat([payload, checksum]));
}

const T1 = transparentAddress("1cb8");
const T3 = transparentAddress("1cbd");
const TESTNET = transparentAddress("1d25");

describe("sha256 without node built-ins", () => {
  it("agrees with node across the padding boundaries", () => {
    for (const length of [0, 1, 32, 54, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const input = randomBytes(length);
      expect(Buffer.from(sha256(input)).toString("hex")).toBe(
        createHash("sha256").update(input).digest("hex"),
      );
    }
  });
});

describe("transparent address validation", () => {
  it("accepts mainnet p2pkh and p2sh addresses", () => {
    expect(validateTransparentAddress(T1)).toMatchObject({
      ok: true,
      network: "zcash:main",
      kind: "p2pkh",
    });
    expect(validateTransparentAddress(T3)).toMatchObject({
      ok: true,
      network: "zcash:main",
      kind: "p2sh",
    });
  });

  it("names the network of a testnet address instead of accepting it silently", () => {
    expect(validateTransparentAddress(TESTNET)).toMatchObject({
      ok: true,
      network: "zcash:test",
    });
  });

  it("catches a mistyped character through the checksum", () => {
    const broken = `${T1.slice(0, -1)}${T1.endsWith("A") ? "B" : "A"}`;
    const result = validateTransparentAddress(broken);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/checksum|26 bytes/);
  });

  it("refuses shielded and unified addresses with a reason", () => {
    expect(validateTransparentAddress("zs1notallowed").message).toMatch(/shielded/i);
    expect(validateTransparentAddress("u1notallowed").message).toMatch(/unified/i);
  });

  it("refuses empty, padded and nonsense input", () => {
    expect(validateTransparentAddress("").message).toMatch(/Enter a Zcash/);
    expect(validateTransparentAddress(` ${T1} `).message).toMatch(/space/);
    expect(validateTransparentAddress("not an address").ok).toBe(false);
  });

  it("checks a TEX address with bech32m", () => {
    expect(validateTransparentAddress("tex1s0000000000000000000000000000000000000").ok).toBe(false);
  });
});

describe("destination networks", () => {
  it("accepts a real mainnet address on the in-process ledger", () => {
    expect(validateDestination("zcash:demo", T1)).toMatchObject({ ok: true });
    expect(validateDestination("zcash:demo", "zdemo1holderdestination0001")).toMatchObject({
      ok: true,
    });
  });

  it("will not take a testnet address for a mainnet destination", () => {
    const result = validateDestination("zcash:demo", TESTNET);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/mainnet/);
    expect(validateDestination("zcash:test", T1).ok).toBe(false);
  });

  it("keeps rejecting shielded destinations everywhere", () => {
    expect(validateDestination("zcash:demo", "zs1notallowed").ok).toBe(false);
    expect(validateDestination("zcash:main", "zs1notallowed").ok).toBe(false);
  });

  it("still accepts the mainnet vector the protocol tests use", () => {
    expect(validateDestination("zcash:main", encodeMainnetLikeTestVector()).ok).toBe(true);
  });
});

describe("issuing to an address the wallet owner supplied", () => {
  beforeEach(() => {
    setStoreForTests(new MemoryStore(join(mkdtempSync(join(tmpdir(), "stamp-dest-")), "state.json")));
  });

  it("previews a burn against a real transparent address", async () => {
    const owner = encodeBase58(nacl.sign.keyPair.fromSeed(Buffer.alloc(32, "d")).publicKey);
    const coin = await launchFundedCoin(owner);
    const preview = await previewConvert({
      mint: coin.mint,
      owner,
      amountDisplay: "5",
      destination: T1,
    });
    expect(preview.destination).toBe(T1);
    expect(preview.destinationCheck).toContain("mainnet");
  });

  it("refuses to preview a burn to a shielded address", async () => {
    const owner = encodeBase58(nacl.sign.keyPair.fromSeed(Buffer.alloc(32, "e")).publicKey);
    const coin = await launchFundedCoin(owner);
    await expect(
      previewConvert({ mint: coin.mint, owner, amountDisplay: "5", destination: "zs1nope" }),
    ).rejects.toThrow(/shielded/i);
  });
});

describe("remembering a destination per wallet", () => {
  function fakeStorage(): StorageLike & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
    };
  }

  it("keeps one address per public key", () => {
    const storage = fakeStorage();
    writeDestination("WalletOne", T1, storage);
    writeDestination("WalletTwo", T3, storage);
    expect(readDestination("WalletOne", storage)).toBe(T1);
    expect(readDestination("WalletTwo", storage)).toBe(T3);
    expect(readDestination("WalletThree", storage)).toBeNull();
  });

  it("forgets an address that is cleared, and survives no storage at all", () => {
    const storage = fakeStorage();
    writeDestination("WalletOne", T1, storage);
    writeDestination("WalletOne", "", storage);
    expect(readDestination("WalletOne", storage)).toBeNull();
    expect(readDestination("WalletOne", null)).toBeNull();
    expect(() => writeDestination("WalletOne", T1, null)).not.toThrow();
  });
});
