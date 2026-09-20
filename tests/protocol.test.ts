import { describe, expect, it } from "vitest";
import {
  TOKEN_2022_PROGRAM_ID,
  encodeMainnetLikeTestVector,
  encodeOpReturnPayload,
  validateBurn,
  validateDestination,
} from "../src/lib/protocol";
import { DEST, KEYS, accountView, makeTx, mintView } from "./helpers";

const expected = {
  sourceNetwork: "solana:demo" as const,
  destinationNetwork: "zcash:demo" as const,
  mint: KEYS.mint,
  amountBase: 1000n,
  decimals: 6,
  destination: DEST,
};

describe("validateBurn", () => {
  it("accepts a finalized owner BurnChecked with same-tx intent", () => {
    const result = validateBurn(makeTx({}), expected);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issuance.amountBase).toBe("1000");
      expect(result.issuance.authorityRole).toBe("owner");
    }
  });

  it("rejects a failed transaction", () => {
    const result = validateBurn(makeTx({ err: { err: "failed" } }), expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("tx_failed");
  });

  it("rejects confirmed-but-not-finalized", () => {
    const result = validateBurn(makeTx({ commitment: "confirmed" }), expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_finalized");
  });

  it("rejects the wrong network", () => {
    const result = validateBurn(makeTx({ network: "solana:mainnet-beta" }), expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("wrong_network");
  });

  it("rejects the wrong mint", () => {
    const result = validateBurn(makeTx({}), { ...expected, mint: KEYS.other });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("wrong_mint");
  });

  it("rejects the wrong amount", () => {
    const result = validateBurn(makeTx({ amount: 5n }), expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("wrong_amount");
  });

  it("rejects wrong decimals", () => {
    const result = validateBurn(makeTx({ mint: mintView({ decimals: 9 }) }), expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("wrong_decimals");
  });

  it("rejects a destination that was not in the signed intent", () => {
    const result = validateBurn(makeTx({}), { ...expected, destination: "zdemo1someoneelse00000000" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unauthorized_destination");
  });

  it("rejects a memo-only transaction", () => {
    const result = validateBurn(makeTx({ skipIntent: true }), expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_intent");
  });

  it("rejects an unsigned authority", () => {
    const result = validateBurn(makeTx({ signers: [KEYS.other] }), expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("authority_not_signer");
  });

  it("rejects transfer-fee Token-2022 mints", () => {
    const result = validateBurn(
      makeTx({
        mint: mintView({ programId: TOKEN_2022_PROGRAM_ID, extensions: ["transferFeeConfig"] }),
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      expected,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported_extension");
  });

  it("rejects frozen accounts", () => {
    const result = validateBurn(makeTx({ account: accountView({ frozen: true }) }), expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("frozen_account");
  });

  it("allows an approved delegate who signed", () => {
    const result = validateBurn(
      makeTx({
        account: accountView({ delegate: KEYS.other, delegatedAmount: 1000n }),
        signers: [KEYS.other],
      }),
      expected,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.issuance.authorityRole).toBe("delegate");
  });
});

describe("destinations", () => {
  it("accepts demo destinations and rejects shielded z-addresses", () => {
    expect(validateDestination("zcash:demo", DEST).ok).toBe(true);
    expect(validateDestination("zcash:demo", "zs1notallowed").ok).toBe(false);
    expect(validateDestination("zcash:main", "zs1notallowed").ok).toBe(false);
  });

  it("accepts a checksummed mainnet t1 test vector", () => {
    const addr = encodeMainnetLikeTestVector();
    expect(validateDestination("zcash:main", addr).ok).toBe(true);
    expect(validateDestination("zcash:test", addr).ok).toBe(false);
  });
});

describe("OP_RETURN budget", () => {
  it("encodes a 38-byte payload inside the 80-byte data relay limit", () => {
    const payload = encodeOpReturnPayload(Buffer.alloc(32, 7));
    expect(payload.length).toBe(38);
    expect(payload.length).toBeLessThanOrEqual(80);
  });
});
