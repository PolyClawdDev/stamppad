/**
 * A stamp issued to someone's own transparent Zcash address used to be a dead
 * end: verifiable on chain, but unlistable and untransferable here, because
 * nothing could tell its holder from anyone who typed the address. These tests
 * cover the path that fixes it, end to end and through the rebuild.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";
import { convert } from "../src/lib/app";
import { indexFromStore } from "../src/lib/indexer";
import {
  stampWithOwnership,
  submitTransfer,
  tickDemoChain,
  transferChallenge,
} from "../src/lib/market";
import { walletAdapter } from "../src/lib/modules/wallet";
import { demoAddressForKey, encodeBase58, toHex } from "../src/lib/protocol";
import { getStore, setStoreForTests } from "../src/lib/store";
import { MemoryStore } from "../src/lib/store/memory";
import { launchFundedCoin } from "./helpers";
import { transparentIdentity } from "./taddr-signer";

function solanaIdentity(seed: string) {
  const kp = nacl.sign.keyPair.fromSeed(Buffer.alloc(32, seed));
  const publicKeyHex = toHex(kp.publicKey);
  return {
    solana: encodeBase58(kp.publicKey),
    publicKeyHex,
    address: demoAddressForKey(publicKeyHex),
  };
}

async function mintStampTo(destination: string, amountDisplay = "2") {
  const burner = solanaIdentity("burner");
  const coin = await launchFundedCoin(burner.solana);
  const job = await convert({
    mint: coin.mint,
    owner: burner.solana,
    amountDisplay,
    destination,
  });
  expect(job.state).toBe("confirmed");
  return job.commitmentHex!;
}

/** An ownership record only binds once the chain has confirmed it. */
async function confirmChain() {
  await tickDemoChain();
  await tickDemoChain();
}

/** stampWithOwnership takes the stored row, so look it up first. */
async function view(stampId: string) {
  const row = await getStore().getStamp(stampId);
  expect(row).toBeTruthy();
  return stampWithOwnership(row!);
}

beforeEach(() => {
  setStoreForTests(new MemoryStore(join(mkdtempSync(join(tmpdir(), "stamp-taddr-")), "s.json")));
});

describe("transparent address capability", () => {
  it("reports that a t-address can authorize, and how", () => {
    const holder = transparentIdentity();
    const capability = walletAdapter.capability(holder.address);
    expect(capability.canAuthorize).toBe(true);
    expect(capability.scheme).toBe("zcash-signmessage");
    expect(capability.reason).toContain("signmessage");
  });

  it("derives the same address from the key the holder signs with", () => {
    const holder = transparentIdentity();
    expect(walletAdapter.addressForKey(holder.publicKeyHex)).toBe(holder.address);
  });

  it("still refuses an address that commits to a script", () => {
    // t3 multisig: a signed message cannot speak for a script.
    const capability = walletAdapter.capability("t3Vz22vK5z2LcKEdg16Yv4FFfryYDoUY6qa");
    expect(capability.canAuthorize).toBe(false);
    expect(capability.scheme).toBe("none");
  });
});

describe("transferring a stamp held at a transparent address", () => {
  it("is marked transferable once issued", async () => {
    const holder = transparentIdentity();
    const stampId = await mintStampTo(holder.address);
    const stamp = await view(stampId);
    expect(stamp.currentOwner).toBe(holder.address);
    expect(stamp.transferable).toBe(true);
    // Listing needs the owner's key before any signature exists, which a
    // transparent holder cannot hand over yet, so the two differ on purpose.
    expect(stamp.listable).toBe(false);
    expect(stamp.listabilityNote).toContain("proof of control");
  });

  it("keeps a protocol-managed destination both transferable and listable", async () => {
    const managed = solanaIdentity("managed");
    const stampId = await mintStampTo(managed.address);
    const stamp = await view(stampId);
    expect(stamp.transferable).toBe(true);
    expect(stamp.listable).toBe(true);
  });

  it("moves ownership when the holder signs with their Zcash key", async () => {
    const holder = transparentIdentity();
    const recipient = transparentIdentity();
    const stampId = await mintStampTo(holder.address);

    const challenge = await transferChallenge({ stampId, toAddress: recipient.address });
    expect(challenge.currentOwner).toBe(holder.address);

    await submitTransfer({
      stampId,
      toAddress: recipient.address,
      signatureHex: holder.sign(challenge.preimage),
      publicKeyHex: holder.publicKeyHex,
    });
    await confirmChain();

    const stamp = await view(stampId);
    expect(stamp.currentOwner).toBe(recipient.address);
  });

  it("survives a deterministic rebuild with the same owner", async () => {
    const holder = transparentIdentity();
    const recipient = transparentIdentity();
    const stampId = await mintStampTo(holder.address);

    const challenge = await transferChallenge({ stampId, toAddress: recipient.address });
    await submitTransfer({
      stampId,
      toAddress: recipient.address,
      signatureHex: holder.sign(challenge.preimage),
      publicKeyHex: holder.publicKeyHex,
    });
    await confirmChain();

    // The rebuild re-verifies every signature from stored records. If it used a
    // different rule than the request path, the owner here would disagree.
    const rebuilt = await indexFromStore();
    expect(rebuilt.ownership.stamps[stampId]?.currentOwner).toBe(recipient.address);
    expect(
      rebuilt.ownership.rejected.filter((r) => r.stampCommitmentHex === stampId),
    ).toHaveLength(0);
  });

  it("refuses a transfer signed by a key that is not the holder's", async () => {
    const holder = transparentIdentity();
    const attacker = transparentIdentity();
    const recipient = transparentIdentity();
    const stampId = await mintStampTo(holder.address);

    const challenge = await transferChallenge({ stampId, toAddress: recipient.address });
    await expect(
      submitTransfer({
        stampId,
        toAddress: recipient.address,
        // A perfectly valid signature, just not from this address.
        signatureHex: attacker.sign(challenge.preimage),
        publicKeyHex: attacker.publicKeyHex,
      }),
    ).rejects.toThrow(/different address/i);

    const stamp = await view(stampId);
    expect(stamp.currentOwner).toBe(holder.address);
  });

  it("refuses a signature that covers a different recipient", async () => {
    const holder = transparentIdentity();
    const intended = transparentIdentity();
    const attacker = transparentIdentity();
    const stampId = await mintStampTo(holder.address);

    // The holder authorized a transfer to `intended`, not to `attacker`.
    const challenge = await transferChallenge({ stampId, toAddress: intended.address });
    const signature = holder.sign(challenge.preimage);

    await expect(
      submitTransfer({
        stampId,
        toAddress: attacker.address,
        signatureHex: signature,
        publicKeyHex: holder.publicKeyHex,
      }),
    ).rejects.toThrow();

    const stamp = await view(stampId);
    expect(stamp.currentOwner).toBe(holder.address);
  });

  it("refuses the same authorization twice", async () => {
    const holder = transparentIdentity();
    const recipient = transparentIdentity();
    const stampId = await mintStampTo(holder.address);

    const challenge = await transferChallenge({ stampId, toAddress: recipient.address });
    const signature = holder.sign(challenge.preimage);
    await submitTransfer({
      stampId,
      toAddress: recipient.address,
      signatureHex: signature,
      publicKeyHex: holder.publicKeyHex,
    });
    await confirmChain();

    // Replaying it would move the stamp at a sequence that is already spent.
    await expect(
      submitTransfer({
        stampId,
        toAddress: recipient.address,
        signatureHex: signature,
        publicKeyHex: holder.publicKeyHex,
      }),
    ).rejects.toThrow();
  });
});
