/**
 * The burn a stamp can actually be cut from.
 *
 * The thing worth proving is not that burnChecked encodes, it is that a burn
 * this app builds survives the rule in src/lib/inscriptions.ts, because that
 * rule is applied after the tokens are already destroyed. So these tests take a
 * built burn, put it through the same decoder the indexer reads chain data
 * with, and index a stamp against it end to end.
 *
 * The reference is the real mainnet burn RcxGYhJt…x8M, captured in
 * tests/fixtures/solana-burn-mainnet.json.
 */
import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { MEMO_PROGRAM_ID, buildBurnWithMemo, memoInstruction } from "../src/lib/solana/burn";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../src/lib/solana/launchlab";
import { anchorErrorFrom, decodeBurns } from "../src/lib/solana/rpc";
import { checkStampRule } from "../src/lib/solana/live-burn";
import { indexInscriptions, type ObservedInscription } from "../src/lib/inscriptions";
import { encodeStamp, type StampPayload } from "../src/lib/zcash/inscription";
import reference from "./fixtures/solana-burn-mainnet.json";

const MINT = new PublicKey("3wbaQNg7QYnNV5izLUTqoGXeFDGj657T6HnbQmAap9Ye");
const AUTHORITY = new PublicKey("CkYBWStJkXMDM1XqyBTukYHxivjDmhBv8A7i1wcMgj3o");
const TOKEN_ACCOUNT = new PublicKey("GquAMCenGErjNvJo8NezUvrQDW9JM963ajuiHKEw1Q4Y");
const DESTINATION = "t1P2GcxGhzeM5tPk3r3JsGh1tEVArD4C2fB";
const TOKEN_2022 = new PublicKey(TOKEN_2022_PROGRAM_ID);

function build(overrides: Partial<Parameters<typeof buildBurnWithMemo>[0]> = {}) {
  return buildBurnWithMemo({
    mint: MINT,
    authority: AUTHORITY,
    amountBase: 1_500_000_000_000n,
    decimals: 6,
    destination: DESTINATION,
    tokenProgram: TOKEN_2022,
    tokenAccount: TOKEN_ACCOUNT,
    ...overrides,
  });
}

describe("burn with destination memo", () => {
  it("builds the burn and the memo as one pair, in that order", () => {
    const burn = build();
    expect(burn.instructions).toHaveLength(2);
    expect(burn.instructions[0].programId.toBase58()).toBe(TOKEN_2022_PROGRAM_ID);
    expect(burn.instructions[1].programId.toBase58()).toBe(MEMO_PROGRAM_ID);
  });

  it("encodes burnChecked with the amount and decimals the mint has", () => {
    const [burnIx] = build().instructions;
    // SPL Token instruction 15 is BurnChecked: u64 amount then u8 decimals.
    expect(burnIx.data[0]).toBe(15);
    expect(burnIx.data.readBigUInt64LE(1)).toBe(1_500_000_000_000n);
    expect(burnIx.data[9]).toBe(6);
    expect(burnIx.keys.map((key) => key.pubkey.toBase58())).toEqual([
      TOKEN_ACCOUNT.toBase58(),
      MINT.toBase58(),
      AUTHORITY.toBase58(),
    ]);
    expect(burnIx.keys[2].isSigner).toBe(true);
  });

  it("puts the address in the memo as bare utf8, with the authority signing it", () => {
    const [, memo] = build().instructions;
    expect(memo.data.toString("utf8")).toBe(DESTINATION);
    // No JSON, no prefix, no trailing newline: the rule compares the memo text
    // to the address, so anything else makes the stamp unclaimable.
    expect(memo.data).toHaveLength(35);
    expect(memo.keys).toEqual([{ pubkey: AUTHORITY, isSigner: true, isWritable: false }]);
  });

  it("matches the memo the real mainnet burn carried", () => {
    const parsed = reference.transaction.message.instructions.find(
      (instruction) => instruction.programId === MEMO_PROGRAM_ID,
    );
    expect(build().instructions[1].data.toString("utf8")).toBe(parsed?.parsed);
  });

  it("derives the associated token account when none is given", () => {
    // The reference burn's own token account is the ATA for that mint, owner
    // and program, so deriving it has to land on the same address.
    const derived = buildBurnWithMemo({
      mint: MINT,
      authority: AUTHORITY,
      amountBase: 1n,
      decimals: 6,
      destination: DESTINATION,
      tokenProgram: TOKEN_2022,
    });
    expect(derived.tokenAccount.toBase58()).toBe(TOKEN_ACCOUNT.toBase58());
  });

  it("derives a different account for classic SPL Token", () => {
    const classic = buildBurnWithMemo({
      mint: MINT,
      authority: AUTHORITY,
      amountBase: 1n,
      decimals: 6,
      destination: DESTINATION,
      tokenProgram: new PublicKey(TOKEN_PROGRAM_ID),
    });
    expect(classic.tokenAccount.toBase58()).not.toBe(TOKEN_ACCOUNT.toBase58());
  });

  it("refuses to build a burn that could never become a stamp", () => {
    expect(() => build({ amountBase: 0n })).toThrow(/must destroy a positive amount/);
    expect(() => build({ destination: "t1notarealaddressatall" })).toThrow(/Refusing to burn/);
    // A checksum-valid Zcash testnet address: the same key hash as the real
    // destination, re-encoded under the testnet prefix. It would produce a stamp
    // nobody on mainnet can hold.
    expect(() => build({ destination: "tmEs1wnm7PJrb2dwVWmcc8MgdqUFfdaUUs5" })).toThrow(
      /not a Zcash mainnet address/,
    );
    // Whitespace would be trimmed by the rule but not by the bytes we commit.
    expect(() => build({ destination: ` ${DESTINATION}` })).toThrow(/whitespace/);
    expect(() => build({ decimals: 10 })).toThrow(/between 0 and 9/);
  });
});

describe("a built burn against the rule that judges it", () => {
  /**
   * Re-describes a built burn in the shape the RPC returns for a landed one, so
   * the indexer's own decoder reads it. Only the fields the rule depends on are
   * filled; the decoder ignores everything else.
   */
  function asRpcTransaction(burn: ReturnType<typeof buildBurnWithMemo>, amount: string) {
    return {
      slot: 448_759_562,
      meta: { err: null, innerInstructions: [] },
      transaction: {
        message: {
          accountKeys: [{ pubkey: AUTHORITY.toBase58(), signer: true }],
          instructions: [
            {
              programId: TOKEN_2022_PROGRAM_ID,
              parsed: {
                type: "burnChecked",
                info: {
                  mint: MINT.toBase58(),
                  authority: AUTHORITY.toBase58(),
                  tokenAmount: { amount, decimals: 6 },
                },
              },
            },
            { programId: MEMO_PROGRAM_ID, parsed: burn.memo },
          ],
        },
      },
    };
  }

  const signature = "RcxGYhJtLLmZAwhA1EeMqRCVEeC2edFSYb32Qjca1or4SzKNppf1nZS3czWL27Jf741rbZfPHUMp2PHLusG7x8M";

  function stamp(payload: StampPayload): ObservedInscription {
    return {
      txid: "b2cbded5c37c2cca8918a077a73e2ca349005efba046cee0866b34dd879c5acb",
      height: 3_490_084,
      scriptSigHex: Buffer.from(encodeStamp(payload)).toString("hex"),
      outputs: [{ address: payload.to, zatoshis: 546 }],
    };
  }

  it("is accepted: the memo names the destination and the authority signed it", () => {
    const burn = build();
    const burns = decodeBurns(signature, asRpcTransaction(burn, "1500000000000"), true);
    expect(burns).toHaveLength(1);
    expect(burns[0].memos).toEqual([{ text: DESTINATION, signers: [AUTHORITY.toBase58()] }]);

    const set = indexInscriptions({
      inscriptions: [
        stamp({
          p: "zsamtest",
          op: "mint",
          v: 1,
          mint: MINT.toBase58(),
          burn: signature,
          amt: "1500000000000",
          to: DESTINATION,
        }),
      ],
      burns,
      tipHeight: 3_490_484,
      minConfirmations: 10,
      acceptProtocols: ["zsamtest"],
    });
    expect(set.rejected).toEqual([]);
    expect(set.accepted).toHaveLength(1);
    expect(set.supplyByMint[MINT.toBase58()]).toBe("1500000000000");
  });

  it("is rejected when the memo is dropped, which is why they are built together", () => {
    const burn = build();
    const withoutMemo = asRpcTransaction(burn, "1500000000000");
    withoutMemo.transaction.message.instructions.pop();
    const burns = decodeBurns(signature, withoutMemo, true);
    const set = indexInscriptions({
      inscriptions: [
        stamp({
          p: "zsamtest",
          op: "mint",
          v: 1,
          mint: MINT.toBase58(),
          burn: signature,
          amt: "1500000000000",
          to: DESTINATION,
        }),
      ],
      burns,
      tipHeight: 3_490_484,
      minConfirmations: 10,
      acceptProtocols: ["zsamtest"],
    });
    expect(set.accepted).toEqual([]);
    expect(set.rejected[0].reason).toBe("recipient_unauthorized");
  });

  it("is rejected when the memo is not attributed to the burn authority", () => {
    const burn = build();
    const otherSigner = asRpcTransaction(burn, "1500000000000");
    otherSigner.transaction.message.accountKeys = [
      { pubkey: "So11111111111111111111111111111111111111112", signer: true },
    ];
    const burns = decodeBurns(signature, otherSigner, true);
    const set = indexInscriptions({
      inscriptions: [
        stamp({
          p: "zsamtest",
          op: "mint",
          v: 1,
          mint: MINT.toBase58(),
          burn: signature,
          amt: "1500000000000",
          to: DESTINATION,
        }),
      ],
      burns,
      tipHeight: 3_490_484,
      minConfirmations: 10,
      acceptProtocols: ["zsamtest"],
    });
    expect(set.rejected[0].reason).toBe("recipient_unauthorized");
  });
});

describe("checking a built burn against the rule before it is approved", () => {
  /** A token account as the RPC returns it, with `amount` at offset 64. */
  function tokenAccount(amount: bigint) {
    const data = Buffer.alloc(165);
    MINT.toBuffer().copy(data, 0);
    AUTHORITY.toBuffer().copy(data, 32);
    data.writeBigUInt64LE(amount, 64);
    return {
      owner: TOKEN_2022_PROGRAM_ID,
      lamports: 2_074_080,
      data: [data.toString("base64"), "base64"] as [string, string],
      executable: false,
    };
  }

  /**
   * The log stream a successful burn-plus-memo produces on mainnet. The token
   * program is the original deployed build, which does not name its instruction,
   * so these logs are deliberately silent about the burn.
   */
  function simulation(
    overrides: Partial<{ ok: boolean; logs: string[]; accounts: Array<ReturnType<typeof tokenAccount> | null> | null }> = {},
  ) {
    return {
      ok: true,
      err: null,
      unitsConsumed: 27_689,
      programError: null,
      logs: [
        "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb invoke [1]",
        "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb success",
        "Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr invoke [1]",
        `Program log: Signed by ${AUTHORITY.toBase58()}`,
        `Program log: Memo (len 35): ${JSON.stringify(DESTINATION)}`,
        "Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr success",
      ],
      accounts: [tokenAccount(0n)],
      ...overrides,
    };
  }

  const base = { authority: AUTHORITY.toBase58(), destination: DESTINATION, remainingAfterBurn: 0n };

  it("passes a burn that empties the account and names the destination", () => {
    expect(checkStampRule({ simulation: simulation(), ...base })).toEqual({
      memoPresent: true,
      memoSignedByAuthority: true,
      burnExecuted: true,
    });
  });

  it("proves the burn from the balance, not from a log naming the instruction", () => {
    // The account still holds the tokens: the burn did not happen, whatever the
    // logs suggest. This is the case a log-only check would wave through.
    const untouched = checkStampRule({
      simulation: simulation({ accounts: [tokenAccount(1_500_000_000_000n)] }),
      ...base,
    });
    expect(untouched.burnExecuted).toBe(false);
    expect(untouched.memoPresent).toBe(true);
  });

  it("accepts a partial burn by the balance it is supposed to leave", () => {
    expect(
      checkStampRule({
        simulation: simulation({ accounts: [tokenAccount(500_000_000_000n)] }),
        ...base,
        remainingAfterBurn: 500_000_000_000n,
      }).burnExecuted,
    ).toBe(true);
  });

  it("is unproven rather than proven when the RPC returns no account", () => {
    expect(checkStampRule({ simulation: simulation({ accounts: null }), ...base }).burnExecuted).toBe(
      false,
    );
  });

  it("fails the memo checks that make a stamp unclaimable", () => {
    const wrongAddress = checkStampRule({
      simulation: simulation(),
      ...base,
      destination: "t1XbUAqZbCXBvbNEBuYyeFR1TSAxRKkKvWx",
    });
    expect(wrongAddress.memoPresent).toBe(false);
    const wrongSigner = checkStampRule({
      simulation: simulation(),
      ...base,
      authority: MINT.toBase58(),
    });
    expect(wrongSigner.memoSignedByAuthority).toBe(false);
  });

  it("proves nothing from a simulation that failed", () => {
    expect(checkStampRule({ simulation: simulation({ ok: false }), ...base }).burnExecuted).toBe(
      false,
    );
  });
});

describe("memo instruction", () => {
  it("names every signer it is given", () => {
    const memo = memoInstruction("hello", [AUTHORITY, MINT]);
    expect(memo.keys.every((key) => key.isSigner && !key.isWritable)).toBe(true);
    expect(memo.keys).toHaveLength(2);
  });

  it("can carry no signer at all, which the rule then refuses", () => {
    expect(memoInstruction("hello", []).keys).toEqual([]);
  });
});

describe("anchor error codes in simulation logs", () => {
  it("reads a hex custom program error and names the ones that matter", () => {
    expect(
      anchorErrorFrom([
        "Program LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj invoke [1]",
        "Program LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj failed: custom program error: 0x1789",
      ]),
    ).toEqual({ code: 6025, name: "CurveParamNotMatchPlatformRule" });
    // 6018 is what a missing curve-rule account produces.
    expect(anchorErrorFrom(["custom program error: 0x1782"])).toEqual({
      code: 6018,
      name: "NotEnoughRemainingAccounts",
    });
    // The deprecated initialize always produces this one.
    expect(anchorErrorFrom(["custom program error: 0x1770"])).toEqual({
      code: 6000,
      name: "NotApproved",
    });
  });

  it("reports an unmapped code rather than inventing a name", () => {
    expect(anchorErrorFrom(["custom program error: 0x2710"])).toEqual({ code: 10000, name: null });
  });

  it("is null when the logs name no error", () => {
    expect(anchorErrorFrom(["Program log: Instruction: BurnChecked"])).toBeNull();
  });
});
