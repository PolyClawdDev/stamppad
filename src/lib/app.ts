import { artworkProblem } from "./artwork";
import { flags, liveMoneyMovementBlocked, stampMode } from "./mode";
import {
  DESTINATION_NOTICE_ZATOSHIS,
  TOKEN_PROGRAM_ID,
  validateDestination,
} from "./protocol";
import { eligibleBalance, launchDemoMint } from "./solana/demo";
import { assertLiveBurnsAllowed } from "./solana/live";
import { prepareLiveBurn } from "./solana/live-burn";
import { launchIntegrationFor } from "./modules/launch";
import { getPairs, getPricing, getStats, getToken, stonkTokenUrl } from "./stonk/client";
import { getStore, type JobRow, type LaunchRow, type StampRow } from "./store";
import { durability, durabilityProblem } from "./store/durability";
import { publicationFeeQuote, submitDemoBurn } from "./jobs/processor";

export async function statusPayload() {
  const f = flags();
  const stats = await getStats();
  return {
    product: "StampPad",
    positioning: "Small stamps. Big ideas.",
    explanation: "Burn Solana tokens to create verifiable Zcash inscriptions.",
    mode: f.mode,
    networks: { source: f.sourceNetwork, destination: f.destNetwork },
    store: f.store,
    statePersistence: durability(),
    stateProblem: durabilityProblem(),
    acceptingLaunches: durabilityProblem() === null,
    flags: {
      stonkReadLive: f.stonkReadLive,
      allowLiveLaunch: f.allowLiveLaunch,
      allowLiveBurns: f.allowLiveBurns,
      allowLiveZcashPublish: f.allowLiveZcashPublish,
    },
    stonk: {
      source: stats.source,
      retrievedAt: stats.retrievedAt,
      paidLaunchesEnabled: stats.stats.config.paidLaunchesEnabled,
      launchLabEnabled: stats.stats.config.launchLabEnabled,
      devBuysEnabled: stats.stats.config.devBuysEnabled,
    },
    protocol: { id: "stamp-exp", version: 0 },
    transfers: "unavailable",
    zsa: "conditional — ZIP 226/227 are draft; no automatic conversion",
    affiliation: "Not affiliated with Stonk, Raydium, Solana, or Zcash developers.",
  };
}

export async function quoteLaunch(quoteMint: string) {
  const { pairs, source: pairSource } = await getPairs();
  const pair = pairs.find((p) => p.mint === quoteMint);
  if (!pair) {
    throw new Error("Quote mint is not in the launchable + LaunchLab-ready pair list.");
  }
  if (!pair.launchable || pair.launchLabReady === false) {
    throw new Error("That quote asset is not currently launchable on the LaunchLab path.");
  }
  const { pricing, source } = await getPricing(quoteMint);
  const stats = await getStats();
  return {
    pair,
    pricing,
    source,
    pairSource,
    stats: stats.stats.config,
    parameters: {
      decimals: pricing.curve.baseDecimals,
      supplyDisplay: pricing.curve.totalSupplyTokens,
      supplyBase: pricing.curve.supply,
      poolBase: pricing.curve.totalSellA,
      note: "Supply and decimals are fixed by the LaunchLab path Stonk publishes. They are not user settings.",
    },
    live: liveLaunchStatus(),
    costs: {
      launchVenue:
        "None. StampPad builds the LaunchLab launch itself and attaches Stonk's platform id, which is the path Stonk charges no fee on.",
      // The pair list is the authority on the quote's symbol. The fixture
      // pricing response carries whichever pair was captured, so reading the
      // symbol off it would name the wrong asset.
      initialPurchase:
        pair.symbol === "SOL"
          ? "Paid in SOL from the connected wallet. That buy is what becomes the burnable allocation."
          : `Paid in ${pair.symbol}. That buy is what becomes the burnable allocation.`,
      stampFee: "0",
      network: liveLaunchStatus().launchEnabled
        ? "Solana rent and signature fees, paid by the creator's wallet. The exact amount is measured by simulating the launch before you approve it."
        : "Nothing. This deployment's ledger charges no SOL because it is not on Solana.",
      publication: publicationFeeQuote(),
    },
  };
}

/**
 * What this deployment will actually do when someone launches.
 *
 * The UI has to be able to say which of the two it is without guessing, and the
 * reason a path is closed has to be the current reason rather than a stale one.
 */
export function liveLaunchStatus() {
  const f = flags();
  return {
    mode: f.mode,
    launchEnabled: f.mode !== "demo" && f.allowLiveLaunch,
    burnEnabled: f.mode !== "demo" && f.allowLiveBurns,
    zcashPublishEnabled: f.mode !== "demo" && f.allowLiveZcashPublish,
    launchBlockedReason: liveMoneyMovementBlocked("launch"),
    burnBlockedReason: liveMoneyMovementBlocked("burn"),
    publishBlockedReason: liveMoneyMovementBlocked("publish"),
    stonkReadLive: f.stonkReadLive,
    hasRpc: Boolean(f.solanaRpc),
  };
}

export async function createDemoLaunch(input: {
  owner: string;
  name: string;
  symbol: string;
  description: string;
  imageDataUrl: string | null;
  quoteMint: string;
  buyDisplay?: string;
  convertDisplay?: string;
}) {
  const blocked = liveMoneyMovementBlocked("launch");
  if (stampMode() !== "demo") {
    throw new Error(blocked ?? "Live launch is not enabled in this build.");
  }
  const undurable = durabilityProblem();
  if (undurable) throw new Error(`Refusing to record a launch that will not survive. ${undurable}`);
  const artwork = artworkProblem(input.imageDataUrl);
  if (artwork) throw new Error(artwork);
  const quote = await quoteLaunch(input.quoteMint);
  const store = getStore();
  const { solana, zcash } = await store.loadDemo();
  const buyBase = parseDisplay(input.buyDisplay, quote.parameters.decimals);
  const launched = launchDemoMint({
    chain: solana,
    creator: input.owner,
    name: input.name.trim(),
    symbol: input.symbol.trim().toUpperCase(),
    description: input.description.trim(),
    imageDataUrl: input.imageDataUrl,
    quoteMint: input.quoteMint,
    quoteSymbol: quote.pair.symbol,
    supply: BigInt(quote.parameters.supplyBase),
    totalSellA: BigInt(quote.parameters.poolBase),
    decimals: quote.parameters.decimals,
    buyBase,
  });
  await store.saveDemo(solana, zcash);
  const row: LaunchRow = {
    mint: launched.mint.address,
    name: launched.mint.name,
    symbol: launched.mint.symbol,
    description: launched.mint.description,
    imageDataUrl: launched.mint.imageDataUrl,
    quoteMint: launched.mint.quoteMint,
    quoteSymbol: launched.mint.quoteSymbol,
    tokenProgram: launched.mint.programId,
    decimals: launched.mint.decimals,
    launchSupply: launched.mint.launchSupply,
    poolBase: launched.mint.poolBase,
    currentSupply: launched.mint.supply.toString(10),
    creator: input.owner,
    launchTx: launched.tx.signature,
    stonkUrl: stonkTokenUrl(launched.mint.address),
    source: `launched on this deployment, mirroring ${quote.source}`,
    createdAt: launched.mint.createdAt,
  };
  await store.upsertLaunch(row);

  let convertJob: JobRow | null = null;
  const convertBase = parseDisplay(input.convertDisplay, quote.parameters.decimals);
  if (convertBase > 0n) {
    if (launched.creatorBalance < convertBase) {
      throw new Error(
        "Cannot convert after launch: the creator only holds the optional initial purchase. Pool inventory is not yours.",
      );
    }
    throw new Error(
      "Post-launch convert still needs a Zcash destination. Use Convert on the launch page after launch.",
    );
  }

  return {
    launch: row,
    creatorBalanceBase: launched.creatorBalance.toString(10),
    poolNote:
      "The bonding-curve / pool allocation is not in the creator wallet. Only the optional initial purchase is burnable by the creator.",
    convertJob,
  };
}

/**
 * Builds a real mainnet launch for the creator's wallet to approve.
 *
 * Returns rather than sends. Nothing has happened on Solana when this resolves:
 * the transaction is unsigned by the creator, and the simulation it carries is
 * the proof that it will do what it says when they sign it.
 *
 * The collection identity is recorded here even so. The metadata URI is written
 * onto the mint at creation and can never be corrected, and it resolves against
 * this record, so the name, ticker, description and artwork have to exist on the
 * server before the creator approves anything. Keeping them in the browser until
 * the launch lands would mean a closed tab left a real mint permanently nameless.
 */
export async function prepareMainnetLaunch(input: {
  owner: string;
  name: string;
  symbol: string;
  description: string;
  imageDataUrl: string | null;
  quoteMint: string;
  /** Quote asset to spend on the initial buy, as the user typed it. */
  quoteAmountDisplay: string;
}) {
  const undurable = durabilityProblem();
  if (undurable) throw new Error(`Refusing to build a launch this deployment cannot record. ${undurable}`);
  const artwork = artworkProblem(input.imageDataUrl);
  if (artwork) throw new Error(artwork);
  const quote = await quoteLaunch(input.quoteMint);
  const quoteAmountIn = parseDisplay(input.quoteAmountDisplay, quote.pricing.quote.decimals);
  if (quoteAmountIn <= 0n) {
    throw new Error(`The initial buy must be more than zero ${quote.pricing.quote.symbol}.`);
  }
  const integration = launchIntegrationFor((await getStore().loadDemo()).solana);
  const prepared = await integration.prepare({
    creator: input.owner,
    name: input.name.trim(),
    symbol: input.symbol.trim().toUpperCase(),
    metadataUriTemplate: launchMetadataUriTemplate(),
    quoteMint: input.quoteMint,
    quoteAmountIn,
  });
  await getStore().upsertLaunch({
    mint: prepared.mint,
    name: input.name.trim(),
    symbol: input.symbol.trim().toUpperCase(),
    description: input.description.trim(),
    imageDataUrl: input.imageDataUrl,
    quoteMint: input.quoteMint,
    quoteSymbol: quote.pair.symbol,
    tokenProgram: prepared.allocation.tokenProgram,
    decimals: prepared.allocation.decimals,
    launchSupply: prepared.curve.supply,
    poolBase: prepared.curve.totalSellA,
    currentSupply: "0",
    creator: input.owner,
    // Empty until the creator's signature lands the launch on Solana. Nothing
    // treats this collection as a mint that exists while it is blank.
    launchTx: "",
    stonkUrl: stonkTokenUrl(prepared.mint),
    source: "prepared on this deployment for the creator's approval; not signed or sent to Solana",
    createdAt: new Date().toISOString(),
  });
  return {
    launch: prepared,
    burnPlan: {
      note: "The whole allocation is burned to cut the stamp. The amount is read off chain after the launch lands, because the curve decides it.",
      expectedBase: prepared.allocation.expectedBase,
      decimals: prepared.allocation.decimals,
    },
    zcash: {
      publishEnabled: liveLaunchStatus().zcashPublishEnabled,
      note:
        liveLaunchStatus().publishBlockedReason ??
        "Zcash publication is enabled on this deployment.",
    },
  };
}

/**
 * Builds a real mainnet burn of the connected wallet's whole allocation, with
 * the destination memo the stamp rule requires, for that wallet to approve.
 */
export async function prepareMainnetBurn(input: {
  mint: string;
  owner: string;
  destination: string;
  amountDisplay?: string;
}) {
  const blocked = liveMoneyMovementBlocked("burn");
  if (blocked) throw new Error(blocked);
  await assertLiveBurnsAllowed();
  const dest = validateDestination(flags().destNetwork, input.destination);
  if (!dest.ok) throw new Error(dest.message);
  const prepared = await prepareLiveBurn({
    mint: input.mint,
    authority: input.owner,
    destination: input.destination,
    amountBase: input.amountDisplay ? parseDisplay(input.amountDisplay, 6) : undefined,
  });
  return {
    burn: prepared,
    irreversible:
      "This destroys the tokens permanently. A stamp is not redeemable for anything held in reserve, and a burn whose stamp is never published is simply gone.",
    zcash: {
      publishEnabled: liveLaunchStatus().zcashPublishEnabled,
      note: liveLaunchStatus().publishBlockedReason ?? "Zcash publication is enabled.",
    },
  };
}

/**
 * Where the token's metadata JSON will live.
 *
 * Token-2022 writes the URI onto the mint at creation and this app has no
 * authority to change it afterwards, so it has to be an address that will still
 * resolve long after the launch. That rules out deriving it from the request's
 * own host, which is why it comes from configuration and is required to be
 * https before a mainnet launch will build at all.
 */
export function launchMetadataUriTemplate(): string {
  const configured = process.env.STAMP_METADATA_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const hosted = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "";
  const base = (configured || hosted).replace(/\/$/, "");
  if (!/^https:\/\//.test(base)) {
    throw new Error(
      "A mainnet launch needs STAMP_METADATA_BASE_URL (or NEXT_PUBLIC_APP_URL) set to an https origin: the metadata URI is written onto the mint permanently and cannot be corrected later.",
    );
  }
  return `${base}/api/launches/{mint}/metadata`;
}

export async function inspectMint(mint: string, owner?: string) {
  const store = getStore();
  const launch = await store.getLaunch(mint);
  const { solana } = await store.loadDemo();
  const demoMint = solana.mints[mint];
  // A launch recorded without a signature is an identity waiting for a mint, not
  // a mint. Inspecting it would report a supply and a balance that do not exist.
  if (!launch?.launchTx && !demoMint) {
    const live = await getToken(mint);
    if (!live.token) {
      return {
        supported: false,
        reason: live.error ?? "Mint is not on this deployment's ledger and live Stonk/Solana data was not available.",
      };
    }
    return {
      supported: false,
      reason:
        "Live mint inspection is read-only. Burning a mainnet mint is disabled. Supply a mint that was launched on this deployment.",
      token: live.token,
      source: live.source,
    };
  }
  const decimals = demoMint?.decimals ?? launch?.decimals ?? 6;
  const program = demoMint?.programId ?? launch?.tokenProgram ?? TOKEN_PROGRAM_ID;
  if (demoMint?.extensions?.length) {
    return { supported: false, reason: `Unsupported mint extensions: ${demoMint.extensions.join(", ")}` };
  }
  const eligible = owner && demoMint ? eligibleBalance(solana, owner, mint) : 0n;
  return {
    supported: true,
    mint,
    name: demoMint?.name ?? launch?.name,
    symbol: demoMint?.symbol ?? launch?.symbol,
    decimals,
    tokenProgram: program,
    extensions: demoMint?.extensions ?? [],
    supplyBase: (demoMint?.supply ?? BigInt(launch?.currentSupply ?? "0")).toString(10),
    launchSupplyBase: launch?.launchSupply ?? demoMint?.launchSupply,
    eligibleBase: eligible.toString(10),
    owner,
  };
}

export async function previewConvert(input: {
  mint: string;
  owner: string;
  amountDisplay: string;
  destination: string;
}) {
  const inspected = await inspectMint(input.mint, input.owner);
  if (!inspected.supported || !("decimals" in inspected)) {
    throw new Error("reason" in inspected ? inspected.reason : "Mint is not supported.");
  }
  const dest = validateDestination(flags().destNetwork, input.destination);
  if (!dest.ok) throw new Error(dest.message);
  const decimals = Number(inspected.decimals);
  const amountBase = parseDisplay(input.amountDisplay, decimals);
  if (amountBase <= 0n) throw new Error("Amount must be greater than zero.");
  if (amountBase > BigInt(inspected.eligibleBase ?? "0")) {
    throw new Error("Amount exceeds the connected wallet's eligible balance. Pool inventory cannot be burned.");
  }
  const fees = publicationFeeQuote();
  return {
    mint: input.mint,
    decimals,
    amountBase: amountBase.toString(10),
    amountDisplay: formatDisplay(amountBase, decimals),
    destination: input.destination,
    destinationCheck: dest.message,
    irreversible:
      "A burn permanently reduces the Solana mint supply. A stamp is not redeemable for tokens held in reserve. This cannot be undone.",
    fees,
    destinationNoticeZat: DESTINATION_NOTICE_ZATOSHIS.toString(10),
  };
}

export async function convert(input: {
  mint: string;
  owner: string;
  amountDisplay: string;
  destination: string;
  fail?: boolean;
  sourceTx?: string;
  amountBase?: string;
  decimals?: number;
}) {
  if (stampMode() !== "demo") {
    const blocked = liveMoneyMovementBlocked("burn");
    if (blocked) throw new Error(blocked);
    if (!input.sourceTx) {
      throw new Error("A mainnet stamp needs the Solana burn signature after Phantom sends it.");
    }
    const { submitLiveBurn } = await import("./jobs/live");
    const decimals = input.decimals ?? 6;
    const amountBase = input.amountBase
      ? BigInt(input.amountBase)
      : parseDisplay(input.amountDisplay, decimals);
    return submitLiveBurn({
      owner: input.owner,
      mint: input.mint,
      amountBase,
      decimals,
      destination: input.destination,
      sourceTx: input.sourceTx,
    });
  }
  const preview = await previewConvert(input);
  return submitDemoBurn({
    owner: input.owner,
    mint: input.mint,
    amountBase: BigInt(preview.amountBase),
    destination: input.destination,
    fail: input.fail,
  });
}

export async function launchView(mint: string) {
  const store = getStore();
  const launch = await store.getLaunch(mint);
  if (!launch) return null;
  const stamps = await store.stampsForMint(mint);
  const jobs = (await store.listJobs()).filter((j) => j.mint === mint);
  const { solana } = await store.loadDemo();
  const mintState = solana.mints[mint];
  const accepted = stamps.reduce((s, r) => s + BigInt(r.amountBase), 0n);
  const pending = jobs
    .filter((j) => !["confirmed", "rejected"].includes(j.state))
    .reduce((s, j) => s + BigInt(j.amountBase), 0n);
  const eligibleBurns = jobs.filter((j) =>
    ["burn_finalized", "publication_pending", "zcash_confirmation_pending", "confirmed", "retryable"].includes(
      j.state,
    ),
  );
  const market = await getToken(mint);
  return {
    launch: {
      ...launch,
      currentSupply: (mintState?.supply ?? BigInt(launch.currentSupply)).toString(10),
    },
    originalLaunchSupply: launch.launchSupply,
    currentSupply: (mintState?.supply ?? BigInt(launch.currentSupply)).toString(10),
    eligibleBurnsBase: eligibleBurns.reduce((s, j) => s + BigInt(j.amountBase), 0n).toString(10),
    pendingIssuanceBase: pending.toString(10),
    confirmedStampUnitsBase: accepted.toString(10),
    solanaMarket: market.token
      ? { data: market.token, source: market.source, note: "Solana market data is not an executable stamp price." }
      : { data: null, source: market.source, error: market.error, note: "No stamp volume, holders, or trades are fabricated." },
    stamps,
    jobs: jobs.map(publicJob),
  };
}

export function publicJob(job: JobRow) {
  return {
    id: job.id,
    state: job.state,
    mint: job.mint,
    amountBase: job.amountBase,
    decimals: job.decimals,
    destination: job.destination,
    sourceTx: job.sourceTx,
    zcashTx: job.zcashTx,
    confirmations: job.confirmations,
    rejectReason: job.rejectReason,
    rejectMessage: job.rejectMessage,
    hasClaimPackage: Boolean(job.claimPackage),
    updatedAt: job.updatedAt,
  };
}

export function publicStamp(stamp: StampRow) {
  return {
    ...stamp,
    originalRecipient: stamp.destination,
    ownership:
      "Original recipient is the authorized destination. v0 has no transfer rules, so this is not labeled current owner.",
    validation: { ok: true, reason: "Accepted by stamp-exp/0 against this deployment's ledgers." },
  };
}

export function parseDisplay(text: string | undefined, decimals: number): bigint {
  if (!text || !text.trim()) return 0n;
  const raw = text.trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error("Amount must be a non-negative decimal.");
  const [w, f = ""] = raw.split(".");
  if (f.length > decimals) throw new Error(`Amount has more than ${decimals} decimal places.`);
  const frac = f.padEnd(decimals, "0");
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

export function formatDisplay(amount: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = amount % base;
  if (frac === 0n) return whole.toString(10);
  return `${whole.toString(10)}.${frac.toString(10).padStart(decimals, "0").replace(/0+$/, "")}`;
}
