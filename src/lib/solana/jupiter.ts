/**
 * Jupiter swap used to fund a ZEC-quoted LaunchLab buy from the wallet's SOL.
 *
 * The pool still pairs against bridged ZEC. This only buys that ZEC. The
 * destination t-address is a different chain and cannot pay this.
 */
import { NATIVE_MINT } from "../protocol/constants";
import { flags } from "../mode";
import { SolanaRpc, type SimulationResult } from "./rpc";

const JUPITER = "https://lite-api.jup.ag/swap/v1";
const SWAP_SLIPPAGE_BPS = 50;
const SOL_BUFFER_LAMPORTS = 25_000_000n;

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  swapMode: string;
  [key: string]: unknown;
}

export interface PreparedQuoteFunding {
  transactionBase64: string;
  awaitingSignatureFrom: string[];
  inputMint: string;
  outputMint: string;
  solIn: string;
  quoteOut: string;
  quoteDecimals: number;
  quoteSymbol: string;
  simulation: SimulationResult;
  note: string;
}

export function quoteShortfall(held: bigint, needed: bigint): bigint {
  return held >= needed ? 0n : needed - held;
}

export function jupiterQuoteUrl(input: {
  outputMint: string;
  amountOut: bigint;
  slippageBps?: number;
}): string {
  const query = new URLSearchParams({
    inputMint: NATIVE_MINT,
    outputMint: input.outputMint,
    amount: input.amountOut.toString(10),
    swapMode: "ExactOut",
    slippageBps: String(input.slippageBps ?? SWAP_SLIPPAGE_BPS),
  });
  return `${JUPITER}/quote?${query}`;
}

export async function prepareSolToQuoteSwap(input: {
  creator: string;
  quoteMint: string;
  quoteSymbol: string;
  quoteDecimals: number;
  amountOut: bigint;
}): Promise<PreparedQuoteFunding> {
  const f = flags();
  if (!f.solanaRpc) {
    throw new Error("SOLANA_RPC_URL is required to buy the quote asset with SOL.");
  }
  if (input.amountOut <= 0n) {
    throw new Error("Nothing to buy: the wallet already holds enough of the quote asset.");
  }

  const quote = await jupiterGet<JupiterQuote>(jupiterQuoteUrl({ outputMint: input.quoteMint, amountOut: input.amountOut }));
  if (quote.outputMint !== input.quoteMint || quote.inputMint !== NATIVE_MINT) {
    throw new Error("Jupiter returned a route that is not SOL → the launch quote mint.");
  }
  if (BigInt(quote.outAmount) < input.amountOut) {
    throw new Error(
      `Jupiter's route delivers ${quote.outAmount} of the quote and the launch needs ${input.amountOut}.`,
    );
  }

  const rpc = new SolanaRpc(f.solanaRpc);
  const wallet = await rpc.getAccountInfo(input.creator);
  const lamports = BigInt(wallet?.lamports ?? 0);
  const solIn = BigInt(quote.inAmount);
  const floor = solIn + SOL_BUFFER_LAMPORTS;
  if (lamports < floor) {
    throw new Error(
      `Buying ${input.quoteSymbol} with SOL needs about ${formatSol(floor)} and this wallet holds ${formatSol(lamports)}.`,
    );
  }

  const swapped = await jupiterPost<{ swapTransaction?: string; error?: string }>("/swap", {
    quoteResponse: quote,
    userPublicKey: input.creator,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
  });
  if (!swapped.swapTransaction) {
    throw new Error(swapped.error ?? "Jupiter did not return a swap transaction.");
  }

  const simulation = await rpc.simulateTransaction(swapped.swapTransaction, {
    addresses: [input.creator],
  });
  return {
    transactionBase64: swapped.swapTransaction,
    awaitingSignatureFrom: [input.creator],
    inputMint: NATIVE_MINT,
    outputMint: input.quoteMint,
    solIn: solIn.toString(10),
    quoteOut: quote.outAmount,
    quoteDecimals: input.quoteDecimals,
    quoteSymbol: input.quoteSymbol,
    simulation,
    note: `The pool is ${input.quoteSymbol}-paired. This first approval spends SOL in Phantom to buy the ${input.quoteSymbol} the curve needs. The Zcash address is only where the stamp is delivered.`,
  };
}

async function jupiterGet<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  return readJupiter<T>(response, url);
}

async function jupiterPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${JUPITER}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  return readJupiter<T>(response, path);
}

async function readJupiter<T>(response: Response, path: string): Promise<T> {
  const text = await response.text();
  let parsed: T & { error?: string; message?: string };
  try {
    parsed = JSON.parse(text) as T & { error?: string; message?: string };
  } catch {
    throw new Error(`Jupiter ${path} returned non-JSON (HTTP ${response.status}).`);
  }
  if (!response.ok || parsed.error) {
    throw new Error(parsed.error || parsed.message || `Jupiter ${path} failed (${response.status}).`);
  }
  return parsed;
}

function formatSol(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const frac = (lamports % 1_000_000_000n).toString(10).padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac} SOL` : `${whole} SOL`;
}
