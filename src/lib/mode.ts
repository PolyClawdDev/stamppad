export type StampMode = "demo" | "testnet" | "mainnet";
export type StoreKind = "memory" | "postgres";

export function stampMode(): StampMode {
  const raw = (process.env.STAMP_MODE ?? process.env.NEXT_PUBLIC_STAMP_MODE ?? "demo").toLowerCase();
  if (raw === "testnet" || raw === "mainnet") return raw;
  return "demo";
}

export function storeKind(): StoreKind {
  if (process.env.STAMP_STORE === "postgres" || process.env.DATABASE_URL) {
    if (process.env.STAMP_STORE === "memory") return "memory";
    if (process.env.STAMP_STORE === "postgres") return "postgres";
  }
  return process.env.STAMP_STORE === "postgres" ? "postgres" : "memory";
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

export function liveMoneyMovementBlocked(
  kind: "launch" | "burn" | "publish" | "stampSale",
): string | null {
  const f = flags();
  if (f.mode === "demo") return null;
  if (kind === "stampSale" && !f.allowLiveStampSales) {
    return "Live stamp sales are disabled. Settlement depends on ZIP-300 style HTLCs whose wallet support and dispute handling are unverified; see docs/EVIDENCE.md.";
  }
  if (kind === "launch" && !f.allowLiveLaunch) {
    return "Live launches are disabled. Stonk paid launches returned 503 on 2026-09-20; LaunchLab construction spends real funds and needs explicit approval.";
  }
  if (kind === "burn" && !f.allowLiveBurns) {
    return "Live burns are disabled. A burn permanently reduces supply and cannot be undone.";
  }
  if (kind === "publish" && !f.allowLiveZcashPublish) {
    return "Live Zcash publication is disabled. It needs an isolated publisher key, a node, and explicit approval to spend ZEC fees.";
  }
  if (f.mode === "mainnet") {
    return "Mainnet money movement is refused without operator approval in this build.";
  }
  return null;
}

export function demoBanner(): string {
  const f = flags();
  if (f.mode === "demo") return "DEMO LEDGER";
  if (f.mode === "testnet") return "TESTNET";
  return "MAINNET — live money movement disabled";
}
