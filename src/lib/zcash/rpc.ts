/**
 * Zcash JSON-RPC client.
 *
 * Provider-agnostic: it speaks the subset of the node RPC that both zcashd and
 * zebrad implement, so the same URL slot works for a self-hosted node or for a
 * hosted gateway such as NOWNodes, GetBlock or Tatum's zebrad endpoint. No node
 * needs running locally.
 *
 * Deliberately narrow. Zebrad omits zcashd's wallet and shielded RPCs on
 * purpose, and StampPad has no business calling them anyway: the publisher's
 * key never reaches the node, so `signrawtransaction`, `sendtoaddress` and the
 * z_* family are not merely unavailable, they are the wrong shape. Everything
 * this client does is read the chain and hand it finished bytes.
 *
 * The decoding is split from the fetching so it can be tested against captured
 * mainnet responses rather than a mock, in the same style as
 * src/lib/solana/rpc.ts.
 */
import type { PublisherUtxo } from "./inscribe";
import {
  upgradeNameForBranchId,
  upgradeForHeight,
  type ZcashNetwork,
} from "./consensus";

export class ZcashRpcError extends Error {
  constructor(
    message: string,
    readonly code = "zcash_rpc_error",
  ) {
    super(message);
  }
}

/* ---------- response shapes, only the fields read ---------- */

export interface RawBlockchainInfo {
  chain: string;
  blocks: number;
  bestblockhash: string;
  consensus?: { chaintip?: string; nextblock?: string };
}

export interface ChainTip {
  network: ZcashNetwork;
  height: number;
  bestBlockHash: string;
  /**
   * The branch ID the node says the next block is bound to. Compared against
   * our own table rather than trusted blindly, and vice versa: a disagreement
   * means one of the two is stale, and signing against a stale branch ID
   * produces a transaction nobody will relay.
   */
  branchId: number;
  branchName: string | null;
}

export interface RawTransactionInfo {
  hex: string;
  txid: string;
  height?: number;
  confirmations?: number;
  blockhash?: string;
}

export interface RawAddressUtxo {
  address: string;
  txid: string;
  outputIndex?: number;
  /** zcashd calls it `outputIndex`; some gateways echo Bitcoin's `vout`. */
  vout?: number;
  script: string;
  satoshis: number;
  height: number;
}

/* ---------- pure decoders ---------- */

/** zcashd and zebrad both report "main"/"test"; some gateways say "mainnet". */
export function networkFromChain(chain: string): ZcashNetwork {
  const value = chain.toLowerCase();
  if (value === "main" || value === "mainnet") return "zcash:main";
  if (value === "test" || value === "testnet") return "zcash:test";
  throw new ZcashRpcError(`unexpected chain "${chain}"; StampPad only builds for main and test`, "wrong_network");
}

/**
 * Reads the tip and the branch ID the next block will carry.
 *
 * When the node reports a branch ID, it wins over our table but must still be a
 * branch we have a name for: an unrecognised one means this build predates a
 * network upgrade, and its digests would be personalized wrongly. Better to
 * refuse than to sign into the void.
 */
export function decodeChainTip(info: RawBlockchainInfo): ChainTip {
  const network = networkFromChain(info.chain);
  if (!Number.isInteger(info.blocks) || info.blocks < 0) {
    throw new ZcashRpcError("getblockchaininfo returned no usable block height", "invalid_response");
  }
  const reported = info.consensus?.nextblock ?? info.consensus?.chaintip;
  let branchId: number;
  if (reported) {
    // Reported big-endian as an 8-character hex string, the way the header
    // field is written, not in the little-endian order it serializes in.
    branchId = Number.parseInt(reported, 16);
    if (!Number.isInteger(branchId)) {
      throw new ZcashRpcError(`could not read consensus branch id "${reported}"`, "invalid_response");
    }
  } else {
    branchId = upgradeForHeight(info.blocks + 1, network).branchId;
  }
  const branchName = upgradeNameForBranchId(branchId, network);
  if (!branchName) {
    throw new ZcashRpcError(
      `node reports consensus branch id ${branchId.toString(16)}, which this build does not know. ` +
        "A network upgrade has activated since it was built; update src/lib/zcash/consensus.ts before publishing.",
      "unknown_branch_id",
    );
  }
  return {
    network,
    height: info.blocks,
    bestBlockHash: info.bestblockhash,
    branchId,
    branchName,
  };
}

/** Coins at the publisher address, in the shape the transaction builder wants. */
export function decodeUtxos(raw: readonly RawAddressUtxo[]): PublisherUtxo[] {
  return raw.map((entry) => {
    const index = entry.outputIndex ?? entry.vout;
    if (index === undefined || !Number.isInteger(index)) {
      throw new ZcashRpcError(`utxo ${entry.txid} came back with no output index`, "invalid_response");
    }
    if (!Number.isInteger(entry.satoshis) || entry.satoshis < 0) {
      throw new ZcashRpcError(`utxo ${entry.txid}:${index} has no usable value`, "invalid_response");
    }
    return {
      txid: entry.txid,
      index,
      valueZat: BigInt(entry.satoshis),
      scriptPubKeyHex: entry.script,
    };
  });
}

export function totalValue(utxos: readonly PublisherUtxo[]): bigint {
  return utxos.reduce((sum, utxo) => sum + utxo.valueZat, 0n);
}

/* ---------- client ---------- */

export interface ZcashRpcOptions {
  /**
   * Hosted gateways differ in how they authenticate. NOWNodes wants an
   * api-key header, GetBlock and Tatum put the key in the path, and a
   * self-hosted node wants HTTP basic auth. All three are just headers here.
   */
  headers?: Record<string, string>;
  /** Basic auth for a self-hosted zcashd or zebrad. */
  auth?: { user: string; password: string };
  fetchImpl?: typeof fetch;
}

/** Tatum and similar gateways want the key in a header, not in the URL. */
export function zcashRpcFromEnv(): ZcashRpc {
  const url = process.env.ZCASH_RPC_URL ?? "";
  const apiKey = process.env.ZCASH_RPC_API_KEY ?? process.env.TATUM_API_KEY ?? "";
  return new ZcashRpc(url, apiKey ? { headers: { "x-api-key": apiKey } } : {});
}

export class ZcashRpc {
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private id = 0;

  constructor(
    private readonly url: string,
    options: ZcashRpcOptions = {},
  ) {
    if (!url) throw new ZcashRpcError("ZCASH_RPC_URL is not set.", "missing_endpoint");
    this.headers = { "Content-Type": "application/json", ...options.headers };
    if (options.auth) {
      const encoded = Buffer.from(`${options.auth.user}:${options.auth.password}`).toString("base64");
      this.headers.Authorization = `Basic ${encoded}`;
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    this.id += 1;
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ jsonrpc: "1.0", id: this.id, method, params }),
      cache: "no-store",
    });
    const text = await response.text();
    let body: { result?: T; error?: { message?: string; code?: number } | null };
    try {
      body = JSON.parse(text) as { result?: T; error?: { message?: string; code?: number } | null };
    } catch {
      throw new ZcashRpcError(
        `${method} returned non-JSON (HTTP ${response.status}).`,
        response.status === 401 || response.status === 403 ? "unauthorized" : "invalid_response",
      );
    }
    if (body.error) {
      throw new ZcashRpcError(
        body.error.message ?? `${method} failed`,
        // -32601 is JSON-RPC's "method not found". On zebrad that usually means
        // a wallet or shielded RPC, which it does not implement by design.
        body.error.code === -32601 ? "method_unavailable" : "rpc_error",
      );
    }
    if (body.result === undefined || body.result === null) {
      throw new ZcashRpcError(`${method} returned no result`, "invalid_response");
    }
    return body.result;
  }

  async getChainTip(): Promise<ChainTip> {
    return decodeChainTip(await this.call<RawBlockchainInfo>("getblockchaininfo"));
  }

  async getBlockCount(): Promise<number> {
    return this.call<number>("getblockcount");
  }

  /** Verbosity 1 gives the header and the txid list, which is all the indexer needs. */
  async getBlock(hashOrHeight: string | number, verbosity = 1): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>("getblock", [String(hashOrHeight), verbosity]);
  }

  async getRawTransactionHex(txid: string): Promise<string> {
    return this.call<string>("getrawtransaction", [txid, 0]);
  }

  async getTransaction(txid: string): Promise<RawTransactionInfo> {
    return this.call<RawTransactionInfo>("getrawtransaction", [txid, 1]);
  }

  /**
   * Coins at the publisher address. zebrad implements getaddressutxos, so this
   * works without a wallet; what it cannot tell us is whether another process
   * is already spending one, which is why the publisher address should have a
   * single writer.
   */
  async getUtxos(addresses: readonly string[]): Promise<PublisherUtxo[]> {
    const raw = await this.call<RawAddressUtxo[]>("getaddressutxos", [{ addresses: [...addresses] }]);
    return decodeUtxos(raw);
  }

  /**
   * Broadcasts a finished transaction. The only method here that changes
   * anything, and the only one the live publisher gates behind
   * STAMP_ALLOW_LIVE_ZCASH_PUBLISH.
   */
  async sendRawTransaction(hex: string): Promise<string> {
    return this.call<string>("sendrawtransaction", [hex]);
  }
}
