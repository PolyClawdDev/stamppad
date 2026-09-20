import { describe, expect, it } from "vitest";
import { indexInscriptions, type ObservedInscription } from "../src/lib/inscriptions";
import { decodeBurns, type ParsedTransaction } from "../src/lib/solana/rpc";
import mainnetBurn from "./fixtures/solana-burn-mainnet.json";

/**
 * The captured response is the real burn the live Zcash stamp cites:
 * RcxGYhJt…x8M in slot 448,759,562, read from mainnet at finalized commitment.
 * It is a Token-2022 burnChecked plus an spl-memo naming the Zcash address.
 */
const BURN_SIG =
  "RcxGYhJtLLmZAwhA1EeMqRCVEeC2edFSYb32Qjca1or4SzKNppf1nZS3czWL27Jf741rbZfPHUMp2PHLusG7x8M";
const MINT = "3wbaQNg7QYnNV5izLUTqoGXeFDGj657T6HnbQmAap9Ye";
const AUTHORITY = "CkYBWStJkXMDM1XqyBTukYHxivjDmhBv8A7i1wcMgj3o";
const RECIPIENT = "t1P2GcxGhzeM5tPk3r3JsGh1tEVArD4C2fB";

const REAL_TX = mainnetBurn as unknown as ParsedTransaction;

const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const MEMO_V3 = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

function burnInstruction(mint: string, amount: string, authority = AUTHORITY) {
  return {
    programId: TOKEN_2022,
    parsed: {
      type: "burnChecked",
      info: { mint, authority, tokenAmount: { amount, decimals: 6 } },
    },
  };
}

/** A transaction shaped like the RPC's output, for cases mainnet does not supply. */
function transaction(
  instructions: unknown[],
  options: { signers?: string[]; inner?: unknown[]; err?: unknown } = {},
): ParsedTransaction {
  return {
    slot: 1,
    transaction: {
      message: {
        accountKeys: (options.signers ?? [AUTHORITY]).map((pubkey) => ({ pubkey, signer: true })),
        instructions: instructions as ParsedTransaction["transaction"]["message"]["instructions"],
      },
    },
    meta: {
      err: options.err ?? null,
      innerInstructions: options.inner
        ? [{ instructions: options.inner as never[] }]
        : [],
    },
  };
}

describe("solana burn reader", () => {
  it("decodes the real mainnet burn", () => {
    const burns = decodeBurns(BURN_SIG, REAL_TX, true);
    expect(burns).toHaveLength(1);
    expect(burns[0]).toEqual({
      signature: BURN_SIG,
      slot: 448_759_562,
      finalized: true,
      err: null,
      mint: MINT,
      amountBase: "1500000000000",
      decimals: 6,
      authority: AUTHORITY,
      memos: [{ text: RECIPIENT, signers: [AUTHORITY] }],
    });
  });

  it("accepts the live stamp when fed the live burn, across both chains", () => {
    // The Zcash side is the real reveal scriptSig; the Solana side is decoded
    // from the captured RPC response. Neither is hand-written.
    const stamp: ObservedInscription = {
      txid: "b2cbded5c37c2cca8918a077a73e2ca349005efba046cee0866b34dd879c5acb",
      height: 3_490_084,
      scriptSigHex:
        "036f726452106170706c69636174696f6e2f6a736f6e514cf07b2270223a227a73616d74657374222c226f70223a226d696e74222c2276223a312c226d696e74223a2233776261514e673751596e4e5635697a4c5554716f4758654644476a3635375436486e62516d416170395965222c226275726e223a225263784759684a744c4c6d5a417768413145654d71524356456543326564465359623332516a6361316f7234537a4b4e707066316e5a5333637a574c32374a6637343172625a665048554d703250484c7573473778384d222c22616d74223a2231353030303030303030303030222c22746f223a227431503247637847687a654d3574506b3372334a73476831744556000a4172443443326642227d483045022100b164117509796884523f8d3c54c285e14711602478aeb8ac60dfe1e52febd9fb02201aec98ccbaf23bed34fa5ec0e15588e2a6fd416ba15963975b1a7ac305d50d38014c4d2102965dda8783a3609eae684ca4eaae0881f58215ea19fcd57451c04e1bd27f0ae9ad205752a667013c9f75ab077768f298dc1df20c595e2efae59c5ddcadbfa0cd07b2757575757575757551",
      outputs: [{ address: RECIPIENT, zatoshis: 546 }],
    };
    const set = indexInscriptions({
      inscriptions: [stamp],
      burns: decodeBurns(BURN_SIG, REAL_TX, true),
      tipHeight: 3_490_484,
      minConfirmations: 10,
      acceptProtocols: ["zsamtest"],
    });
    expect(set.rejected).toEqual([]);
    expect(set.accepted).toHaveLength(1);
    expect(set.supplyByMint[MINT]).toBe("1500000000000");
  });

  it("finds a burn invoked by another program", () => {
    const tx = transaction([{ programId: "SomeRouter1111111111111111111111111111111" }], {
      inner: [burnInstruction(MINT, "42")],
    });
    expect(decodeBurns("s", tx, true)[0].amountBase).toBe("42");
  });

  it("sums repeated burns of one mint so a second stamp cannot claim the rest", () => {
    const tx = transaction([burnInstruction(MINT, "100"), burnInstruction(MINT, "25")]);
    const burns = decodeBurns("s", tx, true);
    expect(burns).toHaveLength(1);
    expect(burns[0].amountBase).toBe("125");
  });

  it("keeps several mints in one transaction apart", () => {
    const other = "So11111111111111111111111111111111111111112";
    const tx = transaction([burnInstruction(MINT, "100"), burnInstruction(other, "7")]);
    const burns = decodeBurns("s", tx, true);
    expect(burns.map((b) => [b.mint, b.amountBase])).toEqual([
      [MINT, "100"],
      [other, "7"],
    ]);
  });

  it("carries a failed transaction through as failed rather than dropping it", () => {
    const tx = transaction([burnInstruction(MINT, "100")], { err: { InstructionError: [0, "x"] } });
    expect(decodeBurns("s", tx, true)[0].err).toEqual({ InstructionError: [0, "x"] });
  });

  it("reports no decimals for a plain burn instead of guessing", () => {
    const tx = transaction([
      {
        programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        parsed: { type: "burn", info: { mint: MINT, authority: AUTHORITY, amount: "500" } },
      },
    ]);
    const burn = decodeBurns("s", tx, true)[0];
    expect(burn.amountBase).toBe("500");
    expect(burn.decimals).toBeNull();
  });

  it("attributes a memo to every signer of its transaction", () => {
    const cosigner = "Cosigner1111111111111111111111111111111111";
    const tx = transaction([burnInstruction(MINT, "1"), { programId: MEMO_V3, parsed: RECIPIENT }], {
      signers: [AUTHORITY, cosigner],
    });
    expect(decodeBurns("s", tx, true)[0].memos).toEqual([
      { text: RECIPIENT, signers: [AUTHORITY, cosigner] },
    ]);
  });

  it("ignores transfers and other token instructions", () => {
    const tx = transaction([
      {
        programId: TOKEN_2022,
        parsed: {
          type: "transferChecked",
          info: { mint: MINT, authority: AUTHORITY, tokenAmount: { amount: "9", decimals: 6 } },
        },
      },
    ]);
    expect(decodeBurns("s", tx, true)).toEqual([]);
  });

  it("ignores a burn logged by a program that is not a token program", () => {
    const tx = transaction([
      {
        programId: "Impostor11111111111111111111111111111111111",
        parsed: {
          type: "burnChecked",
          info: { mint: MINT, authority: AUTHORITY, tokenAmount: { amount: "999", decimals: 6 } },
        },
      },
    ]);
    expect(decodeBurns("s", tx, true)).toEqual([]);
  });
});
