import { createHash } from "node:crypto";
import {
  DESTINATION_NOTICE_ZATOSHIS,
  ZIP317_GRACE_ACTIONS,
  ZIP317_MARGINAL_FEE,
  encodeOpReturnPayload,
  toHex,
  type DestNetwork,
  type ZcashPublication,
} from "../protocol";

export interface DemoHtlc {
  id: string;
  /** Simulated ZIP-300 style P2SH: hash lock with a CLTV refund branch. */
  scriptKind: "zip300-p2sh-htlc";
  amountZat: bigint;
  hashLockHex: string;
  expiryHeight: number;
  buyerAddress: string;
  sellerAddress: string;
  state: "locked" | "claimed" | "refunded";
  lockTxid: string;
  claimTxid: string | null;
  preimageHex: string | null;
}

export interface DemoZcashChain {
  height: number;
  fundedZat: bigint;
  txs: Record<string, ZcashPublication>;
  escrows: Record<string, DemoHtlc>;
}

export function emptyZcash(): DemoZcashChain {
  return { height: 100, fundedZat: 1_000_000_000n, txs: {}, escrows: {} };
}

export function estimatePublicationFeeZat(): bigint {
  // 1 transparent input + dest + OP_RETURN + change ≈ 5 logical actions (ZIP-317 r0).
  const logical = 5n;
  const actions = logical > ZIP317_GRACE_ACTIONS ? logical : ZIP317_GRACE_ACTIONS;
  return ZIP317_MARGINAL_FEE * actions;
}

export function publishDemoStamp(input: {
  chain: DemoZcashChain;
  network: DestNetwork;
  destination: string;
  commitment: Uint8Array;
  insufficientFunds?: boolean;
}): ZcashPublication {
  const fee = estimatePublicationFeeZat();
  const needed = fee + DESTINATION_NOTICE_ZATOSHIS;
  if (input.insufficientFunds || input.chain.fundedZat < needed) {
    throw Object.assign(new Error("Publisher ZEC balance is below ZIP-317 fee plus destination notice."), {
      code: "insufficient_publication_funds",
    });
  }
  input.chain.fundedZat -= needed;
  input.chain.height += 1;
  const payload = encodeOpReturnPayload(input.commitment);
  const body = Buffer.concat([
    Buffer.from(input.destination),
    Buffer.from(payload),
    Buffer.from(String(input.chain.height)),
  ]);
  const txid = createHash("sha256").update(body).digest("hex");
  const publication: ZcashPublication = {
    txid,
    network: input.network,
    height: input.chain.height,
    confirmations: 0,
    inBestChain: true,
    outputs: [
      { index: 0, valueZat: DESTINATION_NOTICE_ZATOSHIS, address: input.destination, nullData: null },
      { index: 1, valueZat: 0n, address: null, nullData: payload },
    ],
  };
  input.chain.txs[txid] = publication;
  return publication;
}

/**
 * Publishes an ownership record. Like the issuance publisher this writes a
 * single OP_RETURN output, which is all zebrad relays per transaction.
 */
export function publishDemoRecord(input: {
  chain: DemoZcashChain;
  network: DestNetwork;
  payload: Uint8Array;
  noticeAddress: string | null;
}): ZcashPublication {
  const fee = estimatePublicationFeeZat();
  const notice = input.noticeAddress ? DESTINATION_NOTICE_ZATOSHIS : 0n;
  if (input.chain.fundedZat < fee + notice) {
    throw Object.assign(new Error("Publisher ZEC balance is below the ZIP-317 fee for this record."), {
      code: "insufficient_publication_funds",
    });
  }
  input.chain.fundedZat -= fee + notice;
  input.chain.height += 1;
  const txid = createHash("sha256")
    .update(Buffer.concat([Buffer.from(input.payload), Buffer.from(String(input.chain.height))]))
    .digest("hex");
  const outputs = [];
  if (input.noticeAddress) {
    outputs.push({
      index: outputs.length,
      valueZat: DESTINATION_NOTICE_ZATOSHIS,
      address: input.noticeAddress,
      nullData: null,
    });
  }
  outputs.push({ index: outputs.length, valueZat: 0n, address: null, nullData: input.payload });
  const publication: ZcashPublication = {
    txid,
    network: input.network,
    height: input.chain.height,
    confirmations: 0,
    inBestChain: true,
    outputs,
  };
  input.chain.txs[txid] = publication;
  return publication;
}

export function lockDemoHtlc(input: {
  chain: DemoZcashChain;
  amountZat: bigint;
  hashLockHex: string;
  buyerAddress: string;
  sellerAddress: string;
  timeoutBlocks: number;
}): DemoHtlc {
  input.chain.height += 1;
  const lockTxid = createHash("sha256")
    .update(`${input.hashLockHex}:${input.buyerAddress}:${input.chain.height}`)
    .digest("hex");
  const htlc: DemoHtlc = {
    id: lockTxid.slice(0, 32),
    scriptKind: "zip300-p2sh-htlc",
    amountZat: input.amountZat,
    hashLockHex: input.hashLockHex,
    expiryHeight: input.chain.height + input.timeoutBlocks,
    buyerAddress: input.buyerAddress,
    sellerAddress: input.sellerAddress,
    state: "locked",
    lockTxid,
    claimTxid: null,
    preimageHex: null,
  };
  input.chain.escrows[htlc.id] = htlc;
  return htlc;
}

/** The seller claims by revealing the preimage, which the buyer then reuses in the transfer. */
export function claimDemoHtlc(chain: DemoZcashChain, id: string, preimageHex: string): DemoHtlc {
  const htlc = chain.escrows[id];
  if (!htlc) throw new Error("Unknown escrow.");
  if (htlc.state !== "locked") throw new Error(`Escrow is already ${htlc.state}.`);
  if (createHash("sha256").update(Buffer.from(preimageHex, "hex")).digest("hex") !== htlc.hashLockHex) {
    throw new Error("Preimage does not satisfy the hash lock.");
  }
  chain.height += 1;
  htlc.state = "claimed";
  htlc.preimageHex = preimageHex;
  htlc.claimTxid = createHash("sha256").update(`${htlc.id}:claim:${chain.height}`).digest("hex");
  return htlc;
}

export function refundDemoHtlc(chain: DemoZcashChain, id: string): DemoHtlc {
  const htlc = chain.escrows[id];
  if (!htlc) throw new Error("Unknown escrow.");
  if (htlc.state !== "locked") throw new Error(`Escrow is already ${htlc.state}.`);
  if (chain.height < htlc.expiryHeight) {
    throw new Error("CLTV refund branch is not spendable until the timeout height.");
  }
  htlc.state = "refunded";
  return htlc;
}

export function tickConfirmations(chain: DemoZcashChain, min: number): void {
  for (const tx of Object.values(chain.txs)) {
    if (tx.inBestChain) tx.confirmations += 1;
    if (tx.confirmations > min + 5) tx.confirmations = min + 5;
  }
}

export function orphanTx(chain: DemoZcashChain, txid: string): void {
  const tx = chain.txs[txid];
  if (tx) {
    tx.inBestChain = false;
    tx.confirmations = 0;
  }
}

export function payloadHex(commitment: Uint8Array): string {
  return toHex(encodeOpReturnPayload(commitment));
}
