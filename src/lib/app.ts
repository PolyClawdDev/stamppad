import { flags, liveMoneyMovementBlocked, stampMode } from "./mode";
import {
  DESTINATION_NOTICE_ZATOSHIS,
  TOKEN_PROGRAM_ID,
  validateDestination,
} from "./protocol";
import { credit, eligibleBalance, launchDemoMint } from "./solana/demo";
import { getPairs, getPricing, getStats, getToken, stonkTokenUrl } from "./stonk/client";
import { getStore, type JobRow, type LaunchRow, type StampRow } from "./store";
import { publicationFeeQuote, submitDemoBurn } from "./jobs/processor";
import { FIXTURE_PRICING } from "./stonk/fixtures";

const SEED_MINT_SYMBOL = "PROOF";

export async function statusPayload() {
  const f = flags();
  const stats = await getStats();
  return {
    product: "Stamppad",
    positioning: "Small stamps. Big ideas.",
    explanation: "Burn Solana tokens to create verifiable Zcash inscriptions.",
    mode: f.mode,
    banner: f.mode === "demo" ? "DEMO LEDGER" : f.mode === "testnet" ? "TESTNET" : "MAINNET",
    networks: { source: f.sourceNetwork, destination: f.destNetwork },
    store: f.store,
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
    costs: {
      launchVenue: stats.stats.config.paidLaunchesEnabled
        ? "Stonk paid launch path (currently reported enabled)"
        : "Stonk paid launch path disabled (503 on 2026-09-20). LaunchLab self-build has no Stonk launch fee.",
      initialPurchase: "Optional and only if you hold the quote asset. Does not execute a later trade.",
      stampFee: "0",
      network: "Solana rent + priority fee paid by the creator wallet. Demo ledger does not charge SOL.",
      publication: publicationFeeQuote(),
    },
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
    source: `demo launch mirroring ${quote.source}`,
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

export async function ensureDemoWallet(owner: string) {
  const store = getStore();
  const { solana, zcash } = await store.loadDemo();
  const existing = Object.values(solana.mints).find((m) => m.symbol === SEED_MINT_SYMBOL);
  if (!existing) {
    const launched = launchDemoMint({
      chain: solana,
      creator: owner,
      name: "Proof of Burn",
      symbol: SEED_MINT_SYMBOL,
      description: "Seeded demo mint. 1,000,000 display units credited to the connecting wallet so Convert can be exercised without a live launch.",
      imageDataUrl: null,
      quoteMint: FIXTURE_PRICING.quote.mint,
      quoteSymbol: "SPYX",
      supply: BigInt(FIXTURE_PRICING.curve.supply),
      totalSellA: BigInt(FIXTURE_PRICING.curve.totalSellA),
      decimals: 6,
      buyBase: 0n,
    });
    credit(solana, launched.mint, owner, 1_000_000_000_000n);
    await store.saveDemo(solana, zcash);
    await store.upsertLaunch({
      mint: launched.mint.address,
      name: launched.mint.name,
      symbol: launched.mint.symbol,
      description: launched.mint.description,
      imageDataUrl: null,
      quoteMint: launched.mint.quoteMint,
      quoteSymbol: launched.mint.quoteSymbol,
      tokenProgram: TOKEN_PROGRAM_ID,
      decimals: 6,
      launchSupply: launched.mint.launchSupply,
      poolBase: launched.mint.poolBase,
      currentSupply: launched.mint.supply.toString(10),
      creator: owner,
      launchTx: launched.tx.signature,
      stonkUrl: stonkTokenUrl(launched.mint.address),
      source: "demo seed — not a Stonk mainnet launch",
      createdAt: launched.mint.createdAt,
    });
  } else if (eligibleBalance(solana, owner, existing.address) === 0n) {
    credit(solana, existing, owner, 1_000_000_000_000n);
    await store.saveDemo(solana, zcash);
  }
  const { solana: next } = await store.loadDemo();
  const mint = Object.values(next.mints).find((m) => m.symbol === SEED_MINT_SYMBOL)!;
  return {
    mint: mint.address,
    symbol: mint.symbol,
    decimals: mint.decimals,
    eligibleBase: eligibleBalance(next, owner, mint.address).toString(10),
  };
}

export async function inspectMint(mint: string, owner?: string) {
  const store = getStore();
  const launch = await store.getLaunch(mint);
  const { solana } = await store.loadDemo();
  const demoMint = solana.mints[mint];
  if (!launch && !demoMint) {
    const live = await getToken(mint);
    if (!live.token) {
      return {
        supported: false,
        reason: live.error ?? "Mint is not on the demo ledger and live Stonk/Solana data was not available.",
      };
    }
    return {
      supported: false,
      reason:
        "Live mint inspection is read-only. Burning a mainnet mint is disabled. Switch to demo or supply a demo mint.",
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
}) {
  if (stampMode() !== "demo") {
    throw new Error(liveMoneyMovementBlocked("burn") ?? "Live burns are disabled.");
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
    validation: { ok: true, reason: "Accepted by stamp-exp/0 against the demo ledgers." },
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
