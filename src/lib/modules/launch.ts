/**
 * Launch integration. The only module that knows Stonk exists.
 *
 * Two integrations sit behind one interface. The demo one launches on an
 * in-process ledger and can report a signature because it made one up. The live
 * one builds a real Raydium LaunchLab launch against mainnet and cannot report a
 * signature, because it has no key and is not allowed one: the creator's wallet
 * signs, in the creator's own browser. So the live path offers `prepare`, which
 * returns an unsigned transaction and the mainnet simulation that proves it,
 * and refuses `create`.
 *
 * Verified against https://www.stonkfun.xyz/developers and the program's own
 * IDL account on mainnet; see docs/INTEGRATION.md.
 */
import { flags, liveMoneyMovementBlocked } from "../mode";
import { getPairs, getPricing, getStats, getToken, stonkTokenUrl } from "../stonk/client";
import { assertLiveLaunchAllowed } from "../solana/live";
import { prepareLiveLaunch, type PreparedLaunch } from "../solana/live-launch";
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

/** What a live launch needs. The creator's wallet supplies the signature. */
export interface PrepareLaunchParams {
  creator: string;
  name: string;
  symbol: string;
  /** Metadata address with `{mint}` standing in for the mint being created. */
  metadataUriTemplate: string;
  quoteMint: string;
  /** Quote units spent on the initial buy, which becomes the burnable allocation. */
  quoteAmountIn: bigint;
}

export interface LaunchIntegration {
  readonly kind: "demo" | "live";
  pairs(): Promise<Awaited<ReturnType<typeof getPairs>>>;
  pricing(quoteMint: string): Promise<Awaited<ReturnType<typeof getPricing>>>;
  stats(): Promise<Awaited<ReturnType<typeof getStats>>>;
  token(mint: string): Promise<Awaited<ReturnType<typeof getToken>>>;
  venueUrl(mint: string): string;
  create(params: LaunchParams): Promise<LaunchResult>;
  /** An unsigned mainnet launch, with the simulation that proves it. */
  prepare(params: PrepareLaunchParams): Promise<PreparedLaunch>;
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
  async prepare(): Promise<PreparedLaunch> {
    throw new Error(
      "The demo ledger has no Solana transaction to sign. Building a real launch needs STAMP_MODE=mainnet with STAMP_ALLOW_LIVE_LAUNCH=true.",
    );
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
  /**
   * A live launch cannot be created here, and that is deliberate rather than
   * unfinished. Creating it would mean signing as the creator, which would mean
   * holding the creator's key. `prepare` is the live path.
   */
  async create(): Promise<LaunchResult> {
    await this.gate();
    throw new Error(
      "A mainnet launch is signed by the creator's own wallet, so this server cannot create one. Prepare the transaction and approve it in Phantom.",
    );
  }

  async prepare(params: PrepareLaunchParams): Promise<PreparedLaunch> {
    await this.gate();
    return prepareLiveLaunch({
      creator: params.creator,
      name: params.name,
      symbol: params.symbol,
      metadataUriTemplate: params.metadataUriTemplate,
      quoteMint: params.quoteMint,
      quoteAmountIn: params.quoteAmountIn,
    });
  }

  private async gate(): Promise<void> {
    const blocked = liveMoneyMovementBlocked("launch");
    if (blocked) throw new Error(blocked);
    await assertLiveLaunchAllowed();
  }
}

export function launchIntegrationFor(chain: DemoChainState): LaunchIntegration {
  return flags().mode === "demo" ? new DemoLaunchIntegration(chain) : new LiveLaunchIntegration();
}
