/**
 * The burn that a stamp cites.
 *
 * src/lib/inscriptions.ts applies the rule: a stamp counts only if the cited
 * transaction destroyed exactly the claimed amount of the claimed mint, and
 * carries a memo naming the delivery address signed by the same authority that
 * signed the burn. So the destination is not metadata we attach afterwards. It
 * has to ride in the burn transaction itself, or the stamp is rejected with
 * recipient_unauthorized and the burn is wasted.
 *
 * The shape here matches the burn we read off mainnet in
 * tests/fixtures/solana-burn-mainnet.json, signature RcxGYhJtLLmZAwhA1Ee...,
 * which our reader already decodes: a Token-2022 burnChecked followed by an
 * SPL Memo v3 instruction whose only account is the burn authority, so the
 * program logs "Signed by" and the parsed memo carries the address alone.
 *
 * Pure. No keys, no environment, no network.
 */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  createBurnCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { validateTransparentAddress } from "../protocol/taddr";

/** SPL Memo v3. The reference burn used this one; v1 is also read. */
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/**
 * A memo instruction whose signer is named.
 *
 * The memo program treats every signer account passed to it as having signed
 * the memo, and logs them. The stamp rule reads the transaction's signers, so
 * naming the authority here is strictly redundant for acceptance; it is what
 * the reference burn did, and it puts the attestation in the program log where
 * anyone reading the transaction can see it.
 */
export function memoInstruction(text: string, signers: PublicKey[]): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(MEMO_PROGRAM_ID),
    keys: signers.map((pubkey) => ({ pubkey, isSigner: true, isWritable: false })),
    data: Buffer.from(text, "utf8"),
  });
}

export interface BurnWithMemoInput {
  mint: PublicKey;
  /** Holds the tokens and signs both the burn and the memo. */
  authority: PublicKey;
  /** Base units to destroy. */
  amountBase: bigint;
  /** Must equal the mint's decimals; burnChecked rejects a mismatch. */
  decimals: number;
  /** Zcash transparent address the stamp is delivered to. */
  destination: string;
  /** The program that owns the mint. LaunchLab mints are Token-2022. */
  tokenProgram: PublicKey;
  /**
   * The account to burn from. Defaults to the authority's associated token
   * account, which is where a LaunchLab dev buy lands.
   */
  tokenAccount?: PublicKey;
}

export interface BurnWithMemo {
  /** burnChecked then memo, in this order, for one transaction. */
  instructions: TransactionInstruction[];
  tokenAccount: PublicKey;
  memo: string;
}

/**
 * Builds the burn and its destination memo as one inseparable pair.
 *
 * They are returned together rather than as two builders because splitting
 * them across transactions produces a burn no stamp can ever claim.
 */
export function buildBurnWithMemo(input: BurnWithMemoInput): BurnWithMemo {
  if (input.amountBase <= 0n) {
    throw new Error("A burn must destroy a positive amount.");
  }
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 9) {
    throw new Error("Decimals must be an integer between 0 and 9.");
  }
  const destination = input.destination.trim();
  if (destination !== input.destination) {
    // The rule compares memo.text.trim() to the address, but a memo that needs
    // trimming means the caller is guessing about the bytes it is committing.
    throw new Error("The destination must not carry surrounding whitespace.");
  }
  const check = validateTransparentAddress(destination);
  if (!check.ok) throw new Error(`Refusing to burn: ${check.message}`);
  if (check.network !== "zcash:main") {
    throw new Error("Refusing to burn: the destination is not a Zcash mainnet address.");
  }

  const tokenAccount =
    input.tokenAccount ??
    getAssociatedTokenAddressSync(input.mint, input.authority, false, input.tokenProgram);

  return {
    instructions: [
      createBurnCheckedInstruction(
        tokenAccount,
        input.mint,
        input.authority,
        input.amountBase,
        input.decimals,
        [],
        input.tokenProgram,
      ),
      memoInstruction(destination, [input.authority]),
    ],
    tokenAccount,
    memo: destination,
  };
}
