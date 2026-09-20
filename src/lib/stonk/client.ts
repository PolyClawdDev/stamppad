import { flags } from "../mode";
import {
  FIXTURE_PAIRS,
  FIXTURE_PRICING,
  FIXTURE_RETRIEVED_AT,
  FIXTURE_SOURCE,
  FIXTURE_STATS,
} from "./fixtures";

export interface StonkPair {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string;
  category: string;
  categoryLabel: string;
  tokenProgram: string;
  launchable: boolean;
  symbolAmbiguous: boolean;
  launchLabReady: boolean | undefined;
}

export interface StonkStats {
  network: string;
  config: {
    paidLaunchesEnabled: boolean;
    launchLabEnabled: boolean;
    devBuysEnabled: boolean;
    apiLaunchesEnabled: boolean;
  };
}

export interface StonkPricing {
  quote: { mint: string; symbol: string; decimals: number; tokenProgram: string };
  raise: { raw: string; units: number };
  marketCap: { startUsd: number; graduationUsd: number };
  curve: {
    programId: string;
    configId: string;
    baseDecimals: number;
    supply: string;
    totalSellA: string;
    totalSupplyTokens: number;
    derived: { virtualA: string; virtualB: string };
  };
  platform: { standard: string; reward: string };
}

export interface StonkToken {
  mint: string;
  name?: string;
  symbol?: string;
  launchpad?: string;
  [key: string]: unknown;
}

class StonkError extends Error {
  constructor(
    message: string,
    readonly code = "stonk_error",
  ) {
    super(message);
  }
}

async function stonkGet<T>(path: string): Promise<T> {
  const base = flags().stonkApiBase.replace(/\/$/, "");
  const response = await fetch(`${base}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const text = await response.text();
  let body: { data?: T; error?: { code?: string; message?: string } };
  try {
    body = JSON.parse(text) as { data?: T; error?: { code?: string; message?: string } };
  } catch {
    throw new StonkError(
      `Stonk ${path} returned non-JSON (HTTP ${response.status}). No fixture fallback.`,
      "invalid_response",
    );
  }
  if (!response.ok || body.error) {
    throw new StonkError(
      body.error?.message ?? `Stonk ${path} failed (${response.status})`,
      body.error?.code ?? "http_error",
    );
  }
  if (body.data === undefined) {
    throw new StonkError(`Stonk ${path} omitted data.`);
  }
  return body.data;
}

export async function getStats(): Promise<{ stats: StonkStats; source: string; retrievedAt: string }> {
  if (!flags().stonkReadLive) {
    return {
      stats: FIXTURE_STATS,
      source: `${FIXTURE_SOURCE}/stats (fixture ${FIXTURE_RETRIEVED_AT})`,
      retrievedAt: FIXTURE_RETRIEVED_AT,
    };
  }
  const data = await stonkGet<StonkStats>("/stats");
  return { stats: data, source: `${flags().stonkApiBase}/stats`, retrievedAt: new Date().toISOString() };
}

export async function getPairs(): Promise<{ pairs: StonkPair[]; source: string; retrievedAt: string }> {
  if (!flags().stonkReadLive) {
    return {
      pairs: FIXTURE_PAIRS,
      source: `${FIXTURE_SOURCE}/pairs (fixture ${FIXTURE_RETRIEVED_AT})`,
      retrievedAt: FIXTURE_RETRIEVED_AT,
    };
  }
  const data = await stonkGet<{ pairs: StonkPair[] }>("/pairs?launchable=true&launchLabReady=true");
  return {
    pairs: data.pairs,
    source: `${flags().stonkApiBase}/pairs`,
    retrievedAt: new Date().toISOString(),
  };
}

export async function getPricing(quoteMint: string): Promise<{
  pricing: StonkPricing;
  source: string;
  retrievedAt: string;
}> {
  if (!flags().stonkReadLive) {
    return {
      pricing: {
        ...FIXTURE_PRICING,
        quote: { ...FIXTURE_PRICING.quote, mint: quoteMint },
      },
      source: `${FIXTURE_SOURCE}/launchlab/pricing (fixture ${FIXTURE_RETRIEVED_AT})`,
      retrievedAt: FIXTURE_RETRIEVED_AT,
    };
  }
  const data = await stonkGet<StonkPricing>(
    `/launchlab/pricing?quoteMint=${encodeURIComponent(quoteMint)}`,
  );
  return {
    pricing: data,
    source: `${flags().stonkApiBase}/launchlab/pricing`,
    retrievedAt: new Date().toISOString(),
  };
}

export async function getToken(mint: string): Promise<{
  token: StonkToken | null;
  source: string;
  error?: string;
}> {
  if (!flags().stonkReadLive) {
    return { token: null, source: "fixture", error: "Live token reads are off. No fabricated token market is returned." };
  }
  try {
    const token = await stonkGet<StonkToken>(`/tokens/${encodeURIComponent(mint)}`);
    return { token, source: `${flags().stonkApiBase}/tokens/${mint}` };
  } catch (error) {
    return {
      token: null,
      source: `${flags().stonkApiBase}/tokens/${mint}`,
      error: error instanceof Error ? error.message : "token read failed",
    };
  }
}

export function stonkTokenUrl(mint: string): string {
  return `https://www.stonkfun.xyz/token/${mint}`;
}
