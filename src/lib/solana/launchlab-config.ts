/**
 * The LaunchLab config accounts, decoded.
 *
 * Stonk's pricing endpoint names a global config and a platform config; these
 * are the accounts themselves. Reading them is what turns the endpoint's
 * numbers into something checkable: the quote mint the config actually accepts,
 * the fee rates that decide what a dev buy really buys, and the two flags that
 * decide whether the platform's curve rule is required as a remaining account.
 *
 * Only the fields used are decoded, but they are decoded by walking the struct
 * from the start rather than by hardcoded offsets, so a field appearing earlier
 * than expected shows up as a length mismatch instead of as garbage.
 *
 * Pure functions over bytes. Tested against captured mainnet accounts.
 */
import { PublicKey } from "@solana/web3.js";

export const GLOBAL_CONFIG_SIZE = 371;
export const PLATFORM_CONFIG_SIZE = 944;

class Cursor {
  private offset = 8; // Anchor account discriminator.
  constructor(private readonly data: Buffer) {}

  u8(): number {
    const value = this.data.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }
  u16(): number {
    const value = this.data.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }
  u64(): bigint {
    const value = this.data.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }
  pubkey(): string {
    const value = new PublicKey(this.data.subarray(this.offset, this.offset + 32)).toBase58();
    this.offset += 32;
    return value;
  }
  /** A fixed-width, NUL-padded string field. */
  fixedString(width: number): string {
    const raw = this.data.subarray(this.offset, this.offset + width);
    this.offset += width;
    return raw.toString("utf8").replace(/\0+$/, "");
  }
  skip(bytes: number): void {
    this.offset += bytes;
  }
  get position(): number {
    return this.offset;
  }
}

export interface GlobalConfig {
  /** 0 constant product, 1 fixed price, 2 linear price. */
  curveType: number;
  index: number;
  migrateFee: bigint;
  /** The protocol's share of every trade, in millionths. */
  tradeFeeRate: bigint;
  maxShareFeeRate: bigint;
  minQuoteFundRaising: bigint;
  /** Only this quote mint may be paired against this config. */
  quoteMint: string;
}

export function decodeGlobalConfig(data: Buffer): GlobalConfig {
  if (data.length !== GLOBAL_CONFIG_SIZE) {
    throw new Error(
      `Global config is ${data.length} bytes, expected ${GLOBAL_CONFIG_SIZE}. Refusing to read a layout we do not recognise.`,
    );
  }
  const cursor = new Cursor(data);
  cursor.u64(); // epoch
  const curveType = cursor.u8();
  const index = cursor.u16();
  const migrateFee = cursor.u64();
  const tradeFeeRate = cursor.u64();
  const maxShareFeeRate = cursor.u64();
  cursor.u64(); // min_base_supply
  cursor.u64(); // max_lock_rate
  cursor.u64(); // min_base_sell_rate
  cursor.u64(); // min_base_migrate_rate
  const minQuoteFundRaising = cursor.u64();
  const quoteMint = cursor.pubkey();
  return { curveType, index, migrateFee, tradeFeeRate, maxShareFeeRate, minQuoteFundRaising, quoteMint };
}

export interface PlatformConfig {
  /** The platform's share of every trade, in millionths. */
  feeRate: bigint;
  /** The creator's share of every trade, in millionths. */
  creatorFeeRate: bigint;
  name: string;
  web: string;
  /** 1 when only an allowed global config may be used with this platform. */
  restrictGlobalConfig: number;
  /** 1 when the launch parameters must satisfy the platform's curve rule. */
  restrictCurveParam: number;
}

export function decodePlatformConfig(data: Buffer): PlatformConfig {
  if (data.length !== PLATFORM_CONFIG_SIZE) {
    throw new Error(
      `Platform config is ${data.length} bytes, expected ${PLATFORM_CONFIG_SIZE}. Refusing to read a layout we do not recognise.`,
    );
  }
  const cursor = new Cursor(data);
  cursor.u64(); // epoch
  cursor.pubkey(); // platform_fee_wallet
  cursor.pubkey(); // platform_nft_wallet
  cursor.u64(); // platform_scale
  cursor.u64(); // creator_scale
  cursor.u64(); // burn_scale
  const feeRate = cursor.u64();
  const name = cursor.fixedString(64);
  const web = cursor.fixedString(256);
  cursor.skip(256); // img
  cursor.pubkey(); // cpswap_config
  const creatorFeeRate = cursor.u64();
  cursor.pubkey(); // transfer_fee_extension_auth
  cursor.pubkey(); // platform_vesting_wallet
  cursor.u64(); // platform_vesting_scale
  cursor.pubkey(); // platform_cp_creator
  const restrictGlobalConfig = cursor.u8();
  const restrictCurveParam = cursor.u8();
  if (cursor.position !== PLATFORM_CONFIG_SIZE - 32 - 78) {
    throw new Error("Platform config layout drifted; refusing to read the enforcement flags.");
  }
  return { feeRate, creatorFeeRate, name, web, restrictGlobalConfig, restrictCurveParam };
}
