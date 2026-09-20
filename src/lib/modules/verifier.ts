/**
 * Burn verifier. Fetches a transaction by (chain, signature) and hands it to
 * the pure protocol validator. It holds no keys and writes nothing.
 */
import { flags } from "../mode";
import {
  validateBurn,
  type CanonicalSolanaTx,
  type SourceNetwork,
  type ValidationResult,
} from "../protocol";
import type { DemoChainState } from "../solana/demo";

export interface BurnExpectation {
  mint: string;
  amountBase: bigint;
  decimals: number;
  destination: string;
}

export interface BurnVerifier {
  readonly kind: "demo" | "live";
  network(): SourceNetwork;
  fetch(signature: string): Promise<CanonicalSolanaTx | null>;
  verify(signature: string, expected: BurnExpectation): Promise<ValidationResult>;
}

export class DemoBurnVerifier implements BurnVerifier {
  readonly kind = "demo" as const;
  constructor(private readonly chain: DemoChainState) {}

  network(): SourceNetwork {
    return flags().sourceNetwork;
  }
  async fetch(signature: string) {
    return this.chain.txs[signature] ?? null;
  }
  async verify(signature: string, expected: BurnExpectation): Promise<ValidationResult> {
    const tx = await this.fetch(signature);
    if (!tx) {
      return {
        ok: false,
        reason: "solana_reorg",
        message: "Transaction is not present on the source chain.",
      };
    }
    const f = flags();
    return validateBurn(tx, {
      sourceNetwork: f.sourceNetwork,
      destinationNetwork: f.destNetwork,
      ...expected,
    });
  }
}

export class LiveBurnVerifier implements BurnVerifier {
  readonly kind = "live" as const;
  network(): SourceNetwork {
    return flags().sourceNetwork;
  }
  async fetch(): Promise<CanonicalSolanaTx | null> {
    throw new Error(
      "Live burn verification requires an RPC transaction decoder that this build does not ship. Set STAMP_MODE=demo.",
    );
  }
  async verify(): Promise<ValidationResult> {
    return this.fetch().then(() => ({
      ok: false as const,
      reason: "wrong_network" as const,
      message: "unreachable",
    }));
  }
}

export function verifierFor(chain: DemoChainState): BurnVerifier {
  return flags().mode === "demo" ? new DemoBurnVerifier(chain) : new LiveBurnVerifier();
}
