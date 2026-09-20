import { describe, expect, it } from "vitest";
import {
  indexInscriptions,
  supplyEqualsBurns,
  type ObservedBurn,
  type ObservedInscription,
} from "../src/lib/inscriptions";
import { encodeStamp, type StampPayload } from "../src/lib/zcash/inscription";

/**
 * The happy path is the real thing: the stamp in Zcash transaction
 * b2cbded5…c5acb at height 3,490,084 and the Solana burn it cites,
 * RcxGYhJt…x8M in slot 448,759,562. Both were read off mainnet.
 */
const REAL_SCRIPT_SIG =
  "036f726452106170706c69636174696f6e2f6a736f6e514cf07b2270223a227a73616d74657374222c226f70223a226d696e74222c2276223a312c226d696e74223a2233776261514e673751596e4e5635697a4c5554716f4758654644476a3635375436486e62516d416170395965222c226275726e223a225263784759684a744c4c6d5a417768413145654d71524356456543326564465359623332516a6361316f7234537a4b4e707066316e5a5333637a574c32374a6637343172625a665048554d703250484c7573473778384d222c22616d74223a2231353030303030303030303030222c22746f223a227431503247637847687a654d3574506b3372334a73476831744556000a4172443443326642227d483045022100b164117509796884523f8d3c54c285e14711602478aeb8ac60dfe1e52febd9fb02201aec98ccbaf23bed34fa5ec0e15588e2a6fd416ba15963975b1a7ac305d50d38014c4d2102965dda8783a3609eae684ca4eaae0881f58215ea19fcd57451c04e1bd27f0ae9ad205752a667013c9f75ab077768f298dc1df20c595e2efae59c5ddcadbfa0cd07b2757575757575757551";

const RECIPIENT = "t1P2GcxGhzeM5tPk3r3JsGh1tEVArD4C2fB";
const MINT = "3wbaQNg7QYnNV5izLUTqoGXeFDGj657T6HnbQmAap9Ye";
const BURN_SIG =
  "RcxGYhJtLLmZAwhA1EeMqRCVEeC2edFSYb32Qjca1or4SzKNppf1nZS3czWL27Jf741rbZfPHUMp2PHLusG7x8M";
const AUTHORITY = "CkYBWStJkXMDM1XqyBTukYHxivjDmhBv8A7i1wcMgj3o";
const AMOUNT = "1500000000000";
const TIP = 3_490_484;

const REAL_STAMP: ObservedInscription = {
  txid: "b2cbded5c37c2cca8918a077a73e2ca349005efba046cee0866b34dd879c5acb",
  height: 3_490_084,
  scriptSigHex: REAL_SCRIPT_SIG,
  outputs: [{ address: RECIPIENT, zatoshis: 546 }],
};

const REAL_BURN: ObservedBurn = {
  signature: BURN_SIG,
  slot: 448_759_562,
  finalized: true,
  err: null,
  mint: MINT,
  amountBase: AMOUNT,
  decimals: 6,
  authority: AUTHORITY,
  memos: [{ text: RECIPIENT, signer: AUTHORITY }],
};

const PAYLOAD: StampPayload = {
  p: "zsamtest",
  op: "mint",
  v: 1,
  mint: MINT,
  burn: BURN_SIG,
  amt: AMOUNT,
  to: RECIPIENT,
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Builds an inscription carrying an arbitrary payload, as a forger would. */
function inscribe(
  txid: string,
  height: number,
  payload: StampPayload,
  outputs = [{ address: payload.to, zatoshis: 546 }],
): ObservedInscription {
  return { txid, height, scriptSigHex: toHex(encodeStamp(payload)), outputs };
}

function index(inscriptions: ObservedInscription[], burns: ObservedBurn[] = [REAL_BURN]) {
  return indexInscriptions({
    inscriptions,
    burns,
    tipHeight: TIP,
    minConfirmations: 10,
    acceptProtocols: ["zsamtest"],
  });
}

describe("stamp set", () => {
  it("accepts the stamp that is live on Zcash mainnet", () => {
    const set = index([REAL_STAMP]);
    expect(set.rejected).toEqual([]);
    expect(set.accepted).toHaveLength(1);
    expect(set.accepted[0].payload).toEqual(PAYLOAD);
    expect(set.accepted[0].deliveredZatoshis).toBe(546);
    expect(set.supplyByMint[MINT]).toBe(AMOUNT);
    expect(set.claimedBurns[BURN_SIG]).toBe(REAL_STAMP.txid);
    expect(supplyEqualsBurns(set)).toBe(true);
  });

  it("refuses a stamp citing a burn that never happened", () => {
    const forged = inscribe("f0".repeat(32), 3_490_090, {
      ...PAYLOAD,
      burn: "1".repeat(88),
      amt: "15000000000000",
    });
    const set = index([forged]);
    expect(set.accepted).toEqual([]);
    expect(set.rejected[0].reason).toBe("burn_not_found");
    expect(set.supplyByMint).toEqual({});
  });

  it("refuses ten times the amount that was destroyed", () => {
    const forged = inscribe("f1".repeat(32), 3_490_090, { ...PAYLOAD, amt: "15000000000000" });
    const set = index([forged]);
    expect(set.accepted).toEqual([]);
    expect(set.rejected[0].reason).toBe("amount_mismatch");
    expect(set.rejected[0].message).toContain(AMOUNT);
  });

  it("refuses a recipient the burner did not choose", () => {
    const substituted = inscribe("f2".repeat(32), 3_490_090, {
      ...PAYLOAD,
      to: "t1attackerAddressThatWasNeverMemoed",
    });
    const set = index([substituted]);
    expect(set.accepted).toEqual([]);
    expect(set.rejected[0].reason).toBe("recipient_unauthorized");
  });

  it("refuses a memo signed by someone other than the burn authority", () => {
    const burn: ObservedBurn = {
      ...REAL_BURN,
      memos: [{ text: RECIPIENT, signer: "SomeOtherSignerEntirely1111111111111111111" }],
    };
    const set = index([REAL_STAMP], [burn]);
    expect(set.rejected[0].reason).toBe("recipient_unauthorized");
  });

  it("claims a burn exactly once, earliest first", () => {
    const second = inscribe("aa".repeat(32), 3_490_200, PAYLOAD);
    const set = index([second, REAL_STAMP]);
    expect(set.accepted.map((s) => s.id)).toEqual([REAL_STAMP.txid]);
    expect(set.rejected[0].reason).toBe("already_claimed");
    expect(set.rejected[0].message).toContain(REAL_STAMP.txid);
    // The duplicate must not inflate supply.
    expect(set.supplyByMint[MINT]).toBe(AMOUNT);
    expect(supplyEqualsBurns(set)).toBe(true);
  });

  it("breaks ties by txid so two indexers agree", () => {
    const low = inscribe("00" + "bb".repeat(31), 3_490_084, PAYLOAD);
    const high = inscribe("ff" + "bb".repeat(31), 3_490_084, PAYLOAD);
    expect(index([high, low]).accepted.map((s) => s.id)).toEqual([low.txid]);
    expect(index([low, high]).accepted.map((s) => s.id)).toEqual([low.txid]);
  });

  it("refuses a failed or unfinalized burn", () => {
    expect(index([REAL_STAMP], [{ ...REAL_BURN, err: { InstructionError: [0, "Custom"] } }])
      .rejected[0].reason).toBe("burn_failed");
    expect(index([REAL_STAMP], [{ ...REAL_BURN, finalized: false }]).rejected[0].reason).toBe(
      "burn_unconfirmed",
    );
  });

  it("refuses a stamp whose reveal pays the recipient nothing", () => {
    const undelivered = inscribe("f3".repeat(32), 3_490_090, PAYLOAD, [
      { address: "t1SomewhereElseEntirely", zatoshis: 546 },
    ]);
    const set = index([undelivered]);
    expect(set.rejected[0].reason).toBe("not_delivered");
  });

  it("holds a stamp as pending until it has enough confirmations", () => {
    const fresh = inscribe("f4".repeat(32), TIP, PAYLOAD);
    const set = index([fresh]);
    expect(set.accepted).toEqual([]);
    expect(set.rejected).toEqual([]);
    expect(set.pending[0].confirmations).toBe(1);
  });

  it("leaves another project's protocol alone", () => {
    const foreign = inscribe("f5".repeat(32), 3_490_090, { ...PAYLOAD, p: "someoneelse" });
    expect(index([foreign]).rejected[0].reason).toBe("foreign_protocol");
  });

  it("ignores transactions that carry no envelope", () => {
    const plain: ObservedInscription = {
      txid: "f6".repeat(32),
      height: 3_490_090,
      scriptSigHex: "483045022100",
      outputs: [{ address: RECIPIENT, zatoshis: 546 }],
    };
    expect(index([plain]).rejected[0].reason).toBe("not_an_inscription");
  });

  it("derives the same set whatever order the blocks arrive in", () => {
    const items = [
      REAL_STAMP,
      inscribe("cc".repeat(32), 3_490_120, { ...PAYLOAD, amt: "15000000000000" }),
      inscribe("dd".repeat(32), 3_490_130, PAYLOAD),
      inscribe("ee".repeat(32), TIP, PAYLOAD),
    ];
    const forward = JSON.stringify(index(items));
    const reversed = JSON.stringify(index([...items].reverse()));
    expect(reversed).toBe(forward);
  });
});
