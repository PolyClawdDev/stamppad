export type StampMode = "demo" | "testnet" | "mainnet";
export type StoreKind = "memory" | "postgres";

export function stampMode(): StampMode {
  const raw = (process.env.STAMP_MODE ?? process.env.NEXT_PUBLIC_STAMP_MODE ?? "demo").toLowerCase();
  if (raw === "testnet" || raw === "mainnet") return raw;
  return "demo";
}

/**
 * A connection string is the whole configuration. Attaching a database to a
 * deployment sets DATABASE_URL and nothing else, so requiring a second opt-in
 * variable meant the durable store was never chosen and every launch went to a
 * temp file that the next request could not see. STAMP_STORE stays as an
 * override for the case of a database being present but deliberately unused.
 */
export function storeKind(): StoreKind {
  if (process.env.STAMP_STORE === "memory") return "memory";
  if (process.env.STAMP_STORE === "postgres") return "postgres";
  return process.env.DATABASE_URL ? "postgres" : "memory";
}

export function flags() {
  return {
    mode: stampMode(),
    store: storeKind(),
    stonkReadLive: process.env.STAMP_STONK_READ_LIVE === "true",
    allowLiveLaunch: process.env.STAMP_ALLOW_LIVE_LAUNCH === "true",
    allowLiveBurns: process.env.STAMP_ALLOW_LIVE_BURNS === "true",
    allowLiveZcashPublish: process.env.STAMP_ALLOW_LIVE_ZCASH_PUBLISH === "true",
    allowLiveStampSales: process.env.STAMP_ALLOW_LIVE_STAMP_SALES === "true",
    stonkApiBase: process.env.STONK_API_BASE ?? "https://www.stonkfun.xyz/api/public/v1",
    solanaRpc: process.env.SOLANA_RPC_URL ?? "",
    zcashRpc: process.env.ZCASH_RPC_URL ?? "",
    zcashMinConfirmations: Number(process.env.ZCASH_MIN_CONFIRMATIONS ?? 10),
    sourceNetwork:
      stampMode() === "demo"
        ? "solana:demo"
        : stampMode() === "testnet"
          ? "solana:devnet"
          : "solana:mainnet-beta",
    destNetwork:
      stampMode() === "demo" ? "zcash:demo" : stampMode() === "testnet" ? "zcash:test" : "zcash:main",
  } as const;
}

/**
 * Whether a kind of real money movement is permitted, and why not when it is
 * not. Demo mode moves nothing, so nothing is blocked there; outside demo, each
 * kind is off until its own flag is set, and the flag is the operator approval.
 */
export function liveMoneyMovementBlocked(
  kind: "launch" | "burn" | "publish" | "stampSale",
): string | null {
  const f = flags();
  if (f.mode === "demo") return null;
  switch (kind) {
    case "stampSale":
      return f.allowLiveStampSales
        ? null
        : "Live stamp sales are disabled. Settlement depends on ZIP-300 style HTLCs whose wallet support and dispute handling are unverified; see docs/EVIDENCE.md.";
    case "launch":
      return f.allowLiveLaunch
        ? null
        : "Live launches are disabled. A launch creates a real mint on Solana mainnet and spends the creator's own SOL and quote asset, so it is off until STAMP_ALLOW_LIVE_LAUNCH is set.";
    case "burn":
      return f.allowLiveBurns
        ? null
        : "Live burns are disabled. A burn destroys tokens permanently and cannot be undone, so it is off until STAMP_ALLOW_LIVE_BURNS is set.";
    case "publish":
      return f.allowLiveZcashPublish
        ? null
        : "Live Zcash publication is disabled. It needs an isolated publisher key, a node, and explicit approval to spend ZEC fees.";
  }
}
