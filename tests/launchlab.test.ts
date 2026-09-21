/**
 * LaunchLab instruction construction, checked without a network.
 *
 * The expected bytes and addresses are not copied from our own implementation.
 * The discriminators come from the program's IDL account on mainnet, the PDAs
 * were derived independently and compared against the accounts the program
 * already owns, and the virtual reserves are the ones Stonk's pricing endpoint
 * reports for the same launch parameters. So these tests fail if the encoding
 * drifts from what the program actually accepts, which is the only thing worth
 * asserting about it.
 */
import { describe, expect, it } from "vitest";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  AMM_FEE_ON_QUOTE_TOKEN,
  BUY_EXACT_IN_DISCRIMINATOR,
  BorshWriter,
  CURVE_CONSTANT,
  INITIALIZE_WITH_TOKEN_2022_DISCRIMINATOR,
  LAUNCHLAB_PROGRAM_ID,
  MIGRATE_TYPE_CPMM,
  NO_VESTING,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  buyExactInInstruction,
  constantCurveBuyExactIn,
  constantCurveReserves,
  creatorFeeVaultAddress,
  encodeBuyExactInData,
  encodeInitializeWithToken2022Data,
  initializeWithToken2022Instruction,
  launchLabAddresses,
  platformCurveRuleAddress,
  platformFeeVaultAddress,
} from "../src/lib/solana/launchlab";
import {
  decodeGlobalConfig,
  decodePlatformConfig,
} from "../src/lib/solana/launchlab-config";
import fixtures from "./fixtures/launchlab-config-mainnet.json";

const PROGRAM = new PublicKey(LAUNCHLAB_PROGRAM_ID);
const ZEC_MINT = new PublicKey("A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS");
const GLOBAL_CONFIG = new PublicKey("E2fd24QycuwszEK8WyU8CgtCfp5bUkTMenUthzgShJxA");
const PLATFORM_CONFIG = new PublicKey("4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7");
const CURVE_RULE = "2hu6XQkewEDhx6Ck9GkuMDpRXWWLmHf54ae8Ln6D8PbU";

// A fixed mint and creator so derivations are reproducible.
const BASE_MINT = new PublicKey("6GoDm8yxiqmLZ4KGZJbY3fAc5x7h4AQfcS983idu7pvX");
const CREATOR = new PublicKey("ByiAbN9MJhfQKGK5WJrfgko6XS88qqERQVRLWZTsvyTf");

// Stonk's published ZEC launch shape, and the reserves it reports for it.
const STONK_CURVE = {
  supply: 1_000_000_000_000_000n,
  totalSellA: 793_100_000_000_000n,
  totalFundRaisingB: 626_437_243n,
  migrateType: MIGRATE_TYPE_CPMM,
};
const STONK_DERIVED = { virtualA: 1_073_025_606_002_985n, virtualB: 221_101_783n };

describe("borsh primitives", () => {
  it("writes integers little-endian and strings length-prefixed", () => {
    expect(new BorshWriter().u8(1).toBuffer()).toEqual(Buffer.from([1]));
    expect(new BorshWriter().u16(258).toBuffer()).toEqual(Buffer.from([0x02, 0x01]));
    expect(new BorshWriter().u64(1n).toBuffer()).toEqual(
      Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
    );
    expect(new BorshWriter().u64(2n ** 64n - 1n).toBuffer()).toEqual(Buffer.alloc(8, 0xff));
    // A u32 byte length, then the bytes. Not NUL-terminated, not padded.
    expect(new BorshWriter().string("ZEC").toBuffer()).toEqual(
      Buffer.from([3, 0, 0, 0, 0x5a, 0x45, 0x43]),
    );
    expect(new BorshWriter().string("").toBuffer()).toEqual(Buffer.from([0, 0, 0, 0]));
    // Multi-byte characters are counted in bytes, not code points.
    expect(new BorshWriter().string("é").toBuffer()).toEqual(Buffer.from([2, 0, 0, 0, 0xc3, 0xa9]));
  });

  it("refuses values that would silently truncate", () => {
    expect(() => new BorshWriter().u8(256)).toThrow(/out of range/);
    expect(() => new BorshWriter().u64(-1n)).toThrow(/out of range/);
    expect(() => new BorshWriter().u64(2n ** 64n)).toThrow(/out of range/);
  });
});

describe("PDA derivation", () => {
  it("derives the vault authority and event authority the program owns", () => {
    const pdas = launchLabAddresses({
      programId: PROGRAM,
      baseMint: BASE_MINT,
      quoteMint: ZEC_MINT,
    });
    // Read off mainnet: these are the accounts LaunchLab pools actually name.
    expect(pdas.authority.toBase58()).toBe("WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh");
    expect(pdas.eventAuthority.toBase58()).toBe("2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr");
  });

  it("derives the pool and its vaults from the pair, not from the creator", () => {
    const first = launchLabAddresses({
      programId: PROGRAM,
      baseMint: BASE_MINT,
      quoteMint: ZEC_MINT,
    });
    // This pool address was confirmed by a successful mainnet simulation of a
    // launch of this mint against this quote.
    expect(first.poolState.toBase58()).toBe("9dYz1gGE3Jj8ZGe2eNyUic1M9Wdv15KHswdsMaoN9Utf");
    expect(first.baseVault.toBase58()).not.toBe(first.quoteVault.toBase58());

    // The pair is ordered: swapping the mints is a different pool.
    const swapped = launchLabAddresses({
      programId: PROGRAM,
      baseMint: ZEC_MINT,
      quoteMint: BASE_MINT,
    });
    expect(swapped.poolState.toBase58()).not.toBe(first.poolState.toBase58());
  });

  it("derives the curve rule Stonk publishes", () => {
    expect(
      platformCurveRuleAddress({
        programId: PROGRAM,
        platformConfig: PLATFORM_CONFIG,
        globalConfig: GLOBAL_CONFIG,
      }).toBase58(),
    ).toBe(CURVE_RULE);
  });

  it("derives fee vaults per quote mint, separately for platform and creator", () => {
    const platform = platformFeeVaultAddress({
      programId: PROGRAM,
      platformConfig: PLATFORM_CONFIG,
      quoteMint: ZEC_MINT,
    });
    const creator = creatorFeeVaultAddress({
      programId: PROGRAM,
      creator: CREATOR,
      quoteMint: ZEC_MINT,
    });
    expect(platform.toBase58()).not.toBe(creator.toBase58());
    // A different quote asset accrues to a different vault.
    expect(
      creatorFeeVaultAddress({ programId: PROGRAM, creator: CREATOR, quoteMint: BASE_MINT }).toBase58(),
    ).not.toBe(creator.toBase58());
  });
});

describe("initialize_with_token_2022 encoding", () => {
  const args = {
    decimals: 6,
    name: "StampPad Proof",
    symbol: "SPPROOF",
    uri: "https://example.test/m.json",
    curve: STONK_CURVE,
    vesting: NO_VESTING,
    ammFeeOn: AMM_FEE_ON_QUOTE_TOKEN,
  };

  it("lays the data out exactly as the program's schema reads it", () => {
    const data = encodeInitializeWithToken2022Data(args);
    const u64 = (value: bigint) => {
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64LE(value);
      return buf;
    };
    const str = (text: string) => {
      const bytes = Buffer.from(text, "utf8");
      const len = Buffer.alloc(4);
      len.writeUInt32LE(bytes.length);
      return Buffer.concat([len, bytes]);
    };
    const expected = Buffer.concat([
      Buffer.from(INITIALIZE_WITH_TOKEN_2022_DISCRIMINATOR),
      Buffer.from([6]),
      str("StampPad Proof"),
      str("SPPROOF"),
      str("https://example.test/m.json"),
      Buffer.from([CURVE_CONSTANT]),
      u64(STONK_CURVE.supply),
      u64(STONK_CURVE.totalSellA),
      u64(STONK_CURVE.totalFundRaisingB),
      Buffer.from([MIGRATE_TYPE_CPMM]),
      u64(0n),
      u64(0n),
      u64(0n),
      Buffer.from([AMM_FEE_ON_QUOTE_TOKEN]),
      // Option::None for the transfer-fee extension: the tag alone. A standard
      // Stonk launch carries no extension, and the curve rule requires that.
      Buffer.from([0]),
    ]);
    expect(data.toString("hex")).toBe(expected.toString("hex"));
  });

  it("starts with the discriminator from the program's IDL", () => {
    expect([...encodeInitializeWithToken2022Data(args).subarray(0, 8)]).toEqual([
      37, 190, 126, 222, 44, 154, 171, 17,
    ]);
  });

  it("refuses arguments the program or Metaplex would reject", () => {
    expect(() => encodeInitializeWithToken2022Data({ ...args, name: "x".repeat(33) })).toThrow(
      /Name must be at most 32/,
    );
    expect(() => encodeInitializeWithToken2022Data({ ...args, symbol: "x".repeat(11) })).toThrow(
      /Symbol must be at most 10/,
    );
    expect(() => encodeInitializeWithToken2022Data({ ...args, uri: "x".repeat(201) })).toThrow(
      /URI must be at most 200/,
    );
    expect(() =>
      encodeInitializeWithToken2022Data({
        ...args,
        curve: { ...STONK_CURVE, totalSellA: STONK_CURVE.supply },
      }),
    ).toThrow(/Supply must exceed/);
    expect(() =>
      encodeInitializeWithToken2022Data({
        ...args,
        curve: { ...STONK_CURVE, totalFundRaisingB: 0n },
      }),
    ).toThrow(/raise must be positive/);
  });
});

describe("initialize_with_token_2022 accounts", () => {
  const build = (curveRule?: string) =>
    initializeWithToken2022Instruction({
      programId: PROGRAM,
      payer: CREATOR,
      creator: CREATOR,
      globalConfig: GLOBAL_CONFIG,
      platformConfig: PLATFORM_CONFIG,
      baseMint: BASE_MINT,
      quoteMint: ZEC_MINT,
      quoteTokenProgram: new PublicKey(TOKEN_PROGRAM_ID),
      platformCurveRule: curveRule ? new PublicKey(curveRule) : undefined,
      args: {
        decimals: 6,
        name: "N",
        symbol: "S",
        uri: "https://e.test/m",
        curve: STONK_CURVE,
        vesting: NO_VESTING,
        ammFeeOn: AMM_FEE_ON_QUOTE_TOKEN,
      },
    });

  it("orders the accounts the way the program reads them", () => {
    const pdas = launchLabAddresses({ programId: PROGRAM, baseMint: BASE_MINT, quoteMint: ZEC_MINT });
    expect(build().keys.map((key) => key.pubkey.toBase58())).toEqual([
      CREATOR.toBase58(),
      CREATOR.toBase58(),
      GLOBAL_CONFIG.toBase58(),
      PLATFORM_CONFIG.toBase58(),
      pdas.authority.toBase58(),
      pdas.poolState.toBase58(),
      BASE_MINT.toBase58(),
      ZEC_MINT.toBase58(),
      pdas.baseVault.toBase58(),
      pdas.quoteVault.toBase58(),
      TOKEN_2022_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      SystemProgram.programId.toBase58(),
      pdas.eventAuthority.toBase58(),
      PROGRAM.toBase58(),
    ]);
  });

  it("makes the payer and the new mint the only signers", () => {
    const signers = build()
      .keys.filter((key) => key.isSigner)
      .map((key) => key.pubkey.toBase58());
    // The mint signs because the program is creating it. The creator account is
    // named but does not sign, so fees can be forwarded to a wallet that is not
    // paying.
    expect(signers).toEqual([CREATOR.toBase58(), BASE_MINT.toBase58()]);
  });

  it("writes only the accounts it creates or mutates", () => {
    const pdas = launchLabAddresses({ programId: PROGRAM, baseMint: BASE_MINT, quoteMint: ZEC_MINT });
    expect(
      build()
        .keys.filter((key) => key.isWritable)
        .map((key) => key.pubkey.toBase58()),
    ).toEqual([
      CREATOR.toBase58(),
      pdas.poolState.toBase58(),
      BASE_MINT.toBase58(),
      pdas.baseVault.toBase58(),
      pdas.quoteVault.toBase58(),
    ]);
  });

  it("appends the curve rule last and read-only", () => {
    const keys = build(CURVE_RULE).keys;
    expect(keys).toHaveLength(16);
    const last = keys[keys.length - 1];
    expect(last.pubkey.toBase58()).toBe(CURVE_RULE);
    expect(last.isSigner).toBe(false);
    expect(last.isWritable).toBe(false);
  });

  it("omits the curve rule when there is none to attach", () => {
    expect(build().keys).toHaveLength(15);
  });
});

describe("buy_exact_in", () => {
  const build = () =>
    buyExactInInstruction({
      programId: PROGRAM,
      payer: CREATOR,
      creator: CREATOR,
      globalConfig: GLOBAL_CONFIG,
      platformConfig: PLATFORM_CONFIG,
      baseMint: BASE_MINT,
      quoteMint: ZEC_MINT,
      userBaseToken: new PublicKey("H9vXzuu9tF17xMScuqPBm5esZtqRBjLL6xq4V9hZDDmi"),
      userQuoteToken: new PublicKey("3pDpC7rRmrPRPvGRaGLJH8wzRUc4B1vHVZ574xPp82BB"),
      quoteTokenProgram: new PublicKey(TOKEN_PROGRAM_ID),
      args: { amountIn: 1_000_000n, minimumAmountOut: 1n, shareFeeRate: 0n },
    });

  it("encodes three u64 arguments after the discriminator", () => {
    const data = encodeBuyExactInData({
      amountIn: 1_000_000n,
      minimumAmountOut: 2n,
      shareFeeRate: 0n,
    });
    expect(data).toHaveLength(8 + 24);
    expect([...data.subarray(0, 8)]).toEqual([...BUY_EXACT_IN_DISCRIMINATOR]);
    expect(data.readBigUInt64LE(8)).toBe(1_000_000n);
    expect(data.readBigUInt64LE(16)).toBe(2n);
    expect(data.readBigUInt64LE(24)).toBe(0n);
  });

  it("carries the three accounts the IDL omits, in order, after the named ones", () => {
    const keys = build().keys;
    expect(keys).toHaveLength(18);
    expect(keys.slice(15).map((key) => key.pubkey.toBase58())).toEqual([
      SystemProgram.programId.toBase58(),
      platformFeeVaultAddress({
        programId: PROGRAM,
        platformConfig: PLATFORM_CONFIG,
        quoteMint: ZEC_MINT,
      }).toBase58(),
      creatorFeeVaultAddress({ programId: PROGRAM, creator: CREATOR, quoteMint: ZEC_MINT }).toBase58(),
    ]);
    // Both fee vaults are credited, so both must be writable.
    expect(keys[16].isWritable).toBe(true);
    expect(keys[17].isWritable).toBe(true);
  });

  it("names the base mint's program as Token-2022 and the quote's as given", () => {
    const keys = build().keys;
    expect(keys[11].pubkey.toBase58()).toBe(TOKEN_2022_PROGRAM_ID);
    expect(keys[12].pubkey.toBase58()).toBe(TOKEN_PROGRAM_ID);
  });

  it("asks only the payer to sign", () => {
    expect(build().keys.filter((key) => key.isSigner).map((key) => key.pubkey.toBase58())).toEqual([
      CREATOR.toBase58(),
    ]);
  });
});

describe("constant product curve", () => {
  it("reproduces the virtual reserves the venue reports", () => {
    expect(constantCurveReserves(STONK_CURVE)).toEqual(STONK_DERIVED);
  });

  it("refuses parameters that have no curve", () => {
    expect(() =>
      constantCurveReserves({ ...STONK_CURVE, totalSellA: STONK_CURVE.supply }),
    ).toThrow(/Supply must exceed/);
    expect(() =>
      constantCurveReserves({ ...STONK_CURVE, totalFundRaisingB: 1n, migrateFee: 1n }),
    ).toThrow(/must exceed the migrate fee/);
  });

  it("takes the total fee off the input before swapping", () => {
    // 0.01 ZEC in, at the 0.25% protocol and 1% platform rates the configs hold.
    const result = constantCurveBuyExactIn({
      ...STONK_DERIVED,
      amountIn: 1_000_000n,
      protocolFeeRate: 2500n,
      platformFeeRate: 10_000n,
      creatorFeeRate: 0n,
      totalSellA: STONK_CURVE.totalSellA,
    });
    expect(result.feeIn).toBe(12_500n);
    expect(result.amountOut).toBe(4_771_111_742_154n);

    // A zero fee rate buys strictly more for the same input.
    const free = constantCurveBuyExactIn({
      ...STONK_DERIVED,
      amountIn: 1_000_000n,
      protocolFeeRate: 0n,
      platformFeeRate: 0n,
      creatorFeeRate: 0n,
      totalSellA: STONK_CURVE.totalSellA,
    });
    expect(free.feeIn).toBe(0n);
    expect(free.amountOut).toBeGreaterThan(result.amountOut);
  });

  it("rounds the fee up, so the fee is never understated", () => {
    const result = constantCurveBuyExactIn({
      ...STONK_DERIVED,
      amountIn: 1n,
      protocolFeeRate: 2500n,
      platformFeeRate: 10_000n,
      creatorFeeRate: 0n,
      totalSellA: STONK_CURVE.totalSellA,
    });
    expect(result.feeIn).toBe(1n);
    expect(result.amountOut).toBe(0n);
  });

  it("cannot sell more than the curve holds", () => {
    const result = constantCurveBuyExactIn({
      ...STONK_DERIVED,
      amountIn: 10n ** 18n,
      protocolFeeRate: 0n,
      platformFeeRate: 0n,
      creatorFeeRate: 0n,
      totalSellA: STONK_CURVE.totalSellA,
    });
    expect(result.amountOut).toBe(STONK_CURVE.totalSellA);
  });
});

describe("config accounts, decoded from captured mainnet bytes", () => {
  const bytes = (key: keyof typeof fixtures.accounts) =>
    Buffer.from(fixtures.accounts[key].base64, "base64");

  it("reads the global config Stonk names for the ZEC pair", () => {
    const config = decodeGlobalConfig(bytes("globalConfig"));
    expect(config.curveType).toBe(0);
    expect(config.quoteMint).toBe("A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS");
    // 2500 millionths is the 0.25% protocol share of every trade.
    expect(config.tradeFeeRate).toBe(2500n);
    // Referral shares are capped off entirely on this config.
    expect(config.maxShareFeeRate).toBe(0n);
  });

  it("reads Stonk's platform config, including that it enforces its curve", () => {
    const config = decodePlatformConfig(bytes("platformConfig"));
    expect(config.name).toBe("StonkFun");
    expect(config.web).toBe("https://www.stonkfun.xyz");
    expect(config.feeRate).toBe(10_000n);
    expect(config.creatorFeeRate).toBe(0n);
    // Enforcement is on, which is why the curve rule must be attached.
    expect(config.restrictCurveParam).toBe(1);
    expect(config.restrictGlobalConfig).toBe(0);
  });

  it("refuses a layout it does not recognise rather than reading garbage", () => {
    expect(() => decodeGlobalConfig(Buffer.alloc(100))).toThrow(/Refusing to read a layout/);
    expect(() => decodePlatformConfig(bytes("globalConfig"))).toThrow(/Refusing to read a layout/);
  });
});
