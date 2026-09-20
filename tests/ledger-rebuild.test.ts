import { describe, expect, it } from "vitest";
import {
  acceptIssuance,
  encodeOpReturnPayload,
  rebuildLedger,
  stableLedgerJson,
  validateBurn,
  type ZcashPublication,
} from "../src/lib/protocol";
import { DEST, KEYS, makeTx } from "./helpers";

function publicationFor(tx: ReturnType<typeof makeTx>, txid: string): ZcashPublication {
  const result = validateBurn(tx, {
    sourceNetwork: "solana:demo",
    destinationNetwork: "zcash:demo",
    mint: KEYS.mint,
    amountBase: 1000n,
    decimals: 6,
    destination: DEST,
  });
  if (!result.ok) throw new Error(result.message);
  return {
    txid,
    network: "zcash:demo",
    height: 200,
    confirmations: 12,
    inBestChain: true,
    outputs: [
      { index: 0, valueZat: 10_000n, address: DEST, nullData: null },
      { index: 1, valueZat: 0n, address: null, nullData: encodeOpReturnPayload(result.commitment) },
    ],
  };
}

describe("ledger rebuild", () => {
  it("produces identical state from two independent replays", () => {
    const tx = makeTx({ nonce: "11".repeat(16) });
    const input = {
      sourceNetwork: "solana:demo" as const,
      destinationNetwork: "zcash:demo" as const,
      minZcashConfirmations: 10,
      solana: [tx],
      zcash: [publicationFor(tx, "aa".repeat(32))],
    };
    const a = stableLedgerJson(rebuildLedger(input));
    const b = stableLedgerJson(rebuildLedger(input));
    expect(a).toBe(b);
    expect(rebuildLedger(input).accepted).toHaveLength(1);
    expect(rebuildLedger(input).acceptedStampUnits[KEYS.mint]).toBe("1000");
  });

  it("does not count unpublished finalized burns in accepted units", () => {
    const tx = makeTx({ nonce: "22".repeat(16) });
    const out = rebuildLedger({
      sourceNetwork: "solana:demo",
      destinationNetwork: "zcash:demo",
      minZcashConfirmations: 10,
      solana: [tx],
      zcash: [],
    });
    expect(out.accepted).toHaveLength(0);
    expect(out.pending[0]?.reason).toBe("publication_pending");
    expect(out.acceptedStampUnits[KEYS.mint]).toBeUndefined();
  });

  it("resolves concurrent publications with a deterministic txid winner", () => {
    const tx = makeTx({ nonce: "33".repeat(16) });
    const result = validateBurn(tx, {
      sourceNetwork: "solana:demo",
      destinationNetwork: "zcash:demo",
      mint: KEYS.mint,
      amountBase: 1000n,
      decimals: 6,
      destination: DEST,
    });
    if (!result.ok) throw new Error(result.message);
    const mk = (txid: string): ZcashPublication => ({
      txid,
      network: "zcash:demo",
      height: 200,
      confirmations: 12,
      inBestChain: true,
      outputs: [
        { index: 0, valueZat: 10_000n, address: DEST, nullData: null },
        { index: 1, valueZat: 0n, address: null, nullData: encodeOpReturnPayload(result.commitment) },
      ],
    });
    const out = rebuildLedger({
      sourceNetwork: "solana:demo",
      destinationNetwork: "zcash:demo",
      minZcashConfirmations: 10,
      solana: [tx],
      zcash: [mk("ff".repeat(32)), mk("00".repeat(32))],
    });
    expect(out.accepted[0]?.zcashTx).toBe("00".repeat(32));
    expect(out.rejected.some((r) => r.reason === "duplicate_publication")).toBe(true);
    expect(out.acceptedStampUnits[KEYS.mint]).toBe("1000");
  });

  it("rejects a second claim for the same burn event", () => {
    const tx = makeTx({ nonce: "44".repeat(16) });
    const pub = publicationFor(tx, "ab".repeat(32));
    const out = rebuildLedger({
      sourceNetwork: "solana:demo",
      destinationNetwork: "zcash:demo",
      minZcashConfirmations: 10,
      solana: [tx, { ...tx }],
      zcash: [pub],
    });
    expect(out.accepted).toHaveLength(1);
    expect(out.rejected.some((r) => r.reason === "duplicate_claim")).toBe(true);
  });

  it("keeps accepted issuance reconstructable", () => {
    const tx = makeTx({ nonce: "55".repeat(16) });
    const result = validateBurn(tx, {
      sourceNetwork: "solana:demo",
      destinationNetwork: "zcash:demo",
      mint: KEYS.mint,
      amountBase: 1000n,
      decimals: 6,
      destination: DEST,
    });
    if (!result.ok) throw new Error(result.message);
    const pub = publicationFor(tx, "cd".repeat(32));
    const accepted = acceptIssuance(result.issuance, pub);
    expect(accepted.destination).toBe(DEST);
    expect(accepted.zcashNullDataIndex).toBe(1);
  });
});
