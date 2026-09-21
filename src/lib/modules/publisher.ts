/**
 * Stamp publisher. Writes protocol payloads to Zcash and nothing else: it never
 * decides validity, and it never touches Solana.
 */
import { flags } from "../mode";
import {
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
import {
  buildStamp,
  finalizeP2pkhInputs,
  finalizeReveal,
  planInscription,
  toRawHex,
} from "../zcash/inscribe";
import { loadPublisherKey } from "../zcash/publisher-key";
import { zcashRpcFromEnv } from "../zcash/rpc";
import { signDigestDer } from "../zcash/sign";

export interface IssuancePublication {
  destination: string;
  commitmentHex: string;
  mint: string;
  burn: string;
  amountBase: string;
}

export interface StampPublisher {
  readonly kind: "demo" | "live";
  network(): DestNetwork;
  feeZat(): bigint;
  publishIssuance(input: IssuancePublication): Promise<ZcashPublication>;
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
  async publishIssuance(input: IssuancePublication) {
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
  async publishIssuance(input: IssuancePublication): Promise<ZcashPublication> {
    await assertLivePublishAllowed();
    if (!input.mint || !input.burn || !input.amountBase) {
      throw new Error("A live stamp needs the mint, the burn signature and the amount.");
    }
    const key = loadPublisherKey();
    const rpc = zcashRpcFromEnv();
    const tip = await rpc.getChainTip();
    if (tip.network !== this.network()) {
      throw new Error(`ZCASH_RPC_URL is on ${tip.network}, expected ${this.network()}.`);
    }
    const utxos = await rpc.getUtxos([key.address]);
    const plan = planInscription({
      payload: {
        p: "stamp-exp",
        op: "mint",
        v: 0,
        mint: input.mint,
        burn: input.burn,
        amt: input.amountBase,
        to: input.destination,
      },
      revealPublicKey: key.publicKey,
      commitment: fromHex(input.commitmentHex),
      network: "zcash:main",
    });
    const pair = buildStamp({
      plan,
      utxos,
      changeAddress: key.address,
      tipHeight: tip.height,
      network: "zcash:main",
    });
    const commitTx = finalizeP2pkhInputs({
      unsigned: pair.commit,
      signatures: pair.commit.sighashes.map((digest) => ({
        signatureDer: signDigestDer(digest, key.scalar),
        publicKey: key.publicKey,
      })),
    });
    const revealTx = finalizeReveal({
      unsigned: pair.reveal,
      plan,
      signatureDer: signDigestDer(pair.reveal.sighashes[0]!, key.scalar),
    });
    await rpc.sendRawTransaction(toRawHex(commitTx));
    const revealTxid = await rpc.sendRawTransaction(toRawHex(revealTx));
    return {
      txid: revealTxid,
      network: this.network(),
      height: tip.height + 1,
      confirmations: 0,
      inBestChain: true,
      outputs: [{ index: 0, valueZat: plan.dustZat, address: input.destination, nullData: null }],
    };
  }
  async publishRecord(input: { record: OnChainRecord; noticeAddress: string | null }): Promise<ZcashPublication> {
    await assertLivePublishAllowed();
    void encodeRecord(input.record);
    void input.noticeAddress;
    throw new Error("Live ownership-record publication is not implemented in this build.");
  }
}

export function publisherFor(chain: DemoZcashChain): StampPublisher {
  return flags().mode === "demo" ? new DemoStampPublisher(chain) : new LiveStampPublisher();
}
