import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import {
  decodeRecord,
  demoAddressForKey,
  encodeRecord,
  hashLockFor,
  offerArtifactHash,
  offerPreimage,
  resolveOwnership,
  toHex,
  transferArtifactHash,
  transferPreimage,
  OP_RETURN_DATA_LIMIT,
  type CanonicalRecord,
  type SettlementOffer,
  type TransferAuthorization,
} from "../src/lib/protocol";

const STAMP = "ab".repeat(32);

function identity(seed: string) {
  const kp = nacl.sign.keyPair.fromSeed(Buffer.alloc(32, seed));
  const publicKeyHex = toHex(kp.publicKey);
  return {
    publicKeyHex,
    secret: kp.secretKey,
    address: demoAddressForKey(publicKeyHex),
  };
}

const alice = identity("a");
const bob = identity("b");
const mallory = identity("m");

function sign(secret: Uint8Array, preimage: string): string {
  return toHex(nacl.sign.detached(new TextEncoder().encode(preimage), secret));
}

function authorize(input: {
  from: ReturnType<typeof identity>;
  to: string;
  sequence: number;
  offerHashHex?: string;
  preimageHex?: string;
  stamp?: string;
}): TransferAuthorization {
  const unsigned = {
    stampCommitmentHex: input.stamp ?? STAMP,
    sequence: input.sequence,
    fromAddress: input.from.address,
    toAddress: input.to,
    offerHashHex: input.offerHashHex ?? "none",
    preimageHex: input.preimageHex ?? "none",
  };
  return {
    ...unsigned,
    ownerPublicKeyHex: input.from.publicKeyHex,
    signatureHex: sign(input.from.secret, transferPreimage(unsigned)),
  };
}

function offerFor(input: {
  seller: ReturnType<typeof identity>;
  buyer: string;
  sequence: number;
  hashLockHex: string;
  priceZat?: string;
}): SettlementOffer {
  const unsigned = {
    stampCommitmentHex: STAMP,
    sequence: input.sequence,
    sellerAddress: input.seller.address,
    buyerAddress: input.buyer,
    priceZat: input.priceZat ?? "100000",
    hashLockHex: input.hashLockHex,
    expiryHeight: 500,
  };
  return {
    ...unsigned,
    ownerPublicKeyHex: input.seller.publicKeyHex,
    signatureHex: sign(input.seller.secret, offerPreimage(unsigned)),
  };
}

function record(input: {
  kind: "transfer" | "offer";
  sequence: number;
  artifactHashHex: string;
  txid: string;
  height?: number;
  confirmations?: number;
  inBestChain?: boolean;
  stamp?: string;
}): CanonicalRecord {
  return {
    txid: input.txid,
    height: input.height ?? 200,
    outputIndex: 1,
    confirmations: input.confirmations ?? 6,
    inBestChain: input.inBestChain ?? true,
    network: "zcash:demo",
    record: {
      kind: input.kind,
      stampCommitmentHex: input.stamp ?? STAMP,
      sequence: input.sequence,
      artifactHashHex: input.artifactHashHex,
    },
  };
}

function resolve(records: CanonicalRecord[], artifacts: {
  transfers?: TransferAuthorization[];
  offers?: SettlementOffer[];
  originalRecipient?: string;
}) {
  return resolveOwnership({
    destinationNetwork: "zcash:demo",
    minConfirmations: 2,
    stamps: [
      { commitmentHex: STAMP, originalRecipient: artifacts.originalRecipient ?? alice.address },
    ],
    records,
    transferArtifacts: artifacts.transfers ?? [],
    offerArtifacts: artifacts.offers ?? [],
  });
}

describe("ownership records", () => {
  it("fits an ownership record inside the relayable OP_RETURN budget", () => {
    const encoded = encodeRecord({
      kind: "transfer",
      stampCommitmentHex: STAMP,
      sequence: 1,
      artifactHashHex: "cd".repeat(32),
    });
    expect(encoded.length).toBeLessThanOrEqual(OP_RETURN_DATA_LIMIT);
    expect(decodeRecord(encoded)?.sequence).toBe(1);
  });

  it("moves ownership on a signed transfer from the current owner", () => {
    const auth = authorize({ from: alice, to: bob.address, sequence: 1 });
    const out = resolve(
      [record({ kind: "transfer", sequence: 1, artifactHashHex: toHex(transferArtifactHash(auth)), txid: "t1" })],
      { transfers: [auth] },
    );
    expect(out.stamps[STAMP]!.currentOwner).toBe(bob.address);
    expect(out.stamps[STAMP]!.sequence).toBe(1);
    expect(out.rejected).toHaveLength(0);
  });

  it("refuses a transfer signed by someone other than the owner", () => {
    const forged = authorize({ from: mallory, to: mallory.address, sequence: 1 });
    const out = resolve(
      [record({ kind: "transfer", sequence: 1, artifactHashHex: toHex(transferArtifactHash(forged)), txid: "t1" })],
      { transfers: [forged] },
    );
    expect(out.stamps[STAMP]!.currentOwner).toBe(alice.address);
    expect(out.rejected[0]!.reason).toBe("unauthorized_transfer");
  });

  it("refuses an authorization whose recipient was substituted after signing", () => {
    const auth = authorize({ from: alice, to: bob.address, sequence: 1 });
    const committed = toHex(transferArtifactHash(auth));
    const swapped: TransferAuthorization = { ...auth, toAddress: mallory.address };
    const out = resolve(
      [record({ kind: "transfer", sequence: 1, artifactHashHex: committed, txid: "t1" })],
      { transfers: [swapped] },
    );
    // The substituted artifact no longer hashes to the committed record.
    expect(out.stamps[STAMP]!.currentOwner).toBe(alice.address);
    expect(out.pending[0]!.reason).toBe("authorization_unavailable");
  });

  it("refuses a replayed transfer at an already consumed sequence", () => {
    const first = authorize({ from: alice, to: bob.address, sequence: 1 });
    const hash = toHex(transferArtifactHash(first));
    const out = resolve(
      [
        record({ kind: "transfer", sequence: 1, artifactHashHex: hash, txid: "t1", height: 200 }),
        record({ kind: "transfer", sequence: 1, artifactHashHex: hash, txid: "t2", height: 201 }),
      ],
      { transfers: [first] },
    );
    expect(out.stamps[STAMP]!.history).toHaveLength(1);
    expect(out.rejected[0]!.reason).toBe("wrong_sequence");
  });

  it("ignores a record that is not confirmed or not in the best chain", () => {
    const auth = authorize({ from: alice, to: bob.address, sequence: 1 });
    const hash = toHex(transferArtifactHash(auth));
    const shallow = resolve(
      [record({ kind: "transfer", sequence: 1, artifactHashHex: hash, txid: "t1", confirmations: 1 })],
      { transfers: [auth] },
    );
    expect(shallow.stamps[STAMP]!.currentOwner).toBe(alice.address);
    expect(shallow.pending[0]!.reason).toBe("awaiting_confirmations");

    const orphaned = resolve(
      [record({ kind: "transfer", sequence: 1, artifactHashHex: hash, txid: "t1", inBestChain: false })],
      { transfers: [auth] },
    );
    expect(orphaned.stamps[STAMP]!.currentOwner).toBe(alice.address);
    expect(orphaned.pending[0]!.reason).toBe("not_in_best_chain");
  });

  it("settles a sale only when the transfer reveals the hash-lock preimage", () => {
    const secret = "11".repeat(32);
    const offer = offerFor({ seller: alice, buyer: bob.address, sequence: 1, hashLockHex: hashLockFor(secret) });
    const offerHash = toHex(offerArtifactHash(offer));
    const withoutSecret = authorize({ from: alice, to: bob.address, sequence: 1, offerHashHex: offerHash });
    const records = [
      record({ kind: "offer", sequence: 1, artifactHashHex: offerHash, txid: "o1", height: 200 }),
      record({
        kind: "transfer",
        sequence: 1,
        artifactHashHex: toHex(transferArtifactHash(withoutSecret)),
        txid: "t1",
        height: 201,
      }),
    ];
    const bad = resolve(records, { transfers: [withoutSecret], offers: [offer] });
    expect(bad.rejected[0]!.reason).toBe("hash_lock_unsatisfied");
    expect(bad.sales).toHaveLength(0);

    const good = authorize({
      from: alice,
      to: bob.address,
      sequence: 1,
      offerHashHex: offerHash,
      preimageHex: secret,
    });
    const ok = resolve(
      [
        records[0]!,
        record({
          kind: "transfer",
          sequence: 1,
          artifactHashHex: toHex(transferArtifactHash(good)),
          txid: "t2",
          height: 201,
        }),
      ],
      { transfers: [good], offers: [offer] },
    );
    expect(ok.sales).toHaveLength(1);
    expect(ok.sales[0]!.buyer).toBe(bob.address);
    expect(ok.stamps[STAMP]!.currentOwner).toBe(bob.address);
  });

  it("refuses a second sale of the same stamp at the same sequence", () => {
    const secret = "22".repeat(32);
    const first = offerFor({ seller: alice, buyer: bob.address, sequence: 1, hashLockHex: hashLockFor(secret) });
    const second = offerFor({
      seller: alice,
      buyer: mallory.address,
      sequence: 1,
      hashLockHex: hashLockFor(secret),
      priceZat: "999999",
    });
    const out = resolve(
      [
        record({ kind: "offer", sequence: 1, artifactHashHex: toHex(offerArtifactHash(first)), txid: "o1", height: 200 }),
        record({ kind: "offer", sequence: 1, artifactHashHex: toHex(offerArtifactHash(second)), txid: "o2", height: 201 }),
      ],
      { offers: [first, second] },
    );
    expect(out.rejected.filter((r) => r.reason === "conflicting_offer")).toHaveLength(1);
    expect(Object.keys(out.stamps[STAMP]!.boundOffers)).toEqual(["1"]);
  });

  it("refuses delivery to anyone other than the buyer named in the bound offer", () => {
    const secret = "33".repeat(32);
    const offer = offerFor({ seller: alice, buyer: bob.address, sequence: 1, hashLockHex: hashLockFor(secret) });
    const offerHash = toHex(offerArtifactHash(offer));
    const redirected = authorize({
      from: alice,
      to: mallory.address,
      sequence: 1,
      offerHashHex: offerHash,
      preimageHex: secret,
    });
    const out = resolve(
      [
        record({ kind: "offer", sequence: 1, artifactHashHex: offerHash, txid: "o1", height: 200 }),
        record({
          kind: "transfer",
          sequence: 1,
          artifactHashHex: toHex(transferArtifactHash(redirected)),
          txid: "t1",
          height: 201,
        }),
      ],
      { transfers: [redirected], offers: [offer] },
    );
    expect(out.rejected[0]!.reason).toBe("offer_mismatch");
    expect(out.stamps[STAMP]!.currentOwner).toBe(alice.address);
  });

  it("refuses ownership operations for a destination with no key binding", () => {
    const external = "t1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC";
    const auth = authorize({ from: alice, to: bob.address, sequence: 1 });
    const out = resolve(
      [record({ kind: "transfer", sequence: 1, artifactHashHex: toHex(transferArtifactHash(auth)), txid: "t1" })],
      { transfers: [auth], originalRecipient: external },
    );
    expect(out.stamps[STAMP]!.currentOwner).toBe(external);
    expect(out.rejected[0]!.reason).toBe("unauthorized_transfer");
  });

  it("is deterministic regardless of the order records arrive in", () => {
    const one = authorize({ from: alice, to: bob.address, sequence: 1 });
    const two = authorize({ from: bob, to: mallory.address, sequence: 2 });
    const records = [
      record({ kind: "transfer", sequence: 1, artifactHashHex: toHex(transferArtifactHash(one)), txid: "t1", height: 200 }),
      record({ kind: "transfer", sequence: 2, artifactHashHex: toHex(transferArtifactHash(two)), txid: "t2", height: 210 }),
    ];
    const forward = resolve(records, { transfers: [one, two] });
    const reversed = resolve([...records].reverse(), { transfers: [two, one] });
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(forward.stamps[STAMP]!.currentOwner).toBe(mallory.address);
  });
});
