/**
 * Launch integration. The only module that knows Stonk exists.
 *
 * Verified against https://www.stonkfun.xyz/developers on 2026-09-20; see
 * docs/INTEGRATION.md for the captured responses and the paid-launch blocker.
 */
import { flags, liveMoneyMovementBlocked } from "../mode";
import { getPairs, getPricing, getStats, getToken, stonkTokenUrl } from "../stonk/client";
import { assertLiveLaunchAllowed } from "../solana/live";
import { launchDemoMint, type DemoChainState } from "../solana/demo";

export interface LaunchParams {
  name: string;
  symbol: string;
  description: string;
  imageDataUrl: string | null;
  decimals: number;
  quoteMint: string;
  quoteSymbol: string;
  launchSupply: bigint;
  /** Base units sold through the venue curve; the remainder credits the creator. */
  poolBase: bigint;
  buyBase?: bigint;
  creator: string;
}

export interface LaunchResult {
  mint: string;
  signature: string;
  venueUrl: string;
  source: "demo-ledger" | "stonk";
}

export interface LaunchIntegration {
  readonly kind: "demo" | "live";
  pairs(): Promise<Awaited<ReturnType<typeof getPairs>>>;
  pricing(quoteMint: string): Promise<Awaited<ReturnType<typeof getPricing>>>;
  stats(): Promise<Awaited<ReturnType<typeof getStats>>>;
  token(mint: string): Promise<Awaited<ReturnType<typeof getToken>>>;
  venueUrl(mint: string): string;
  create(params: LaunchParams): Promise<LaunchResult>;
}

export class DemoLaunchIntegration implements LaunchIntegration {
  readonly kind = "demo" as const;
  constructor(private readonly chain: DemoChainState) {}

  pairs() {
    return getPairs();
  }
  pricing(quoteMint: string) {
    return getPricing(quoteMint);
  }
  stats() {
    return getStats();
  }
  token(mint: string) {
    return getToken(mint);
  }
  venueUrl(mint: string) {
    return stonkTokenUrl(mint);
  }
  async create(params: LaunchParams): Promise<LaunchResult> {
    const launched = launchDemoMint({
      chain: this.chain,
      creator: params.creator,
      name: params.name,
      symbol: params.symbol,
      description: params.description,
      imageDataUrl: params.imageDataUrl,
      quoteMint: params.quoteMint,
      quoteSymbol: params.quoteSymbol,
      supply: params.launchSupply,
      totalSellA: params.poolBase,
      decimals: params.decimals,
      buyBase: params.buyBase,
    });
    return {
      mint: launched.mint.address,
      signature: launched.tx.signature,
      venueUrl: this.venueUrl(launched.mint.address),
      source: "demo-ledger",
    };
  }
}

export class LiveLaunchIntegration implements LaunchIntegration {
  readonly kind = "live" as const;
  pairs() {
    return getPairs();
  }
  pricing(quoteMint: string) {
    return getPricing(quoteMint);
  }
  stats() {
    return getStats();
  }
  token(mint: string) {
    return getToken(mint);
  }
  venueUrl(mint: string) {
    return stonkTokenUrl(mint);
  }
  async create(): Promise<LaunchResult> {
    const blocked = liveMoneyMovementBlocked("launch");
    if (blocked) throw new Error(blocked);
    assertLiveLaunchAllowed();
    throw new Error(
      "Live LaunchLab transaction construction is not implemented: the Stonk paid-launch endpoint returned 503 and no signed-transaction schema was observed.",
    );
  }
}

export function launchIntegrationFor(chain: DemoChainState): LaunchIntegration {
  return flags().mode === "demo" ? new DemoLaunchIntegration(chain) : new LiveLaunchIntegration();
}
