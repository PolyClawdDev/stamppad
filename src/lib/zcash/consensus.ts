/**
 * Consensus branch IDs and the heights they activate at.
 *
 * A v5 transaction names its branch ID in the header and again in the
 * personalization of every digest, so getting it wrong does not produce a
 * rejected transaction with a clear error: it produces a transaction whose
 * signatures verify against nothing and which no node will relay. The branch ID
 * is also the replay protection between forks, which is the reason it exists.
 *
 * The table is taken from zebra-chain, not from zcashd, because zcashd's
 * upgrades.cpp lagged behind: at the time of writing it stops at NU6.2 while
 * mainnet had already activated NU6.3 (Ironwood) at height 3,428,143. The
 * reference stamp at height 3,490,084 carries branch ID 0x37a5165b, which is
 * NU6.3, and tests/zcash-transaction.test.ts asserts that this table maps that
 * height to that value. If it did not, our transactions would be unspendable.
 *
 * Sources:
 *   zebra-chain/src/parameters/network_upgrade.rs  (branch IDs)
 *   zebra-chain/src/parameters/constants.rs        (activation heights)
 */

export type ZcashNetwork = "zcash:main" | "zcash:test";

export interface NetworkUpgrade {
  name: string;
  branchId: number;
  activationHeight: number;
}

/** Ordered by activation height, oldest first. Only v5-capable epochs matter here. */
const MAINNET: NetworkUpgrade[] = [
  { name: "Overwinter", branchId: 0x5ba81b19, activationHeight: 347_500 },
  { name: "Sapling", branchId: 0x76b809bb, activationHeight: 419_200 },
  { name: "Blossom", branchId: 0x2bb40e60, activationHeight: 653_600 },
  { name: "Heartwood", branchId: 0xf5b9230b, activationHeight: 903_000 },
  { name: "Canopy", branchId: 0xe9ff75a6, activationHeight: 1_046_400 },
  { name: "NU5", branchId: 0xc2d6d0b4, activationHeight: 1_687_104 },
  { name: "NU6", branchId: 0xc8e71055, activationHeight: 2_726_400 },
  { name: "NU6.1", branchId: 0x4dec4df0, activationHeight: 3_146_400 },
  { name: "NU6.2", branchId: 0x5437f330, activationHeight: 3_364_600 },
  { name: "NU6.3", branchId: 0x37a5165b, activationHeight: 3_428_143 },
];

const TESTNET: NetworkUpgrade[] = [
  { name: "Overwinter", branchId: 0x5ba81b19, activationHeight: 207_500 },
  { name: "Sapling", branchId: 0x76b809bb, activationHeight: 280_000 },
  { name: "Blossom", branchId: 0x2bb40e60, activationHeight: 584_000 },
  { name: "Heartwood", branchId: 0xf5b9230b, activationHeight: 903_800 },
  { name: "Canopy", branchId: 0xe9ff75a6, activationHeight: 1_028_500 },
  { name: "NU5", branchId: 0xc2d6d0b4, activationHeight: 1_842_420 },
  { name: "NU6", branchId: 0xc8e71055, activationHeight: 2_976_000 },
  { name: "NU6.1", branchId: 0x4dec4df0, activationHeight: 3_536_500 },
  { name: "NU6.2", branchId: 0x5437f330, activationHeight: 4_052_000 },
  { name: "NU6.3", branchId: 0x37a5165b, activationHeight: 4_134_000 },
];

export function upgradeSchedule(network: ZcashNetwork): readonly NetworkUpgrade[] {
  return network === "zcash:test" ? TESTNET : MAINNET;
}

/** The epoch a block belongs to. Throws below NU5, where v5 does not exist. */
export function upgradeForHeight(height: number, network: ZcashNetwork = "zcash:main"): NetworkUpgrade {
  if (!Number.isInteger(height) || height < 0) throw new Error("block height must be a non-negative integer");
  const schedule = upgradeSchedule(network);
  let current: NetworkUpgrade | null = null;
  for (const upgrade of schedule) {
    if (height >= upgrade.activationHeight) current = upgrade;
  }
  if (!current) throw new Error(`height ${height} predates Overwinter; v5 transactions do not exist there`);
  return current;
}

export function consensusBranchId(height: number, network: ZcashNetwork = "zcash:main"): number {
  const upgrade = upgradeForHeight(height, network);
  if (upgrade.activationHeight < upgradeSchedule(network).find((u) => u.name === "NU5")!.activationHeight) {
    throw new Error(
      `height ${height} is in the ${upgrade.name} epoch, which predates NU5; StampPad only builds v5 transactions`,
    );
  }
  return upgrade.branchId;
}

/**
 * A branch ID we know a name for. Used to refuse building against an epoch this
 * build has never heard of rather than guessing, because an unknown branch ID
 * from a node means the table above is stale and the transaction would be
 * bound to the wrong fork.
 */
export function upgradeNameForBranchId(branchId: number, network: ZcashNetwork = "zcash:main"): string | null {
  return upgradeSchedule(network).find((u) => u.branchId === branchId)?.name ?? null;
}

/**
 * How far ahead of the tip to set nExpiryHeight. Zcash expires transactions so
 * an unmined one stops being a liability; 40 blocks is the zcashd default and
 * matches the reference stamp, whose expiry was 39 blocks past its own height.
 */
export const DEFAULT_EXPIRY_DELTA = 40;

/** A transaction with this expiry never expires. Refused here: a stuck stamp must die. */
export const NO_EXPIRY = 0;
