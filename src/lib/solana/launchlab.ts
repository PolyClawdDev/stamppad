/**
 * Raydium LaunchLab instruction construction.
 *
 * Stonk is a front end and a platform config over this program, so a launch
 * Stonk adopts is an ordinary LaunchLab pool carrying Stonk's platform id. The
 * layouts here were read from the program's own Anchor IDL account on mainnet
 * rather than from documentation, and cross-checked against the builder in
 * @raydium-io/raydium-sdk-v2 that Stonk's published example uses.
 *
 * Three facts from that reading decide the shape of everything below.
 *
 * The `initialize` instruction is deprecated and always fails with NotApproved;
 * `initialize_with_token_2022` is the live entry point, which is why every
 * LaunchLab base mint is a Token-2022 mint. A standard Stonk launch passes no
 * transfer-fee extension, so the mint provably carries none.
 *
 * Stonk's platform config sets restrict_curve_param, so the program requires
 * the platform's curve-rule account as the last remaining account. Without it
 * the launch fails with NotEnoughRemainingAccounts (6018); with launch
 * parameters outside the rule it fails with CurveParamNotMatchPlatformRule
 * (6025).
 *
 * `buy_exact_in` takes three accounts the IDL does not list, because they are
 * conditional: the system program and the platform and creator fee vaults, in
 * that order, after the named accounts.
 *
 * Everything in this module is a pure function of its arguments. It holds no
 * keys, reads no environment, and touches no network, so the encoding and the
 * derivations are tested without one.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

/** The LaunchLab program. Stonk reports it per request; this is the fallback. */
export const LAUNCHLAB_PROGRAM_ID = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";

export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** Anchor discriminators: sha256("global:<name>")[..8], as the IDL records them. */
export const INITIALIZE_WITH_TOKEN_2022_DISCRIMINATOR = Uint8Array.from([
  37, 190, 126, 222, 44, 154, 171, 17,
]);
export const BUY_EXACT_IN_DISCRIMINATOR = Uint8Array.from([250, 234, 13, 123, 213, 156, 19, 236]);

const AUTH_SEED = Buffer.from("vault_auth_seed", "utf8");
const POOL_SEED = Buffer.from("pool", "utf8");
const POOL_VAULT_SEED = Buffer.from("pool_vault", "utf8");
const EVENT_AUTHORITY_SEED = Buffer.from("__event_authority", "utf8");
const PLATFORM_CURVE_RULE_SEED = Buffer.from("platform_curve_rule", "utf8");

/** Curve discriminant in CurveParams. Stonk's ZEC config is ConstantCurve. */
export const CURVE_CONSTANT = 0;
/** MigrateType. Stonk's ZEC config graduates to cpmm. */
export const MIGRATE_TYPE_AMM = 0;
export const MIGRATE_TYPE_CPMM = 1;
/** AmmCreatorFeeOn, reported by Stonk as curve.cpmmCreatorFeeOn. */
export const AMM_FEE_ON_QUOTE_TOKEN = 0;
export const AMM_FEE_ON_BOTH_TOKEN = 1;

/** Fee rates in the program are hundredths of a basis point. */
export const FEE_RATE_DENOMINATOR = 1_000_000n;

/**
 * Borsh writer, limited to the four primitives this instruction set uses.
 *
 * A schema declaration library would still leave the schema itself to us, and
 * the schema is where the risk is, so the primitives are written out and
 * asserted byte for byte in tests instead of adding a dependency.
 */
export class BorshWriter {
  private readonly parts: Buffer[] = [];

  u8(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new Error(`u8 out of range: ${value}`);
    }
    this.parts.push(Buffer.from([value]));
    return this;
  }

  u16(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new Error(`u16 out of range: ${value}`);
    }
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(value, 0);
    this.parts.push(buf);
    return this;
  }

  u64(value: bigint): this {
    if (value < 0n || value > 0xffffffffffffffffn) {
      throw new Error(`u64 out of range: ${value}`);
    }
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(value, 0);
    this.parts.push(buf);
    return this;
  }

  /** Borsh strings are a u32 little-endian byte length and then the bytes. */
  string(value: string): this {
    const bytes = Buffer.from(value, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(bytes.length, 0);
    this.parts.push(len, bytes);
    return this;
  }

  bytes(value: Uint8Array): this {
    this.parts.push(Buffer.from(value));
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.parts);
  }
}

export interface LaunchLabAddresses {
  programId: PublicKey;
  /** PDA that owns the vaults and the mint. Seed "vault_auth_seed". */
  authority: PublicKey;
  /** The pool. Seed "pool" plus both mints, so it is fixed by the pair. */
  poolState: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  /** Anchor's CPI event authority. Seed "__event_authority". */
  eventAuthority: PublicKey;
}

export function launchLabAddresses(input: {
  programId: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
}): LaunchLabAddresses {
  const { programId, baseMint, quoteMint } = input;
  const [authority] = PublicKey.findProgramAddressSync([AUTH_SEED], programId);
  const [poolState] = PublicKey.findProgramAddressSync(
    [POOL_SEED, baseMint.toBuffer(), quoteMint.toBuffer()],
    programId,
  );
  const [baseVault] = PublicKey.findProgramAddressSync(
    [POOL_VAULT_SEED, poolState.toBuffer(), baseMint.toBuffer()],
    programId,
  );
  const [quoteVault] = PublicKey.findProgramAddressSync(
    [POOL_VAULT_SEED, poolState.toBuffer(), quoteMint.toBuffer()],
    programId,
  );
  const [eventAuthority] = PublicKey.findProgramAddressSync([EVENT_AUTHORITY_SEED], programId);
  return { programId, authority, poolState, baseVault, quoteVault, eventAuthority };
}

/**
 * The platform's curve rule. Stonk publishes this address; deriving it as well
 * is how we check that the address we were handed is the rule for the platform
 * and config we are actually launching against.
 */
export function platformCurveRuleAddress(input: {
  programId: PublicKey;
  platformConfig: PublicKey;
  globalConfig: PublicKey;
}): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [PLATFORM_CURVE_RULE_SEED, input.platformConfig.toBuffer(), input.globalConfig.toBuffer()],
    input.programId,
  );
  return address;
}

/** Where the platform's share of trade fees accrues, per quote mint. */
export function platformFeeVaultAddress(input: {
  programId: PublicKey;
  platformConfig: PublicKey;
  quoteMint: PublicKey;
}): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [input.platformConfig.toBuffer(), input.quoteMint.toBuffer()],
    input.programId,
  );
  return address;
}

/** Where the creator's share of trade fees accrues, per quote mint. */
export function creatorFeeVaultAddress(input: {
  programId: PublicKey;
  creator: PublicKey;
  quoteMint: PublicKey;
}): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [input.creator.toBuffer(), input.quoteMint.toBuffer()],
    input.programId,
  );
  return address;
}

export interface ConstantCurveParams {
  /** Total base units the mint will ever have. */
  supply: bigint;
  /** Base units sold through the curve. The remainder migrates to the pool. */
  totalSellA: bigint;
  /** Quote raise in the quote mint's own decimals. Stonk's raise.raw. */
  totalFundRaisingB: bigint;
  migrateType: number;
}

export interface VestingParams {
  totalLockedAmount: bigint;
  cliffPeriod: bigint;
  unlockPeriod: bigint;
}

export const NO_VESTING: VestingParams = {
  totalLockedAmount: 0n,
  cliffPeriod: 0n,
  unlockPeriod: 0n,
};

export interface InitializeArgs {
  decimals: number;
  name: string;
  symbol: string;
  uri: string;
  curve: ConstantCurveParams;
  vesting: VestingParams;
  ammFeeOn: number;
}

/** Metaplex's limits, which Stonk's metadata also has to fit. */
export const MINT_NAME_MAX = 32;
export const MINT_SYMBOL_MAX = 10;
export const MINT_URI_MAX = 200;

export function assertInitializeArgs(args: InitializeArgs): void {
  if (Buffer.from(args.name, "utf8").length > MINT_NAME_MAX) {
    throw new Error(`Name must be at most ${MINT_NAME_MAX} bytes.`);
  }
  if (Buffer.from(args.symbol, "utf8").length > MINT_SYMBOL_MAX) {
    throw new Error(`Symbol must be at most ${MINT_SYMBOL_MAX} bytes.`);
  }
  if (Buffer.from(args.uri, "utf8").length > MINT_URI_MAX) {
    throw new Error(`Metadata URI must be at most ${MINT_URI_MAX} bytes.`);
  }
  if (args.curve.supply <= args.curve.totalSellA) {
    throw new Error("Supply must exceed the amount sold through the curve.");
  }
  if (args.curve.totalFundRaisingB <= 0n) {
    throw new Error("The quote raise must be positive.");
  }
  if (args.decimals < 0 || args.decimals > 9) {
    throw new Error("Decimals must be between 0 and 9.");
  }
}

/**
 * initialize_with_token_2022 instruction data.
 *
 * Anchor discriminator, then MintParams, then CurveParams as a Borsh enum (a
 * u8 discriminant and the variant's fields), then VestingParams, then
 * AmmCreatorFeeOn, then Option<TransferFeeExtensionParams>. A standard launch
 * writes the None tag and nothing after it.
 */
export function encodeInitializeWithToken2022Data(args: InitializeArgs): Buffer {
  assertInitializeArgs(args);
  return new BorshWriter()
    .bytes(INITIALIZE_WITH_TOKEN_2022_DISCRIMINATOR)
    .u8(args.decimals)
    .string(args.name)
    .string(args.symbol)
    .string(args.uri)
    .u8(CURVE_CONSTANT)
    .u64(args.curve.supply)
    .u64(args.curve.totalSellA)
    .u64(args.curve.totalFundRaisingB)
    .u8(args.curve.migrateType)
    .u64(args.vesting.totalLockedAmount)
    .u64(args.vesting.cliffPeriod)
    .u64(args.vesting.unlockPeriod)
    .u8(args.ammFeeOn)
    .u8(0)
    .toBuffer();
}

export interface InitializeInstructionInput {
  programId: PublicKey;
  /** Pays rent and fees, and signs. */
  payer: PublicKey;
  /** Receives the creator fee share. Not a signer. */
  creator: PublicKey;
  globalConfig: PublicKey;
  platformConfig: PublicKey;
  /** A fresh keypair. The program creates the mint, so this must sign. */
  baseMint: PublicKey;
  quoteMint: PublicKey;
  /** The program that owns the quote mint. ZEC is classic SPL Token. */
  quoteTokenProgram: PublicKey;
  args: InitializeArgs;
  /** Only when the platform restricts which global configs may be used. */
  platformAllowConfig?: PublicKey;
  /** Required while the platform restricts launch parameters. Read-only, last. */
  platformCurveRule?: PublicKey;
}

export function initializeWithToken2022Instruction(
  input: InitializeInstructionInput,
): TransactionInstruction {
  const pdas = launchLabAddresses({
    programId: input.programId,
    baseMint: input.baseMint,
    quoteMint: input.quoteMint,
  });
  const keys = [
    { pubkey: input.payer, isSigner: true, isWritable: true },
    { pubkey: input.creator, isSigner: false, isWritable: false },
    { pubkey: input.globalConfig, isSigner: false, isWritable: false },
    { pubkey: input.platformConfig, isSigner: false, isWritable: false },
    { pubkey: pdas.authority, isSigner: false, isWritable: false },
    { pubkey: pdas.poolState, isSigner: false, isWritable: true },
    { pubkey: input.baseMint, isSigner: true, isWritable: true },
    { pubkey: input.quoteMint, isSigner: false, isWritable: false },
    { pubkey: pdas.baseVault, isSigner: false, isWritable: true },
    { pubkey: pdas.quoteVault, isSigner: false, isWritable: true },
    { pubkey: new PublicKey(TOKEN_2022_PROGRAM_ID), isSigner: false, isWritable: false },
    { pubkey: input.quoteTokenProgram, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: pdas.eventAuthority, isSigner: false, isWritable: false },
    { pubkey: input.programId, isSigner: false, isWritable: false },
  ];
  // Remaining accounts are read positionally, so the allow config comes first
  // when the platform uses one and the curve rule is always last.
  if (input.platformAllowConfig) {
    keys.push({ pubkey: input.platformAllowConfig, isSigner: false, isWritable: false });
  }
  if (input.platformCurveRule) {
    keys.push({ pubkey: input.platformCurveRule, isSigner: false, isWritable: false });
  }
  return new TransactionInstruction({
    programId: input.programId,
    keys,
    data: encodeInitializeWithToken2022Data(input.args),
  });
}

export interface BuyExactInArgs {
  /** Quote units spent, in the quote mint's decimals. */
  amountIn: bigint;
  /** Base units below which the buy must fail. */
  minimumAmountOut: bigint;
  /** Referral share. Stonk's config caps this at zero. */
  shareFeeRate: bigint;
}

export function encodeBuyExactInData(args: BuyExactInArgs): Buffer {
  return new BorshWriter()
    .bytes(BUY_EXACT_IN_DISCRIMINATOR)
    .u64(args.amountIn)
    .u64(args.minimumAmountOut)
    .u64(args.shareFeeRate)
    .toBuffer();
}

export interface BuyExactInInstructionInput {
  programId: PublicKey;
  payer: PublicKey;
  /** The pool's creator, whose fee vault the buy credits. */
  creator: PublicKey;
  globalConfig: PublicKey;
  platformConfig: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  /** The payer's token account for the new mint, on Token-2022. */
  userBaseToken: PublicKey;
  /** The payer's token account for the quote mint. */
  userQuoteToken: PublicKey;
  quoteTokenProgram: PublicKey;
  args: BuyExactInArgs;
}

export function buyExactInInstruction(
  input: BuyExactInInstructionInput,
): TransactionInstruction {
  const pdas = launchLabAddresses({
    programId: input.programId,
    baseMint: input.baseMint,
    quoteMint: input.quoteMint,
  });
  const keys = [
    { pubkey: input.payer, isSigner: true, isWritable: true },
    { pubkey: pdas.authority, isSigner: false, isWritable: false },
    { pubkey: input.globalConfig, isSigner: false, isWritable: false },
    { pubkey: input.platformConfig, isSigner: false, isWritable: false },
    { pubkey: pdas.poolState, isSigner: false, isWritable: true },
    { pubkey: input.userBaseToken, isSigner: false, isWritable: true },
    { pubkey: input.userQuoteToken, isSigner: false, isWritable: true },
    { pubkey: pdas.baseVault, isSigner: false, isWritable: true },
    { pubkey: pdas.quoteVault, isSigner: false, isWritable: true },
    { pubkey: input.baseMint, isSigner: false, isWritable: false },
    { pubkey: input.quoteMint, isSigner: false, isWritable: false },
    { pubkey: new PublicKey(TOKEN_2022_PROGRAM_ID), isSigner: false, isWritable: false },
    { pubkey: input.quoteTokenProgram, isSigner: false, isWritable: false },
    { pubkey: pdas.eventAuthority, isSigner: false, isWritable: false },
    { pubkey: input.programId, isSigner: false, isWritable: false },
    // The IDL omits these three because they are conditional on the fee split.
    // The program reads them positionally after the named accounts.
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    {
      pubkey: platformFeeVaultAddress({
        programId: input.programId,
        platformConfig: input.platformConfig,
        quoteMint: input.quoteMint,
      }),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: creatorFeeVaultAddress({
        programId: input.programId,
        creator: input.creator,
        quoteMint: input.quoteMint,
      }),
      isSigner: false,
      isWritable: true,
    },
  ];
  return new TransactionInstruction({
    programId: input.programId,
    keys,
    data: encodeBuyExactInData(input.args),
  });
}

/**
 * The virtual reserves the program computes from the launch parameters.
 *
 * Reproduced here so an opening price can be shown before signing rather than
 * discovered after landing. The result is checked against the virtualA and
 * virtualB that Stonk's pricing endpoint reports for the same parameters, so a
 * drift in either is caught before a transaction is built.
 */
export function constantCurveReserves(curve: {
  supply: bigint;
  totalSellA: bigint;
  totalFundRaisingB: bigint;
  totalLockedAmount?: bigint;
  migrateFee?: bigint;
}): { virtualA: bigint; virtualB: bigint } {
  const locked = curve.totalLockedAmount ?? 0n;
  const migrateFee = curve.migrateFee ?? 0n;
  const rest = curve.supply - curve.totalSellA - locked;
  if (rest <= 0n) throw new Error("Supply must exceed what is sold and locked.");
  const raiseAfterMigrateFee = curve.totalFundRaisingB - migrateFee;
  if (raiseAfterMigrateFee <= 0n) throw new Error("The raise must exceed the migrate fee.");

  const numerator = (raiseAfterMigrateFee * curve.totalSellA * curve.totalSellA) / rest;
  const denominator = (raiseAfterMigrateFee * curve.totalSellA) / rest - curve.totalFundRaisingB;
  if (denominator <= 0n) throw new Error("Degenerate curve parameters.");
  return {
    virtualA: numerator / denominator,
    virtualB: (curve.totalFundRaisingB * curve.totalFundRaisingB) / denominator,
  };
}

function ceilDiv(amount: bigint, numerator: bigint, denominator: bigint): bigint {
  return (amount * numerator + denominator - 1n) / denominator;
}

/**
 * Base units a quote spend buys on an untouched pool, and the fee taken.
 *
 * The program takes the total fee off the input first and swaps the remainder
 * against the constant product, so the fee rates are part of the answer.
 */
export function constantCurveBuyExactIn(input: {
  virtualA: bigint;
  virtualB: bigint;
  amountIn: bigint;
  /** global_config.trade_fee_rate. */
  protocolFeeRate: bigint;
  /** platform_config.fee_rate. */
  platformFeeRate: bigint;
  /** platform_config.creator_fee_rate. */
  creatorFeeRate: bigint;
  shareFeeRate?: bigint;
  /** total_base_sell: the buy cannot take more than the curve holds. */
  totalSellA: bigint;
}): { amountOut: bigint; feeIn: bigint } {
  const feeRate =
    input.protocolFeeRate + input.platformFeeRate + input.creatorFeeRate + (input.shareFeeRate ?? 0n);
  if (feeRate > FEE_RATE_DENOMINATOR) throw new Error("Total fee rate exceeds 100%.");
  const feeIn = ceilDiv(input.amountIn, feeRate, FEE_RATE_DENOMINATOR);
  const swapIn = input.amountIn - feeIn;
  if (swapIn <= 0n) return { amountOut: 0n, feeIn };
  const amountOut = (swapIn * input.virtualA) / (input.virtualB + swapIn);
  return { amountOut: amountOut > input.totalSellA ? input.totalSellA : amountOut, feeIn };
}
