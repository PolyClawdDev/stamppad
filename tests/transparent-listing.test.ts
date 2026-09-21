/**
 * Listing a stamp that was issued to someone's own transparent address.
 *
 * Transferring one already worked, because a transfer is itself a signature.
 * Listing could not, because a listing names the seller's key before any
 * signature over the sale exists, and trusting a claimed address would let
 * anyone create a listing in someone else's name. A stamp carries only one live
 * listing, so that alone would lock the real owner out.
 *
 * These tests drive the real route handlers over fabricated requests, with real
 * secp256k1 signatures from the test signer in taddr-signer.ts, and cover both
 * the proof itself and what the proof is bound to.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as issueNonce } from "../src/app/api/wallet/nonce/route";
import { DELETE as endSession } from "../src/app/api/wallet/session/route";
import {
  DELETE as revokeProofs,
  GET as readProofs,
  POST as proveAddress,
} from "../src/app/api/wallet/taddr/route";
import { POST as requestStatement } from "../src/app/api/wallet/taddr/challenge/route";
import { GET as readStamp } from "../src/app/api/stamps/[id]/route";
import { convert } from "../src/lib/app";
import { indexFromStore } from "../src/lib/indexer";
import {
  advanceListing,
  createListing,
  listingChallenge,
  reserveListing,
  tickDemoChain,
} from "../src/lib/market";
import { demoAddressForKey, encodeBase58, toHex } from "../src/lib/protocol";
import { sha256 } from "../src/lib/protocol/taddr";
import { getStore, setStoreForTests } from "../src/lib/store";
import { MemoryStore } from "../src/lib/store/memory";
import { SESSION_COOKIE, encodeSessionCookie } from "../src/lib/wallet/cookie";
import { buildAddressStatement, parseAddressStatement } from "../src/lib/wallet/taddr-proof";
import { launchFundedCoin } from "./helpers";
import { transparentIdentity, type TransparentIdentity } from "./taddr-signer";

const DOMAIN = "127.0.0.1:3502";
const ORIGIN = `http://${DOMAIN}`;

/**
 * A well-formed t3 multisig address. It commits to a script hash rather than to
 * one key, so no signed message can ever speak for it, and it has to be refused
 * for that reason rather than for a bad checksum.
 */
const MULTISIG = (() => {
  const payload = new Uint8Array(22);
  payload.set([0x1c, 0xbd]);
  payload.fill(9, 2);
  const full = new Uint8Array(26);
  full.set(payload);
  full.set(sha256(sha256(payload)).subarray(0, 4), 22);
  return encodeBase58(full);
})();

let sessions = 0;

/**
 * A verified wallet session, fabricated the way the session route writes one.
 * The Phantom half of this is covered in wallet-session.test.ts; what matters
 * here is which session a Zcash proof lands against.
 */
function walletSession(verifiedAt = new Date().toISOString()) {
  const keypair = nacl.sign.keyPair.fromSeed(Buffer.alloc(32, `taddr-session-${sessions++}`));
  const publicKey = encodeBase58(keypair.publicKey);
  return {
    publicKey,
    verifiedAt,
    cookie: `${SESSION_COOKIE}=${encodeSessionCookie({ publicKey, verifiedAt })}`,
  };
}

type WalletSession = ReturnType<typeof walletSession>;

function post(path: string, body: unknown, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      host: DOMAIN,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function get(path: string, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    headers: { host: DOMAIN, ...(cookie ? { cookie } : {}) },
  });
}

interface Reply {
  status: number;
  data: Record<string, never> & { [key: string]: unknown };
  error: { code: string; message: string } | null;
}

async function read(response: Response): Promise<Reply> {
  const json = (await response.json()) as { data?: unknown; error?: Reply["error"] };
  return {
    status: response.status,
    data: (json.data ?? {}) as Reply["data"],
    error: json.error ?? null,
  };
}

/** Asks for the statement this site wants signed for one address. */
async function statementFor(session: WalletSession, address: string): Promise<string> {
  const reply = await read(await requestStatement(post("/api/wallet/taddr/challenge", { address }, session.cookie)));
  expect(reply.error, reply.error?.message).toBeNull();
  return reply.data.statement as string;
}

/** The whole proof round trip: ask for a statement, sign it, present it. */
async function prove(session: WalletSession, holder: TransparentIdentity): Promise<Reply> {
  const statement = await statementFor(session, holder.address);
  return read(
    await proveAddress(
      post(
        "/api/wallet/taddr",
        { address: holder.address, message: statement, signature: holder.signBase64(statement) },
        session.cookie,
      ),
    ),
  );
}

async function freshNonce(): Promise<string> {
  const reply = await read(await issueNonce(post("/api/wallet/nonce", {})));
  return reply.data.nonce as string;
}

function solanaIdentity(seed: string) {
  const kp = nacl.sign.keyPair.fromSeed(Buffer.alloc(32, seed));
  const publicKeyHex = toHex(kp.publicKey);
  return {
    solana: encodeBase58(kp.publicKey),
    publicKeyHex,
    address: demoAddressForKey(publicKeyHex),
    sign: (preimage: string) => toHex(nacl.sign.detached(new TextEncoder().encode(preimage), kp.secretKey)),
  };
}

async function mintStampTo(destination: string): Promise<string> {
  const burner = solanaIdentity("taddr-listing-burner");
  const coin = await launchFundedCoin(burner.solana);
  const job = await convert({
    mint: coin.mint,
    owner: burner.solana,
    amountDisplay: "2",
    destination,
  });
  expect(job.state).toBe("confirmed");
  return job.commitmentHex!;
}

async function confirmChain() {
  await tickDemoChain();
  await tickDemoChain();
}

beforeEach(() => {
  setStoreForTests(new MemoryStore(join(mkdtempSync(join(tmpdir(), "stamp-listing-")), "s.json")));
});

describe("the statement a holder signs", () => {
  it("names this site, the connected wallet, the address and a single-use nonce", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const statement = await statementFor(session, holder.address);

    expect(statement).toContain("StampPad wants to check that you control this Zcash address.");
    expect(statement).toContain("StampPad never sees your Zcash key");

    const parsed = parseAddressStatement(statement);
    expect(parsed?.domain).toBe(DOMAIN);
    expect(parsed?.walletPublicKey).toBe(session.publicKey);
    expect(parsed?.address).toBe(holder.address);
    expect(parsed?.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is not issued at all without a connected wallet", async () => {
    const holder = transparentIdentity();
    const reply = await read(
      await requestStatement(post("/api/wallet/taddr/challenge", { address: holder.address })),
    );
    expect(reply.status).toBe(401);
    expect(reply.error?.code).toBe("no_session");
  });

  it("refuses a multisig address before sending anyone to their wallet", async () => {
    const reply = await read(
      await requestStatement(
        post("/api/wallet/taddr/challenge", { address: MULTISIG }, walletSession().cookie),
      ),
    );
    expect(reply.status).toBe(400);
    expect(reply.error?.code).toBe("unprovable_address");
    expect(reply.error?.message).toContain("script");
  });
});

describe("presenting a proof", () => {
  it("records the key recovered from the signature", async () => {
    const session = walletSession();
    const holder = transparentIdentity();

    const reply = await prove(session, holder);
    expect(reply.error, reply.error?.message).toBeNull();
    expect(reply.data.proof).toMatchObject({
      address: holder.address,
      publicKeyHex: holder.publicKeyHex,
    });

    const held = await read(await readProofs(get("/api/wallet/taddr", session.cookie)));
    expect(held.data.proofs).toHaveLength(1);
  });

  it("refuses a proof with no session to attach it to", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const statement = await statementFor(session, holder.address);
    const reply = await read(
      await proveAddress(
        post("/api/wallet/taddr", {
          address: holder.address,
          message: statement,
          signature: holder.signBase64(statement),
        }),
      ),
    );
    expect(reply.status).toBe(401);
    expect(reply.error?.code).toBe("no_session");
  });

  it("explains a malformed signature instead of just refusing it", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const statement = await statementFor(session, holder.address);

    const cases: Array<[string, RegExp]> = [
      ["this is not base64 !!!", /base64/],
      [Buffer.alloc(10).toString("base64"), /65 bytes/],
      [Buffer.concat([Buffer.from([5]), Buffer.alloc(64)]).toString("base64"), /header byte/],
      [Buffer.concat([Buffer.from([31]), Buffer.alloc(64)]).toString("base64"), /malformed/],
    ];
    for (const [signature, expected] of cases) {
      const reply = await read(
        await proveAddress(
          post(
            "/api/wallet/taddr",
            { address: holder.address, message: statement, signature },
            session.cookie,
          ),
        ),
      );
      expect(reply.status).toBe(401);
      expect(reply.error?.message).toMatch(expected);
    }
  });

  it("refuses a perfectly valid signature made by a different key", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const stranger = transparentIdentity();
    const statement = await statementFor(session, holder.address);

    const reply = await read(
      await proveAddress(
        post(
          "/api/wallet/taddr",
          {
            address: holder.address,
            message: statement,
            signature: stranger.signBase64(statement),
          },
          session.cookie,
        ),
      ),
    );
    expect(reply.status).toBe(401);
    expect(reply.error?.message).toContain("different address");
  });

  it("refuses a signature over a statement for another address", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const other = transparentIdentity();
    // Signed honestly, by the right key, over the wrong statement.
    const otherStatement = await statementFor(session, other.address);

    const reply = await read(
      await proveAddress(
        post(
          "/api/wallet/taddr",
          {
            address: holder.address,
            message: otherStatement,
            signature: holder.signBase64(otherStatement),
          },
          session.cookie,
        ),
      ),
    );
    expect(reply.status).toBe(400);
    expect(reply.error?.message).toContain(other.address);
  });

  it("refuses a multisig address even if someone hand-builds the statement", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const statement = buildAddressStatement({
      domain: DOMAIN,
      walletPublicKey: session.publicKey,
      address: MULTISIG,
      nonce: await freshNonce(),
      issuedAt: new Date().toISOString(),
    });

    const reply = await read(
      await proveAddress(
        post(
          "/api/wallet/taddr",
          { address: MULTISIG, message: statement, signature: holder.signBase64(statement) },
          session.cookie,
        ),
      ),
    );
    expect(reply.status).toBe(401);
    expect(reply.error?.message).toContain("multisig");
  });

  it("refuses a statement that names another origin", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const statement = buildAddressStatement({
      domain: "stamppad.example",
      walletPublicKey: session.publicKey,
      address: holder.address,
      nonce: await freshNonce(),
      issuedAt: new Date().toISOString(),
    });

    const reply = await read(
      await proveAddress(
        post(
          "/api/wallet/taddr",
          { address: holder.address, message: statement, signature: holder.signBase64(statement) },
          session.cookie,
        ),
      ),
    );
    expect(reply.status).toBe(400);
    expect(reply.error?.message).toContain("stamppad.example");
  });

  it("refuses a statement whose text was edited after signing", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const statement = await statementFor(session, holder.address);
    const signature = holder.signBase64(statement);

    const reply = await read(
      await proveAddress(
        post(
          "/api/wallet/taddr",
          { address: holder.address, message: statement.replace("Site:", "Site :"), signature },
          session.cookie,
        ),
      ),
    );
    expect(reply.status).toBe(400);
    expect(reply.error?.message).toMatch(/address-control statement/);
  });

  it("refuses a stale statement", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const statement = buildAddressStatement({
      domain: DOMAIN,
      walletPublicKey: session.publicKey,
      address: holder.address,
      nonce: await freshNonce(),
      issuedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    });

    const reply = await read(
      await proveAddress(
        post(
          "/api/wallet/taddr",
          { address: holder.address, message: statement, signature: holder.signBase64(statement) },
          session.cookie,
        ),
      ),
    );
    expect(reply.status).toBe(400);
    expect(reply.error?.message).toMatch(/expired/);
  });

  it("refuses a nonce this site never issued", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const statement = buildAddressStatement({
      domain: DOMAIN,
      walletPublicKey: session.publicKey,
      address: holder.address,
      nonce: "ab".repeat(16),
      issuedAt: new Date().toISOString(),
    });

    const reply = await read(
      await proveAddress(
        post(
          "/api/wallet/taddr",
          { address: holder.address, message: statement, signature: holder.signBase64(statement) },
          session.cookie,
        ),
      ),
    );
    expect(reply.status).toBe(409);
    expect(reply.error?.code).toBe("nonce_rejected");
  });

  it("refuses a second use of the same statement", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const statement = await statementFor(session, holder.address);
    const signature = holder.signBase64(statement);
    const body = { address: holder.address, message: statement, signature };

    const first = await read(await proveAddress(post("/api/wallet/taddr", body, session.cookie)));
    expect(first.error).toBeNull();

    const replay = await read(await proveAddress(post("/api/wallet/taddr", body, session.cookie)));
    expect(replay.status).toBe(409);
    expect(replay.error?.message).toMatch(/already used/);
  });

  it("leaves the statement signable when the signature was merely fumbled", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const statement = await statementFor(session, holder.address);

    const fumbled = await read(
      await proveAddress(
        post(
          "/api/wallet/taddr",
          { address: holder.address, message: statement, signature: "half a signature" },
          session.cookie,
        ),
      ),
    );
    expect(fumbled.error).not.toBeNull();

    // A rejected paste must not burn the nonce, or a typo would send the holder
    // back to their wallet for a whole new signature.
    const retry = await read(
      await proveAddress(
        post(
          "/api/wallet/taddr",
          { address: holder.address, message: statement, signature: holder.signBase64(statement) },
          session.cookie,
        ),
      ),
    );
    expect(retry.error, retry.error?.message).toBeNull();
  });
});

describe("what the proof is bound to", () => {
  it("is visible only to the session that obtained it", async () => {
    const mine = walletSession();
    const theirs = walletSession();
    const holder = transparentIdentity();

    expect((await prove(mine, holder)).error).toBeNull();

    expect((await read(await readProofs(get("/api/wallet/taddr", mine.cookie)))).data.proofs).toHaveLength(1);
    expect((await read(await readProofs(get("/api/wallet/taddr", theirs.cookie)))).data.proofs).toHaveLength(0);
    expect((await read(await readProofs(get("/api/wallet/taddr")))).data.proofs).toHaveLength(0);
  });

  it("cannot be borrowed by another session, even with the same signature in hand", async () => {
    const mine = walletSession();
    const theirs = walletSession();
    const holder = transparentIdentity();
    const stampId = await mintStampTo(holder.address);
    await confirmChain();

    const statement = await statementFor(mine, holder.address);
    const signature = holder.signBase64(statement);
    expect(
      (
        await read(
          await proveAddress(
            post(
              "/api/wallet/taddr",
              { address: holder.address, message: statement, signature },
              mine.cookie,
            ),
          ),
        )
      ).error,
    ).toBeNull();

    // The other session has the whole proof: the statement text and a valid
    // signature over it. The statement names the wallet it was issued to, and
    // the Zcash signature covers that line, so it cannot be re-pointed.
    const stolen = await read(
      await proveAddress(
        post(
          "/api/wallet/taddr",
          { address: holder.address, message: statement, signature },
          theirs.cookie,
        ),
      ),
    );
    expect(stolen.status).toBe(400);
    expect(stolen.error?.message).toMatch(/different StampPad wallet/);

    // And nothing it does gets it a listing in the real holder's name.
    await expect(
      createListing({
        stampId,
        sellerAddress: holder.address,
        sellerPublicKeyHex: holder.publicKeyHex,
        priceZat: "100000",
        session: theirs,
      }),
    ).rejects.toThrow(/has not proved control/);

    const listing = await createListing({
      stampId,
      sellerAddress: holder.address,
      priceZat: "100000",
      session: mine,
    });
    expect(listing.sellerAddress).toBe(holder.address);
  });

  it("is not something a listing can claim without any session at all", async () => {
    const holder = transparentIdentity();
    const stampId = await mintStampTo(holder.address);
    await confirmChain();

    await expect(
      createListing({
        stampId,
        sellerAddress: holder.address,
        sellerPublicKeyHex: holder.publicKeyHex,
        priceZat: "100000",
      }),
    ).rejects.toThrow(/needs a connected wallet/);
  });

  it("records the recovered key on the listing, not a key the caller named", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const stranger = transparentIdentity();
    const stampId = await mintStampTo(holder.address);
    await confirmChain();
    expect((await prove(session, holder)).error).toBeNull();

    await createListing({
      stampId,
      sellerAddress: holder.address,
      // Whatever this says is ignored; the proof decides.
      sellerPublicKeyHex: stranger.publicKeyHex,
      priceZat: "100000",
      session,
    });
    const stored = (await getStore().listListings()).find((l) => l.stampId === stampId);
    expect(stored?.sellerPublicKeyHex).toBe(holder.publicKeyHex);
  });

  it("is given up when the wallet disconnects", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const stampId = await mintStampTo(holder.address);
    await confirmChain();
    expect((await prove(session, holder)).error).toBeNull();

    await endSession(new Request(`${ORIGIN}/api/wallet/session`, {
      method: "DELETE",
      headers: { host: DOMAIN, cookie: session.cookie },
    }));

    expect((await read(await readProofs(get("/api/wallet/taddr", session.cookie)))).data.proofs).toHaveLength(0);
    await expect(
      createListing({ stampId, sellerAddress: holder.address, priceZat: "100000", session }),
    ).rejects.toThrow(/has not proved control/);
  });

  it("can be given up without giving up the wallet session", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    expect((await prove(session, holder)).error).toBeNull();

    await revokeProofs(new Request(`${ORIGIN}/api/wallet/taddr`, {
      method: "DELETE",
      headers: { host: DOMAIN, cookie: session.cookie },
    }));
    expect((await read(await readProofs(get("/api/wallet/taddr", session.cookie)))).data.proofs).toHaveLength(0);
  });

  it("does not carry over to a later session for the same wallet", async () => {
    const first = walletSession("2026-09-21T00:00:00.000Z");
    const holder = transparentIdentity();
    expect((await prove(first, holder)).error).toBeNull();

    // Same Solana key, connected again, so a fresh proof is expected of it.
    const again = {
      ...first,
      verifiedAt: "2026-09-21T00:10:00.000Z",
      cookie: `${SESSION_COOKIE}=${encodeSessionCookie({
        publicKey: first.publicKey,
        verifiedAt: "2026-09-21T00:10:00.000Z",
      })}`,
    };
    expect((await read(await readProofs(get("/api/wallet/taddr", again.cookie)))).data.proofs).toHaveLength(0);
  });
});

describe("listing a stamp held at a transparent address", () => {
  it("turns listable for the proving session and stays unlistable for everyone else", async () => {
    const session = walletSession();
    const onlooker = walletSession();
    const holder = transparentIdentity();
    const stampId = await mintStampTo(holder.address);
    await confirmChain();

    const before = await read(
      await readStamp(get(`/api/stamps/${stampId}`, session.cookie), {
        params: Promise.resolve({ id: stampId }),
      }),
    );
    expect(before.data.transferable).toBe(true);
    expect(before.data.listable).toBe(false);
    expect(before.data.needsControlProof).toBe(true);
    expect(before.data.listabilityNote).toContain("proof of control");

    expect((await prove(session, holder)).error).toBeNull();

    const after = await read(
      await readStamp(get(`/api/stamps/${stampId}`, session.cookie), {
        params: Promise.resolve({ id: stampId }),
      }),
    );
    expect(after.data.listable).toBe(true);
    expect(after.data.needsControlProof).toBe(false);

    const elsewhere = await read(
      await readStamp(get(`/api/stamps/${stampId}`, onlooker.cookie), {
        params: Promise.resolve({ id: stampId }),
      }),
    );
    expect(elsewhere.data.listable).toBe(false);
  });

  it("carries a sale through to the buyer, signed the whole way with the Zcash key", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const buyer = solanaIdentity("taddr-listing-buyer");
    const stampId = await mintStampTo(holder.address);
    await confirmChain();
    expect((await prove(session, holder)).error).toBeNull();

    const listing = await createListing({
      stampId,
      sellerAddress: holder.address,
      priceZat: "150000",
      session,
    });
    await reserveListing({
      listingId: listing.id,
      buyerAddress: buyer.address,
      buyerPublicKeyHex: buyer.publicKeyHex,
    });

    // No public key is sent with either signature: the seller's key is the one
    // recovered when control of the address was proved, and it is already on the
    // listing. The key is re-recovered from each signature when it is verified.
    const offer = await listingChallenge(listing.id);
    await advanceListing({
      listingId: listing.id,
      action: "publishOffer",
      signatureHex: holder.sign(offer.preimage),
    });

    const authorization = await listingChallenge(listing.id);
    await advanceListing({
      listingId: listing.id,
      action: "authorize",
      signatureHex: holder.sign(authorization.preimage),
    });

    await advanceListing({ listingId: listing.id, action: "lockPayment" });
    await advanceListing({ listingId: listing.id, action: "publishTransfer" });
    await advanceListing({ listingId: listing.id, action: "claimPayment" });
    await confirmChain();

    const rebuilt = await indexFromStore();
    expect(rebuilt.ownership.stamps[stampId]?.currentOwner).toBe(buyer.address);
    expect(rebuilt.ownership.rejected.filter((r) => r.stampCommitmentHex === stampId)).toHaveLength(0);
    expect(rebuilt.ownership.sales.some((s) => s.seller === holder.address)).toBe(true);
  });

  it("refuses a step signed by a key that is not the seller's", async () => {
    const session = walletSession();
    const holder = transparentIdentity();
    const attacker = transparentIdentity();
    const buyer = solanaIdentity("taddr-listing-buyer-2");
    const stampId = await mintStampTo(holder.address);
    await confirmChain();
    expect((await prove(session, holder)).error).toBeNull();

    const listing = await createListing({
      stampId,
      sellerAddress: holder.address,
      priceZat: "150000",
      session,
    });
    await reserveListing({
      listingId: listing.id,
      buyerAddress: buyer.address,
      buyerPublicKeyHex: buyer.publicKeyHex,
    });

    const offer = await listingChallenge(listing.id);
    await expect(
      advanceListing({
        listingId: listing.id,
        action: "publishOffer",
        signatureHex: attacker.sign(offer.preimage),
      }),
    ).rejects.toThrow(/different address/i);
  });
});
