/**
 * Live Solana reader.
 *
 * Turns a transaction the RPC returns into the burn facts the stamp rule needs.
 * The decoding is a pure function over the RPC's jsonParsed shape so it can be
 * tested against a captured mainnet response rather than a mock, and the client
 * around it does nothing but fetch.
 *
 * Reads only. This module holds no keys and signs nothing.
 */
import type { ObservedBurn } from "../inscriptions";

/** Classic SPL Token and Token-2022. The mainnet reference burn used Token-2022. */
export const TOKEN_PROGRAM_IDS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
] as const;

/** SPL Memo v1 and v3. The destination binding rides in one of these. */
export const MEMO_PROGRAM_IDS = [
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
] as const;

const TOKEN_PROGRAMS: ReadonlySet<string> = new Set(TOKEN_PROGRAM_IDS);
const MEMO_PROGRAMS: ReadonlySet<string> = new Set(MEMO_PROGRAM_IDS);

interface ParsedInstruction {
  programId?: string;
  parsed?: unknown;
}

/** Only the fields we read. The RPC returns a great deal more. */
export interface ParsedTransaction {
  slot: number;
  blockTime?: number | null;
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string; signer: boolean }>;
      instructions: ParsedInstruction[];
    };
  };
  meta: {
    err: unknown;
    innerInstructions?: Array<{ instructions: ParsedInstruction[] }> | null;
  } | null;
}

function allInstructions(tx: ParsedTransaction): ParsedInstruction[] {
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((entry) => entry.instructions);
  // Burns invoked by another program appear only here, so inner instructions
  // are part of the search rather than an optional extra.
  return [...tx.transaction.message.instructions, ...inner];
}

interface BurnInstruction {
  mint: string;
  amount: string;
  decimals: number | null;
  authority: string;
}

function readBurn(instruction: ParsedInstruction): BurnInstruction | null {
  if (!instruction.programId || !TOKEN_PROGRAMS.has(instruction.programId)) return null;
  const parsed = instruction.parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const { type, info } = parsed as { type?: string; info?: Record<string, unknown> };
  if (type !== "burn" && type !== "burnChecked") return null;
  if (!info) return null;

  const mint = typeof info.mint === "string" ? info.mint : null;
  // A multisig burn names the multisig account instead of a single authority.
  const authority =
    typeof info.authority === "string"
      ? info.authority
      : typeof info.multisigAuthority === "string"
        ? info.multisigAuthority
        : null;
  if (!mint || !authority) return null;

  if (type === "burnChecked") {
    const tokenAmount = info.tokenAmount as { amount?: unknown; decimals?: unknown } | undefined;
    if (!tokenAmount || typeof tokenAmount.amount !== "string") return null;
    return {
      mint,
      amount: tokenAmount.amount,
      decimals: typeof tokenAmount.decimals === "number" ? tokenAmount.decimals : null,
      authority,
    };
  }

  // Plain burn carries no decimals. Nothing in the stamp rule depends on them;
  // they are display metadata, so null is honest rather than guessed.
  if (typeof info.amount !== "string") return null;
  return { mint, amount: info.amount, decimals: null, authority };
}

function readMemo(instruction: ParsedInstruction): string | null {
  if (!instruction.programId || !MEMO_PROGRAMS.has(instruction.programId)) return null;
  return typeof instruction.parsed === "string" ? instruction.parsed : null;
}

/**
 * Reduces a transaction to one burn record per mint destroyed.
 *
 * Several burn instructions of the same mint in one transaction are summed,
 * because a stamp cites a transaction signature and nothing finer. Summing is
 * what stops a second stamp from claiming the same transaction's other half.
 *
 * `finalized` is supplied by the caller: a transaction fetched at finalized
 * commitment is finalized by construction, and this function cannot know the
 * commitment it was fetched at.
 */
export function decodeBurns(
  signature: string,
  tx: ParsedTransaction,
  finalized: boolean,
): ObservedBurn[] {
  const instructions = allInstructions(tx);

  // A transaction is signed as a whole, so every instruction in it, the memo
  // included, is authorized by each of its signers.
  const signers = tx.transaction.message.accountKeys
    .filter((key) => key.signer)
    .map((key) => key.pubkey);
  const memos = instructions
    .map(readMemo)
    .filter((text): text is string => text !== null)
    .map((text) => ({ text, signers }));

  const byMint = new Map<string, ObservedBurn>();
  for (const instruction of instructions) {
    const burn = readBurn(instruction);
    if (!burn) continue;
    const existing = byMint.get(burn.mint);
    if (existing) {
      existing.amountBase = (BigInt(existing.amountBase) + BigInt(burn.amount)).toString(10);
      continue;
    }
    byMint.set(burn.mint, {
      signature,
      slot: tx.slot,
      finalized,
      err: tx.meta?.err ?? null,
      mint: burn.mint,
      amountBase: burn.amount,
      decimals: burn.decimals,
      authority: burn.authority,
      memos,
    });
  }

  return [...byMint.values()].sort((a, b) => (a.mint < b.mint ? -1 : 1));
}

export interface AccountInfo {
  owner: string;
  lamports: number;
  data: [string, string];
  executable: boolean;
}

interface SimulationValue {
  err?: unknown;
  logs?: string[] | null;
  unitsConsumed?: number;
  accounts?: Array<AccountInfo | null> | null;
}

export interface SimulationResult {
  ok: boolean;
  err: unknown;
  logs: string[];
  unitsConsumed: number | null;
  accounts: Array<AccountInfo | null> | null;
  /** The custom program error the logs name, when they name one. */
  programError: { code: number; name: string | null } | null;
}

/**
 * Anchor programs report a failure as a custom error code in the log stream.
 * Pulling it out turns "custom program error: 0x1789" into something the caller
 * can act on, and the LaunchLab codes we care about are the ones that mean the
 * launch shape is wrong rather than the wallet is short of funds.
 */
export const LAUNCHLAB_ERROR_NAMES: Record<number, string> = {
  6000: "NotApproved",
  6002: "InvalidInput",
  6003: "InputNotMatchCurveConfig",
  6004: "ExceededSlippage",
  6014: "InvalidPlatformInfo",
  6018: "NotEnoughRemainingAccounts",
  6020: "CurveParamIsNotExist",
  6022: "InvalidPlatformAllowConfig",
  6024: "InvalidPlatformCurveRule",
  6025: "CurveParamNotMatchPlatformRule",
};

export function anchorErrorFrom(logs: string[]): { code: number; name: string | null } | null {
  for (const line of logs) {
    const match = /custom program error: (0x[0-9a-fA-F]+|\d+)/.exec(line);
    if (!match) continue;
    const code = match[1].startsWith("0x") ? parseInt(match[1], 16) : Number(match[1]);
    return { code, name: LAUNCHLAB_ERROR_NAMES[code] ?? null };
  }
  return null;
}

export class SolanaRpcError extends Error {
  constructor(
    message: string,
    readonly code = "solana_rpc_error",
  ) {
    super(message);
  }
}

/** Minimal JSON-RPC client. Read methods only. */
export class SolanaRpc {
  constructor(private readonly url: string) {
    if (!url) throw new SolanaRpcError("SOLANA_RPC_URL is not set.", "missing_endpoint");
  }

  private async call<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
    });
    const text = await response.text();
    let body: { result?: T; error?: { message?: string; code?: number } };
    try {
      body = JSON.parse(text) as { result?: T; error?: { message?: string; code?: number } };
    } catch {
      throw new SolanaRpcError(
        `${method} returned non-JSON (HTTP ${response.status}).`,
        "invalid_response",
      );
    }
    if (body.error) {
      throw new SolanaRpcError(body.error.message ?? `${method} failed`, "rpc_error");
    }
    return body.result as T;
  }

  async getSlot(): Promise<number> {
    return this.call<number>("getSlot", [{ commitment: "finalized" }]);
  }

  /** A blockhash a built transaction can be signed against. */
  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    const result = await this.call<{
      value: { blockhash: string; lastValidBlockHeight: number };
    }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
    return result.value;
  }

  async getAccountInfo(address: string): Promise<AccountInfo | null> {
    const result = await this.call<{ value: AccountInfo | null }>("getAccountInfo", [
      address,
      { encoding: "base64", commitment: "confirmed" },
    ]);
    return result.value;
  }

  /** Base units held, or null when the account does not exist. */
  async getTokenAccountBalance(address: string): Promise<string | null> {
    try {
      const result = await this.call<{ value: { amount: string } }>("getTokenAccountBalance", [
        address,
        { commitment: "confirmed" },
      ]);
      return result.value.amount;
    } catch {
      return null;
    }
  }

  async getMinimumBalanceForRentExemption(bytes: number): Promise<number> {
    return this.call<number>("getMinimumBalanceForRentExemption", [bytes]);
  }

  /**
   * Runs a transaction against the current mainnet state without sending it.
   *
   * This is how a launch or a burn is proved before anyone is asked to approve
   * it: the RPC resolves every account and executes every instruction, so a
   * wrong PDA, a wrong account order, or a mis-encoded argument fails here
   * rather than after the fee is paid. It costs nothing and moves nothing.
   *
   * Signatures are not verified, because a transaction that has not been
   * approved in a wallet yet does not have them. That is the whole point: the
   * encoding can be proved before the user is asked for anything.
   */
  async simulateTransaction(
    transactionBase64: string,
    options: { addresses?: string[] } = {},
  ): Promise<SimulationResult> {
    const config: Record<string, unknown> = {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      encoding: "base64",
    };
    if (options.addresses?.length) {
      config.accounts = { encoding: "base64", addresses: options.addresses };
    }
    const result = await this.call<{ value: SimulationValue }>("simulateTransaction", [
      transactionBase64,
      config,
    ]);
    const value = result.value;
    return {
      ok: value.err === null || value.err === undefined,
      err: value.err ?? null,
      logs: value.logs ?? [],
      unitsConsumed: value.unitsConsumed ?? null,
      accounts: value.accounts ?? null,
      /** Anchor error codes arrive in the logs rather than in err. */
      programError: anchorErrorFrom(value.logs ?? []),
    };
  }

  /** Null when the signature is unknown or not yet finalized. */
  async getTransaction(signature: string): Promise<ParsedTransaction | null> {
    return this.call<ParsedTransaction | null>("getTransaction", [
      signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" },
    ]);
  }

  /** Empty when the transaction is absent, unfinalized, or burned nothing. */
  async fetchBurns(signature: string): Promise<ObservedBurn[]> {
    const tx = await this.getTransaction(signature);
    if (!tx) return [];
    return decodeBurns(signature, tx, true);
  }
}
