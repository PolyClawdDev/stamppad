/**
 * A real LaunchLab launch, built and proved but never sent from here.
 *
 * Everything that decides what the pool is comes from outside this file: the
 * launch parameters from Stonk's pricing endpoint, read at build time, and the
 * fee rates and enforcement flags from the config accounts on chain. Nothing
 * about the curve is hardcoded, because Stonk adopts a pool only if it matches
 * the launch their own builder would have produced, and their numbers move.
 *
 * The transaction is returned unsigned by the creator. This module holds no
 * wallet key and can send nothing; the creator's signature is added in their
 * own browser by Phantom. The one key it does create is the new mint's, which
 * the program requires as a signer in order to create the mint it is being
 * asked to create. That keypair is generated per call, never funded, never
 * persisted, never returned, and is unreachable once the call ends: after the
 * launch, the mint authority is the program's vault PDA, so the key has no
 * further power over anything.
 */
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { NATIVE_MINT } from "../protocol/constants";
import { flags } from "../mode";
import { getPairs, getPricing, type StonkPricing } from "../stonk/client";
import {
  AMM_FEE_ON_BOTH_TOKEN,
  AMM_FEE_ON_QUOTE_TOKEN,
  MIGRATE_TYPE_CPMM,
  NO_VESTING,
  TOKEN_2022_PROGRAM_ID,
  buyExactInInstruction,
  constantCurveBuyExactIn,
  constantCurveReserves,
  initializeWithToken2022Instruction,
  launchLabAddresses,
  platformCurveRuleAddress,
} from "./launchlab";
import { decodeGlobalConfig, decodePlatformConfig } from "./launchlab-config";
import { SolanaRpc, type SimulationResult } from "./rpc";

/**
 * Compute budget for the launch. The initialize creates a Token-2022 mint with
 * a metadata extension and two vault accounts, and the dev buy runs a swap in
 * the same transaction. Measured consumption is reported by the simulation, so
 * this is a ceiling rather than an estimate to trust.
 */
const LAUNCH_COMPUTE_UNITS = 600_000;

/** Tolerance on the dev buy. The pool is created in the same transaction, so
 * there is nothing to be front-run by; this only catches our own arithmetic
 * drifting from the program's, and turns that into a refusal. */
const DEFAULT_SLIPPAGE_BPS = 50;

export interface PreparedLaunch {
  /** The mint the pool will create. Its key is already discarded. */
  mint: string;
  /** Signed by the mint only. The creator signs this in Phantom. */
  transactionBase64: string;
  /** Still owed before this can be sent. */
  awaitingSignatureFrom: string[];
  pool: string;
  quote: { mint: string; symbol: string; decimals: number; amountIn: string };
  allocation: {
    /** Base units the dev buy is expected to deliver, all of it burnable. */
    expectedBase: string;
    minimumBase: string;
    decimals: number;
    tokenProgram: string;
    tokenAccount: string;
  };
  curve: {
    programId: string;
    globalConfig: string;
    platformConfig: string;
    platformCurveRule: string | null;
    supply: string;
    totalSellA: string;
    totalFundRaisingB: string;
    virtualA: string;
    virtualB: string;
    /** True when our reserve arithmetic matches what Stonk reports. */
    matchesVenueDerivation: boolean;
  };
  fees: {
    protocolFeeRate: string;
    platformFeeRate: string;
    creatorFeeRate: string;
    quoteFeeOnBuy: string;
  };
  costs: LaunchCosts;
  simulation: SimulationResult;
  pricingSource: string;
  metadataUri: string;
}

export interface LaunchCosts {
  /** Rent for the accounts the launch creates, in lamports. */
  rentLamports: string;
  /** Base network fee, in lamports: 5000 per signature, two signatures. */
  signatureFeeLamports: string;
  totalSolLamports: string;
  totalSol: string;
  /** Spent in the quote asset, not SOL. */
  quoteSpend: string;
  note: string;
}

export interface PrepareLaunchInput {
  /** Pays for the launch and receives the creator fee share. */
  creator: string;
  name: string;
  symbol: string;
  /**
   * Where the token's metadata JSON will live, with `{mint}` standing in for
   * the mint this call is about to create. Token-2022 writes the URI onto the
   * mint at creation and this app cannot change it afterwards, so it is a
   * template rather than a request-derived address.
   */
  metadataUriTemplate: string;
  quoteMint: string;
  /** Quote units to spend on the initial buy, in the quote mint's decimals. */
  quoteAmountIn: bigint;
  slippageBps?: number;
}

export const METADATA_MINT_PLACEHOLDER = "{mint}";

export function resolveMetadataUri(template: string, mint: string): string {
  if (!template.includes(METADATA_MINT_PLACEHOLDER)) {
    throw new LiveLaunchError(
      `The metadata URI template must contain ${METADATA_MINT_PLACEHOLDER}, or every launch would advertise the same metadata.`,
    );
  }
  if (!/^https:\/\//.test(template)) {
    throw new LiveLaunchError("The metadata URI must be https. It is written onto the mint permanently.");
  }
  return template.split(METADATA_MINT_PLACEHOLDER).join(mint);
}

export class LiveLaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveLaunchError";
  }
}

/**
 * Rent the launch pays, measured rather than guessed.
 *
 * The program creates the pool state, two vault token accounts, and a
 * Token-2022 mint carrying a metadata extension whose size depends on the name,
 * symbol and URI. Rather than model that, the caller is charged the lamport
 * delta the simulation reports for the payer, which is the real number.
 */
function costsFrom(input: {
  rentLamports: bigint;
  signatures: number;
  quoteSpend: string;
  quoteSymbol: string;
}): LaunchCosts {
  const signatureFee = BigInt(input.signatures) * 5000n;
  const total = input.rentLamports + signatureFee;
  return {
    rentLamports: input.rentLamports.toString(10),
    signatureFeeLamports: signatureFee.toString(10),
    totalSolLamports: total.toString(10),
    totalSol: formatLamports(total),
    quoteSpend: `${input.quoteSpend} ${input.quoteSymbol}`,
    note: "Rent is measured from the simulated lamport change on the creator's account, not estimated. No priority fee is added, so a congested slot may need one. Stonk charges no fee on this path.",
  };
}

function formatLamports(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const frac = (lamports % 1_000_000_000n).toString(10).padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac} SOL` : `${whole} SOL`;
}

/** Parses the curve half of a pricing response into instruction arguments. */
function curveArgsFrom(pricing: StonkPricing): {
  supply: bigint;
  totalSellA: bigint;
  totalFundRaisingB: bigint;
  migrateType: number;
  ammFeeOn: number;
  baseDecimals: number;
} {
  const curve = pricing.curve as StonkPricing["curve"] & {
    curveType?: string;
    migrateType?: string;
    cpmmCreatorFeeOn?: number;
    vesting?: { totalLockedAmount?: string };
  };
  if (curve.curveType && curve.curveType !== "ConstantCurve") {
    throw new LiveLaunchError(
      `The venue reports a ${curve.curveType} curve. Only the constant-product curve is built here, so nothing is guessed about a curve we have not read.`,
    );
  }
  if (curve.migrateType && curve.migrateType !== "cpmm") {
    throw new LiveLaunchError(
      `The venue reports migrateType ${curve.migrateType}. Only cpmm is built here.`,
    );
  }
  const locked = curve.vesting?.totalLockedAmount ?? "0";
  if (BigInt(locked) !== 0n) {
    throw new LiveLaunchError(
      "The venue reports a vesting schedule. Vested launches are not built here, because a vested allocation is not fully burnable.",
    );
  }
  const raise = (pricing.raise as { raw?: string }).raw;
  if (!raise) {
    throw new LiveLaunchError("The venue did not report raise.raw, which sizes the curve.");
  }
  return {
    supply: BigInt(curve.supply),
    totalSellA: BigInt(curve.totalSellA),
    totalFundRaisingB: BigInt(raise),
    migrateType: MIGRATE_TYPE_CPMM,
    ammFeeOn: curve.cpmmCreatorFeeOn === 1 ? AMM_FEE_ON_BOTH_TOKEN : AMM_FEE_ON_QUOTE_TOKEN,
    baseDecimals: curve.baseDecimals,
  };
}

export async function prepareLiveLaunch(input: PrepareLaunchInput): Promise<PreparedLaunch> {
  const f = flags();
  if (!f.solanaRpc) {
    throw new LiveLaunchError("SOLANA_RPC_URL is required to build and simulate a live launch.");
  }
  if (!f.stonkReadLive) {
    throw new LiveLaunchError(
      "STAMP_STONK_READ_LIVE must be true for a live launch. The fixture parameters are a snapshot, and a launch built from a stale raise is a pool the venue will not adopt.",
    );
  }
  if (input.quoteAmountIn <= 0n) {
    throw new LiveLaunchError(
      "The initial buy must be positive. Without it the creator holds nothing, so there is no allocation to burn into a stamp.",
    );
  }

  const creator = new PublicKey(input.creator);
  const quoteMint = new PublicKey(input.quoteMint);
  const rpc = new SolanaRpc(f.solanaRpc);

  // The pair must still be launchable, and the pricing must be fresh: both are
  // read now rather than taken from anything cached.
  const { pairs } = await getPairs();
  const pair = pairs.find((entry) => entry.mint === input.quoteMint);
  if (!pair) {
    throw new LiveLaunchError("That quote mint is not in the venue's launchable pair list right now.");
  }
  if (!pair.launchable || pair.launchLabReady === false) {
    throw new LiveLaunchError("That quote asset is not LaunchLab-ready at the venue right now.");
  }
  const { pricing, source: pricingSource } = await getPricing(input.quoteMint);
  const curve = curveArgsFrom(pricing);

  const programId = new PublicKey(pricing.curve.programId);
  const globalConfig = new PublicKey(pricing.curve.configId);
  const platformConfig = new PublicKey(pricing.platform.standard);
  const quoteTokenProgram = new PublicKey(pricing.quote.tokenProgram);

  // Read the configs rather than trust the endpoint about them. The fee rates
  // decide what the dev buy actually delivers, and the two restrict flags
  // decide which remaining accounts the program demands.
  const [globalRaw, platformRaw] = await Promise.all([
    rpc.getAccountInfo(globalConfig.toBase58()),
    rpc.getAccountInfo(platformConfig.toBase58()),
  ]);
  if (!globalRaw) throw new LiveLaunchError(`Global config ${globalConfig.toBase58()} is not on chain.`);
  if (!platformRaw) {
    throw new LiveLaunchError(`Platform config ${platformConfig.toBase58()} is not on chain.`);
  }
  if (globalRaw.owner !== programId.toBase58() || platformRaw.owner !== programId.toBase58()) {
    throw new LiveLaunchError("A config account is not owned by the LaunchLab program named by the venue.");
  }
  const global = decodeGlobalConfig(Buffer.from(globalRaw.data[0], "base64"));
  const platform = decodePlatformConfig(Buffer.from(platformRaw.data[0], "base64"));

  if (global.quoteMint !== input.quoteMint) {
    throw new LiveLaunchError(
      `The global config pairs against ${global.quoteMint}, not ${input.quoteMint}. Launching would fail on chain.`,
    );
  }
  if (global.curveType !== 0) {
    throw new LiveLaunchError(`The global config uses curve type ${global.curveType}, not constant product.`);
  }
  if (curve.totalFundRaisingB < global.minQuoteFundRaising) {
    throw new LiveLaunchError(
      `The venue's raise of ${curve.totalFundRaisingB} is below the config minimum of ${global.minQuoteFundRaising}.`,
    );
  }
  if (platform.restrictGlobalConfig === 1) {
    throw new LiveLaunchError(
      "The platform restricts which global configs it allows, which needs the platform allow-config account. The venue does not publish it, so nothing is guessed here.",
    );
  }

  // The venue publishes its curve rule; deriving it independently is how we
  // check the address we were handed belongs to this platform and config.
  const derivedRule = platformCurveRuleAddress({ programId, platformConfig, globalConfig });
  const publishedRule = (pricing as { curveRule?: { standard?: string } }).curveRule?.standard ?? null;
  if (publishedRule && publishedRule !== derivedRule.toBase58()) {
    throw new LiveLaunchError(
      `The venue's curve rule ${publishedRule} is not the rule derived for its platform and config (${derivedRule.toBase58()}). Refusing to attach an account we cannot account for.`,
    );
  }
  let platformCurveRule: PublicKey | null = derivedRule;
  if (platform.restrictCurveParam === 1) {
    const ruleAccount = await rpc.getAccountInfo(derivedRule.toBase58());
    if (!ruleAccount) {
      throw new LiveLaunchError(
        "The platform enforces its launch shape but its curve rule account is not on chain. The launch would fail with NotEnoughRemainingAccounts.",
      );
    }
  } else if (!publishedRule) {
    // Enforcement is off and the venue named no rule: attaching an account the
    // program will not read is noise, so leave it off.
    platformCurveRule = null;
  }

  // Reproduce the reserves the program will compute, and check them against
  // what the venue reports for the same parameters. A mismatch means one of us
  // is working from different numbers, which is the moment to stop.
  const reserves = constantCurveReserves({
    supply: curve.supply,
    totalSellA: curve.totalSellA,
    totalFundRaisingB: curve.totalFundRaisingB,
    migrateFee: BigInt((pricing.curve as { migrateFeeRaw?: string }).migrateFeeRaw ?? "0"),
  });
  const venueVirtualA = pricing.curve.derived?.virtualA;
  const venueVirtualB = pricing.curve.derived?.virtualB;
  const matchesVenueDerivation =
    venueVirtualA === reserves.virtualA.toString(10) && venueVirtualB === reserves.virtualB.toString(10);
  if (venueVirtualA && venueVirtualB && !matchesVenueDerivation) {
    throw new LiveLaunchError(
      `Our curve arithmetic gives virtualA=${reserves.virtualA} virtualB=${reserves.virtualB}, the venue reports ${venueVirtualA}/${venueVirtualB}. Refusing to launch against parameters we cannot reproduce.`,
    );
  }

  const buy = constantCurveBuyExactIn({
    virtualA: reserves.virtualA,
    virtualB: reserves.virtualB,
    amountIn: input.quoteAmountIn,
    protocolFeeRate: global.tradeFeeRate,
    platformFeeRate: platform.feeRate,
    creatorFeeRate: platform.creatorFeeRate,
    totalSellA: curve.totalSellA,
  });
  if (buy.amountOut <= 0n) {
    throw new LiveLaunchError(
      "That initial buy is too small to receive any base units after fees, so it would leave nothing to burn.",
    );
  }
  const slippageBps = BigInt(input.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
  const minimumBase = (buy.amountOut * (10_000n - slippageBps)) / 10_000n;

  // Wrapped SOL is bought with the wallet's SOL. Other quotes need an existing
  // token account. Refusing here, by name, is better than a simulation error.
  const quoteTokenAccount = getAssociatedTokenAddressSync(
    quoteMint,
    creator,
    false,
    quoteTokenProgram,
  );
  const nativeSol = input.quoteMint === NATIVE_MINT;
  if (nativeSol) {
    const wallet = await rpc.getAccountInfo(creator.toBase58());
    const lamports = BigInt(wallet?.lamports ?? 0);
    const floor = input.quoteAmountIn + 20_000_000n;
    if (lamports < floor) {
      throw new LiveLaunchError(
        `This wallet holds ${formatLamports(lamports)} and the initial buy plus rent needs about ${formatLamports(floor)}.`,
      );
    }
  } else {
    const quoteBalance = await rpc.getTokenAccountBalance(quoteTokenAccount.toBase58());
    if (quoteBalance === null) {
      throw new LiveLaunchError(
        pricing.quote.symbol === "ZEC"
          ? "This wallet has no Solana ZEC token account, so it cannot fund the initial buy. A stamp launch is quoted in bridged ZEC (A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS), not SOL and not native Zcash. Receive that token into Phantom first."
          : `This wallet has no ${pricing.quote.symbol} token account, so it cannot fund the initial buy.`,
      );
    }
    if (BigInt(quoteBalance) < input.quoteAmountIn) {
      throw new LiveLaunchError(
        `This wallet holds ${quoteBalance} base units of ${pricing.quote.symbol} and the initial buy needs ${input.quoteAmountIn}.`,
      );
    }
  }

  // The program creates the mint, so the mint must sign. This key exists only
  // for the length of this function.
  const mintKeypair = Keypair.generate();
  const baseMint = mintKeypair.publicKey;
  const metadataUri = resolveMetadataUri(input.metadataUriTemplate, baseMint.toBase58());
  const token2022 = new PublicKey(TOKEN_2022_PROGRAM_ID);
  const pdas = launchLabAddresses({ programId, baseMint, quoteMint });
  const baseTokenAccount = getAssociatedTokenAddressSync(baseMint, creator, false, token2022);

  const initialize = initializeWithToken2022Instruction({
    programId,
    payer: creator,
    creator,
    globalConfig,
    platformConfig,
    baseMint,
    quoteMint,
    quoteTokenProgram,
    platformCurveRule: platformCurveRule ?? undefined,
    args: {
      decimals: curve.baseDecimals,
      name: input.name,
      symbol: input.symbol,
      uri: metadataUri,
      curve: {
        supply: curve.supply,
        totalSellA: curve.totalSellA,
        totalFundRaisingB: curve.totalFundRaisingB,
        migrateType: curve.migrateType,
      },
      vesting: NO_VESTING,
      ammFeeOn: curve.ammFeeOn,
    },
  });

  const transaction = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: LAUNCH_COMPUTE_UNITS }))
    .add(initialize)
    .add(
      createAssociatedTokenAccountIdempotentInstruction(
        creator,
        baseTokenAccount,
        creator,
        baseMint,
        token2022,
      ),
    );
  if (nativeSol) {
    transaction
      .add(
        createAssociatedTokenAccountIdempotentInstruction(
          creator,
          quoteTokenAccount,
          creator,
          quoteMint,
          quoteTokenProgram,
        ),
      )
      .add(
        SystemProgram.transfer({
          fromPubkey: creator,
          toPubkey: quoteTokenAccount,
          lamports: Number(input.quoteAmountIn),
        }),
      )
      .add(createSyncNativeInstruction(quoteTokenAccount));
  }
  transaction.add(
      buyExactInInstruction({
        programId,
        payer: creator,
        creator,
        globalConfig,
        platformConfig,
        baseMint,
        quoteMint,
        userBaseToken: baseTokenAccount,
        userQuoteToken: quoteTokenAccount,
        quoteTokenProgram,
        args: { amountIn: input.quoteAmountIn, minimumAmountOut: minimumBase, shareFeeRate: 0n },
      }),
    );

  const [{ blockhash }, creatorBefore] = await Promise.all([
    rpc.getLatestBlockhash(),
    rpc.getAccountInfo(creator.toBase58()),
  ]);
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = creator;
  transaction.partialSign(mintKeypair);

  const serialized = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  if (serialized.length > 1232) {
    throw new LiveLaunchError(
      `The launch transaction is ${serialized.length} bytes, over Solana's 1232-byte limit. A shorter name, symbol or metadata URI fixes it.`,
    );
  }
  const transactionBase64 = serialized.toString("base64");

  const simulation = await rpc.simulateTransaction(transactionBase64, {
    addresses: [creator.toBase58()],
  });
  const rentLamports = lamportsSpentInSimulation(creatorBefore?.lamports, simulation);

  return {
    mint: baseMint.toBase58(),
    transactionBase64,
    awaitingSignatureFrom: [creator.toBase58()],
    pool: pdas.poolState.toBase58(),
    quote: {
      mint: input.quoteMint,
      symbol: pricing.quote.symbol,
      decimals: pricing.quote.decimals,
      amountIn: input.quoteAmountIn.toString(10),
    },
    allocation: {
      expectedBase: buy.amountOut.toString(10),
      minimumBase: minimumBase.toString(10),
      decimals: curve.baseDecimals,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      tokenAccount: baseTokenAccount.toBase58(),
    },
    curve: {
      programId: programId.toBase58(),
      globalConfig: globalConfig.toBase58(),
      platformConfig: platformConfig.toBase58(),
      platformCurveRule: platformCurveRule?.toBase58() ?? null,
      supply: curve.supply.toString(10),
      totalSellA: curve.totalSellA.toString(10),
      totalFundRaisingB: curve.totalFundRaisingB.toString(10),
      virtualA: reserves.virtualA.toString(10),
      virtualB: reserves.virtualB.toString(10),
      matchesVenueDerivation,
    },
    fees: {
      protocolFeeRate: global.tradeFeeRate.toString(10),
      platformFeeRate: platform.feeRate.toString(10),
      creatorFeeRate: platform.creatorFeeRate.toString(10),
      quoteFeeOnBuy: buy.feeIn.toString(10),
    },
    costs: costsFrom({
      rentLamports,
      signatures: 2,
      quoteSpend: input.quoteAmountIn.toString(10),
      quoteSymbol: pricing.quote.symbol,
    }),
    simulation,
    pricingSource,
    metadataUri,
  };
}

/**
 * What the launch takes from the creator, measured on the simulation.
 *
 * simulateTransaction returns accounts as they stand after execution, so the
 * difference from their current balance is what the program actually moves:
 * rent for the pool state, the two vaults, the mint and the creator's token
 * account. Simulation does not settle the signature fee, which is why the
 * caller adds it separately.
 *
 * A failed simulation has no honest number behind it, so this reports zero and
 * the caller shows the failure rather than a cost.
 */
export function lamportsSpentInSimulation(
  lamportsBefore: number | undefined,
  simulation: SimulationResult,
): bigint {
  const after = simulation.accounts?.[0]?.lamports;
  if (!simulation.ok || typeof after !== "number" || typeof lamportsBefore !== "number") return 0n;
  const spent = BigInt(lamportsBefore) - BigInt(after);
  return spent > 0n ? spent : 0n;
}
