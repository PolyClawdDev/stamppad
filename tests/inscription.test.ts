import { describe, expect, it } from "vitest";
import {
  decodeEnvelope,
  decodeRedeemScript,
  decodeStamp,
  encodePayload,
  encodeStamp,
  type StampPayload,
} from "../src/lib/zcash/inscription";

/**
 * Bytes taken from the live stamp on Zcash mainnet, transaction
 * b2cbded5c37c2cca8918a077a73e2ca349005efba046cee0866b34dd879c5acb
 * in block 3,490,084. The data section of the reveal scriptSig, up to the
 * signature push.
 */
const MAINNET_DATA_SECTION =
  "036f726452106170706c69636174696f6e2f6a736f6e514cf07b2270223a227a73616d74657374222c226f70223a226d696e74222c2276223a312c226d696e74223a2233776261514e673751596e4e5635697a4c5554716f4758654644476a3635375436486e62516d416170395965222c226275726e223a225263784759684a744c4c6d5a417768413145654d71524356456543326564465359623332516a6361316f7234537a4b4e707066316e5a5333637a574c32374a6637343172625a665048554d703250484c7573473778384d222c22616d74223a2231353030303030303030303030222c22746f223a227431503247637847687a654d3574506b3372334a73476831744556000a4172443443326642227d";

/** The redeem script pushed last in that same scriptSig. */
const MAINNET_REDEEM_SCRIPT =
  "2102965dda8783a3609eae684ca4eaae0881f58215ea19fcd57451c04e1bd27f0ae9ad205752a667013c9f75ab077768f298dc1df20c595e2efae59c5ddcadbfa0cd07b2757575757575757551";

/** The stamp that transaction carries. */
const MAINNET_STAMP: StampPayload = {
  p: "zsamtest",
  op: "mint",
  v: 1,
  mint: "3wbaQNg7QYnNV5izLUTqoGXeFDGj657T6HnbQmAap9Ye",
  burn: "RcxGYhJtLLmZAwhA1EeMqRCVEeC2edFSYb32Qjca1or4SzKNppf1nZS3czWL27Jf741rbZfPHUMp2PHLusG7x8M",
  amt: "1500000000000",
  to: "t1P2GcxGhzeM5tPk3r3JsGh1tEVArD4C2fB",
};

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("zcash inscription envelope", () => {
  it("reproduces a real mainnet stamp byte for byte", () => {
    expect(toHex(encodeStamp(MAINNET_STAMP))).toBe(MAINNET_DATA_SECTION);
  });

  it("decodes the mainnet stamp back to its fields", () => {
    expect(decodeStamp(fromHex(MAINNET_DATA_SECTION))).toEqual(MAINNET_STAMP);
  });

  it("reassembles a body split across pushes", () => {
    const envelope = decodeEnvelope(fromHex(MAINNET_DATA_SECTION));
    expect(envelope?.contentType).toBe("application/json");
    // 250 bytes of JSON, written as a 240-byte chunk plus a 10-byte continuation.
    expect(envelope?.body).toHaveLength(250);
    expect(JSON.parse(envelope!.body).amt).toBe("1500000000000");
  });

  it("round-trips a payload needing several chunks", () => {
    const wide: StampPayload = { ...MAINNET_STAMP, burn: "z".repeat(600) };
    expect(decodeStamp(encodeStamp(wide))).toEqual(wide);
  });

  it("keeps the amount as an exact integer string", () => {
    const payload = { ...MAINNET_STAMP, amt: "18446744073709551615" };
    expect(decodeStamp(encodeStamp(payload))?.amt).toBe("18446744073709551615");
    expect(encodePayload(payload)).toContain('"amt":"18446744073709551615"');
  });

  it("reads the reveal redeem script", () => {
    const script = decodeRedeemScript(fromHex(MAINNET_REDEEM_SCRIPT));
    expect(script?.publicKey).toHaveLength(33);
    expect(script?.commitment).toHaveLength(32);
    // Eight OP_DROPs clear the commitment and the seven envelope items.
    expect(script?.drops).toBe(8);
  });

  it("refuses payloads that are not stamps", () => {
    expect(decodeStamp(fromHex("51"))).toBeNull();
    expect(decodeStamp(encodeStamp({ ...MAINNET_STAMP, amt: "1.5" }))).toBeNull();
    expect(
      decodeStamp(
        encodeStamp({ ...MAINNET_STAMP, op: "transfer" as unknown as StampPayload["op"] }),
      ),
    ).toBeNull();
  });

  it("finds the envelope inside a full scriptSig", () => {
    const full = fromHex(`${MAINNET_DATA_SECTION}48${"00".repeat(72)}${MAINNET_REDEEM_SCRIPT}`);
    expect(decodeStamp(full)).toEqual(MAINNET_STAMP);
  });
});
