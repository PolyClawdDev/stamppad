/**
 * Stamp publisher. Writes protocol payloads to Zcash and nothing else: it never
 * decides validity, and it never touches Solana.
 */
import { flags } from "../mode";
import {
  encodeOpReturnPayload,
  encodeRecord,
  fromHex,
  type DestNetwork,
  type OnChainRecord,
  type ZcashPublication,
} from "../protocol";
import { assertLivePublishAllowed } from "../zcash/live";
import {
  estimatePublicationFeeZat,
  publishDemoRecord,
  publishDemoStamp,
  type DemoZcashChain,
} from "../zcash/demo";

export interface StampPublisher {
  readonly kind: "demo" | "live";
  network(): DestNetwork;
  feeZat(): bigint;
  publishIssuance(input: { destination: string; commitmentHex: string }): Promise<ZcashPublication>;
  publishRecord(input: {
    record: OnChainRecord;
    noticeAddress: string | null;
  }): Promise<ZcashPublication>;
}

export class DemoStampPublisher implements StampPublisher {
  readonly kind = "demo" as const;
  constructor(private readonly chain: DemoZcashChain) {}

  network(): DestNetwork {
    return flags().destNetwork;
  }
  feeZat(): bigint {
    return estimatePublicationFeeZat();
  }
  async publishIssuance(input: { destination: string; commitmentHex: string }) {
    return publishDemoStamp({
      chain: this.chain,
      network: this.network(),
      destination: input.destination,
      commitment: fromHex(input.commitmentHex),
    });
  }
  async publishRecord(input: { record: OnChainRecord; noticeAddress: string | null }) {
    return publishDemoRecord({
      chain: this.chain,
      network: this.network(),
      payload: encodeRecord(input.record),
      noticeAddress: input.noticeAddress,
    });
  }
}

/**
 * Live publisher. Kept as a boundary so the rest of the app never grows a
 * hidden fallback: every method refuses until a funded publisher key and an
 * explicit flag exist.
 */
export class LiveStampPublisher implements StampPublisher {
  readonly kind = "live" as const;
  network(): DestNetwork {
    return flags().destNetwork;
  }
  feeZat(): bigint {
    return estimatePublicationFeeZat();
  }
  async publishIssuance(input: { destination: string; commitmentHex: string }): Promise<ZcashPublication> {
    assertLivePublishAllowed();
    void encodeOpReturnPayload(fromHex(input.commitmentHex));
    throw new Error("Live Zcash publication is not implemented in this build.");
  }
  async publishRecord(input: { record: OnChainRecord; noticeAddress: string | null }): Promise<ZcashPublication> {
    assertLivePublishAllowed();
    void encodeRecord(input.record);
    throw new Error("Live Zcash publication is not implemented in this build.");
  }
}

export function publisherFor(chain: DemoZcashChain): StampPublisher {
  return flags().mode === "demo" ? new DemoStampPublisher(chain) : new LiveStampPublisher();
}
