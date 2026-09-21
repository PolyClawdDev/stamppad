/**
 * A real burn, built and proved but never sent from here.
 *
 * The amount defaults to the whole balance read off chain rather than a number
 * the caller supplies, because a stamp is cut from the creator's entire
 * allocation and the only authority on what that is, after a launch has landed
 * and the curve has moved, is the token account itself.
 *
 * Holds no key. Phantom adds the only signature, in the user's own browser.
 */
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { flags } from "../mode";
import { buildBurnWithMemo } from "./burn";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./launchlab";
import { SolanaRpc, type SimulationResult } from "./rpc";

/** burnChecked costs about 1.4k units and a 35-byte memo about 27k. */
const BURN_COMPUTE_UNITS = 60_000;

export interface PreparedBurn {
  mint: string;
  /** Unsigned. The burn authority signs this in Phantom. */
  transactionBase64: string;
  awaitingSignatureFrom: string[];
  tokenAccount: string;
  tokenProgram: string;
  /** Base units this burn destroys. The stamp must claim exactly this. */
  amountBase: string;
  decimals: number;
  /** The memo the transaction carries, which is the delivery address. */
  memo: string;
  destination: string;
  costs: { signatureFeeLamports: string; note: string };
  simulation: SimulationResult;
  /** The stamp rule, checked against the simulation before anything burns. */
  stampRule: {
    memoPresent: boolean;
    memoSignedByAuthority: boolean;
    burnExecuted: boolean;
  };
}

export class LiveBurnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveBurnError";
  }
}

export interface PrepareBurnInput {
  mint: string;
  /** Holds the tokens and signs. */
  authority: string;
  /** Zcash mainnet transparent address the stamp is delivered to. */
  destination: string;
  /** Base units, or omitted to burn the whole balance. */
  amountBase?: bigint;
}

/**
 * Reads the mint's decimals and owning program off chain.
 *
 * burnChecked fails if the decimals disagree with the mint, and the burn has to
 * be addressed to the program that owns the mint: LaunchLab mints are
 * Token-2022, older ones are classic SPL. Both are read rather than assumed.
 */
async function readMint(
  rpc: SolanaRpc,
  mint: string,
): Promise<{ decimals: number; tokenProgram: string; supply: bigint }> {
  const account = await rpc.getAccountInfo(mint);
  if (!account) throw new LiveBurnError(`Mint ${mint} is not on Solana mainnet.`);
  if (account.owner !== TOKEN_PROGRAM_ID && account.owner !== TOKEN_2022_PROGRAM_ID) {
    throw new LiveBurnError(
      `${mint} is owned by ${account.owner}, which is neither SPL Token nor Token-2022. It is not a mint this can burn.`,
    );
  }
  const data = Buffer.from(account.data[0], "base64");
  if (data.length < 82) throw new LiveBurnError(`${mint} is too short to be a mint account.`);
  // Mint layout: mint_authority option (36), supply u64, decimals u8.
  return {
    supply: data.readBigUInt64LE(36),
    decimals: data.readUInt8(44),
    tokenProgram: account.owner,
  };
}

export async function prepareLiveBurn(input: PrepareBurnInput): Promise<PreparedBurn> {
  const f = flags();
  if (!f.solanaRpc) {
    throw new LiveBurnError("SOLANA_RPC_URL is required to build and simulate a live burn.");
  }
  const authority = new PublicKey(input.authority);
  const mint = new PublicKey(input.mint);
  const rpc = new SolanaRpc(f.solanaRpc);

  const mintInfo = await readMint(rpc, input.mint);
  const tokenProgram = new PublicKey(mintInfo.tokenProgram);

  // Build once to learn the token account, then read its balance, so "the whole
  // allocation" is the chain's answer rather than the caller's.
  const probe = buildBurnWithMemo({
    mint,
    authority,
    amountBase: 1n,
    decimals: mintInfo.decimals,
    destination: input.destination,
    tokenProgram,
  });
  const balance = await rpc.getTokenAccountBalance(probe.tokenAccount.toBase58());
  if (balance === null) {
    throw new LiveBurnError(
      `This wallet has no token account for ${input.mint}, so it holds nothing to burn. Pool inventory is not the creator's.`,
    );
  }
  const held = BigInt(balance);
  const amountBase = input.amountBase ?? held;
  if (amountBase <= 0n) {
    throw new LiveBurnError("This wallet's allocation is zero, so there is nothing to stamp.");
  }
  if (amountBase > held) {
    throw new LiveBurnError(
      `This wallet holds ${held} base units and the burn asks for ${amountBase}. Pool inventory cannot be burned.`,
    );
  }

  const burn = buildBurnWithMemo({
    mint,
    authority,
    amountBase,
    decimals: mintInfo.decimals,
    destination: input.destination,
    tokenProgram,
    tokenAccount: probe.tokenAccount,
  });

  const transaction = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: BURN_COMPUTE_UNITS }),
    ...burn.instructions,
  );
  const { blockhash } = await rpc.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = authority;

  const transactionBase64 = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  // Ask for the token account back so the burn can be proved from the balance
  // it leaves behind rather than inferred from the logs.
  const simulation = await rpc.simulateTransaction(transactionBase64, {
    addresses: [burn.tokenAccount.toBase58()],
  });

  return {
    mint: input.mint,
    transactionBase64,
    awaitingSignatureFrom: [authority.toBase58()],
    tokenAccount: burn.tokenAccount.toBase58(),
    tokenProgram: mintInfo.tokenProgram,
    amountBase: amountBase.toString(10),
    decimals: mintInfo.decimals,
    memo: burn.memo,
    destination: input.destination,
    costs: {
      signatureFeeLamports: "5000",
      note: "One signature. The burn creates no accounts, so there is no rent. It destroys the tokens permanently and cannot be undone.",
    },
    simulation,
    stampRule: checkStampRule({
      simulation,
      authority: authority.toBase58(),
      destination: input.destination,
      remainingAfterBurn: held - amountBase,
    }),
  };
}

/**
 * Checks the built burn against the rule the indexer will apply to it.
 *
 * src/lib/inscriptions.ts rejects a stamp whose burn carries no memo naming the
 * delivery address, signed by the same authority that signed the burn. That
 * rejection lands after the tokens are already destroyed, so it is worth
 * checking on the transaction we are about to ask someone to approve.
 *
 * The memo evidence is the simulated program log, because the memo program
 * reports exactly what the indexer will later read back off the chain: the memo
 * text, its length, and the keys that signed it.
 *
 * The burn evidence is the token account's balance after the simulation. The
 * logs cannot supply it: the original SPL Token program deployed on mainnet does
 * not name the instruction it ran, so a successful burnChecked against a classic
 * mint is indistinguishable in the log stream from any other token instruction.
 * The balance is not ambiguous.
 */
export function checkStampRule(input: {
  simulation: SimulationResult;
  authority: string;
  destination: string;
  /** Base units the token account should hold once the burn has run. */
  remainingAfterBurn: bigint;
}): { memoPresent: boolean; memoSignedByAuthority: boolean; burnExecuted: boolean } {
  const logs = input.simulation.logs;
  const expected = `Program log: Memo (len ${Buffer.from(input.destination, "utf8").length}): ${JSON.stringify(input.destination)}`;
  const after = simulatedTokenAmount(input.simulation);
  return {
    memoPresent: logs.includes(expected),
    memoSignedByAuthority: logs.includes(`Program log: Signed by ${input.authority}`),
    burnExecuted: input.simulation.ok && after !== null && after === input.remainingAfterBurn,
  };
}

/**
 * Reads the token balance out of the first account the simulation returned.
 *
 * Classic SPL and Token-2022 share the first 72 bytes of the account layout,
 * with the amount as a little-endian u64 at 64, so one reader covers both.
 * Token-2022 extensions live past that and do not shift it.
 */
function simulatedTokenAmount(simulation: SimulationResult): bigint | null {
  const account = simulation.accounts?.[0];
  if (!account) return null;
  const data = Buffer.from(account.data[0], "base64");
  if (data.length < 72) return null;
  return data.readBigUInt64LE(64);
}
