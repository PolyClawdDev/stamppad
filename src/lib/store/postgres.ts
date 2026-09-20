import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { emptyChain } from "../solana/demo";
import { emptyZcash } from "../zcash/demo";
import { deserializeDemo, serializeDemo } from "./serialize";
import type { JobRow, LaunchRow, ListingRow, StampRow, Store, TransferRow } from "./types";

let pool: Pool | null = null;

function db(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required for the postgres store.");
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

const MIGRATIONS = ["0001_init.sql", "0002_market.sql"];

export async function migrate(): Promise<void> {
  for (const file of MIGRATIONS) {
    const sql = readFileSync(join(process.cwd(), "db/migrations", file), "utf8");
    await db().query(sql);
  }
}

function launchFrom(r: Record<string, unknown>): LaunchRow {
  return {
    mint: String(r.mint),
    name: String(r.name),
    symbol: String(r.symbol),
    description: String(r.description),
    imageDataUrl: (r.image_data_url as string | null) ?? null,
    quoteMint: String(r.quote_mint),
    quoteSymbol: String(r.quote_symbol),
    tokenProgram: String(r.token_program),
    decimals: Number(r.decimals),
    launchSupply: String(r.launch_supply),
    poolBase: String(r.pool_base),
    currentSupply: String(r.current_supply),
    creator: String(r.creator),
    launchTx: String(r.launch_tx),
    stonkUrl: String(r.stonk_url),
    source: String(r.source),
    createdAt: new Date(String(r.created_at)).toISOString(),
  };
}

function jobFrom(r: Record<string, unknown>): JobRow {
  return {
    id: String(r.id),
    state: r.state as JobRow["state"],
    mint: String(r.mint),
    owner: String(r.owner),
    amountBase: String(r.amount_base),
    decimals: Number(r.decimals),
    destination: String(r.destination),
    nonce: String(r.nonce),
    sourceTx: (r.source_tx as string | null) ?? null,
    burnLocator: (r.burn_locator as string | null) ?? null,
    tokenProgram: (r.token_program as string | null) ?? null,
    burnAuthority: (r.burn_authority as string | null) ?? null,
    authorityRole: (r.authority_role as string | null) ?? null,
    intentLocator: (r.intent_locator as string | null) ?? null,
    commitmentHex: (r.commitment_hex as string | null) ?? null,
    zcashTx: (r.zcash_tx as string | null) ?? null,
    zcashOutputIndex: r.zcash_output_index === null ? null : Number(r.zcash_output_index),
    zcashNullDataIndex: r.zcash_null_data_index === null ? null : Number(r.zcash_null_data_index),
    zcashHeight: r.zcash_height === null ? null : Number(r.zcash_height),
    confirmations: Number(r.confirmations),
    rejectReason: (r.reject_reason as JobRow["rejectReason"]) ?? null,
    rejectMessage: (r.reject_message as string | null) ?? null,
    claimPackage: (r.claim_package as JobRow["claimPackage"]) ?? null,
    idempotencyKey: String(r.idempotency_key),
    createdAt: new Date(String(r.created_at)).toISOString(),
    updatedAt: new Date(String(r.updated_at)).toISOString(),
  };
}

function stampFrom(r: Record<string, unknown>): StampRow {
  return {
    id: String(r.id),
    jobId: String(r.job_id),
    protocol: "stamp-exp",
    version: 0,
    sourceNetwork: String(r.source_network),
    destinationNetwork: String(r.destination_network),
    mint: String(r.mint),
    tokenProgram: String(r.token_program),
    sourceTx: String(r.source_tx),
    burnLocator: String(r.burn_locator),
    amountBase: String(r.amount_base),
    decimals: Number(r.decimals),
    destination: String(r.destination),
    burnAuthority: String(r.burn_authority),
    authorityRole: String(r.authority_role),
    intentLocator: String(r.intent_locator),
    nonce: String(r.nonce),
    commitmentHex: String(r.commitment_hex),
    zcashTx: String(r.zcash_tx),
    zcashOutputIndex: Number(r.zcash_output_index),
    zcashNullDataIndex: Number(r.zcash_null_data_index),
    zcashHeight: Number(r.zcash_height),
    confirmations: Number(r.confirmations),
    createdAt: new Date(String(r.created_at)).toISOString(),
  };
}

function listingFrom(r: Record<string, unknown>): ListingRow {
  return {
    id: String(r.id),
    stampId: String(r.stamp_id),
    stampCommitmentHex: String(r.stamp_commitment_hex),
    sequence: Number(r.sequence),
    state: r.state as ListingRow["state"],
    sellerAddress: String(r.seller_address),
    sellerPublicKeyHex: String(r.seller_public_key_hex),
    buyerAddress: (r.buyer_address as string | null) ?? null,
    buyerPublicKeyHex: (r.buyer_public_key_hex as string | null) ?? null,
    priceZat: String(r.price_zat),
    hashLockHex: (r.hash_lock_hex as string | null) ?? null,
    preimageHex: (r.preimage_hex as string | null) ?? null,
    offerArtifact: (r.offer_artifact as ListingRow["offerArtifact"]) ?? null,
    offerTxid: (r.offer_txid as string | null) ?? null,
    transferArtifact: (r.transfer_artifact as ListingRow["transferArtifact"]) ?? null,
    transferTxid: (r.transfer_txid as string | null) ?? null,
    escrowId: (r.escrow_id as string | null) ?? null,
    expiryHeight: r.expiry_height === null ? null : Number(r.expiry_height),
    note: String(r.note ?? ""),
    createdAt: new Date(String(r.created_at)).toISOString(),
    updatedAt: new Date(String(r.updated_at)).toISOString(),
  };
}

function transferFrom(r: Record<string, unknown>): TransferRow {
  return {
    id: String(r.id),
    stampId: String(r.stamp_id),
    stampCommitmentHex: String(r.stamp_commitment_hex),
    sequence: Number(r.sequence),
    listingId: (r.listing_id as string | null) ?? null,
    txid: String(r.txid),
    artifact: r.artifact as TransferRow["artifact"],
    createdAt: new Date(String(r.created_at)).toISOString(),
  };
}

export class PostgresStore implements Store {
  async listLaunches() {
    const { rows } = await db().query("SELECT * FROM launches ORDER BY created_at DESC");
    return rows.map((r) => launchFrom(r));
  }
  async getLaunch(mint: string) {
    const { rows } = await db().query("SELECT * FROM launches WHERE mint=$1", [mint]);
    return rows[0] ? launchFrom(rows[0]) : null;
  }
  async upsertLaunch(row: LaunchRow) {
    await db().query(
      `INSERT INTO launches (
        mint, name, symbol, description, image_data_url, quote_mint, quote_symbol,
        token_program, decimals, launch_supply, pool_base, current_supply, creator,
        launch_tx, stonk_url, source, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (mint) DO UPDATE SET current_supply=EXCLUDED.current_supply`,
      [
        row.mint, row.name, row.symbol, row.description, row.imageDataUrl, row.quoteMint,
        row.quoteSymbol, row.tokenProgram, row.decimals, row.launchSupply, row.poolBase,
        row.currentSupply, row.creator, row.launchTx, row.stonkUrl, row.source, row.createdAt,
      ],
    );
  }
  async listJobs() {
    const { rows } = await db().query("SELECT * FROM jobs ORDER BY created_at DESC");
    return rows.map((r) => jobFrom(r));
  }
  async getJob(id: string) {
    const { rows } = await db().query("SELECT * FROM jobs WHERE id=$1", [id]);
    return rows[0] ? jobFrom(rows[0]) : null;
  }
  async findJobByIdempotency(key: string) {
    const { rows } = await db().query("SELECT * FROM jobs WHERE idempotency_key=$1", [key]);
    return rows[0] ? jobFrom(rows[0]) : null;
  }
  async upsertJob(row: JobRow) {
    await db().query(
      `INSERT INTO jobs (
        id, state, mint, owner, amount_base, decimals, destination, nonce, source_tx,
        burn_locator, token_program, burn_authority, authority_role, intent_locator,
        commitment_hex, zcash_tx, zcash_output_index, zcash_null_data_index, zcash_height,
        confirmations, reject_reason, reject_message, claim_package, idempotency_key,
        created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24,$25,$26
      )
      ON CONFLICT (id) DO UPDATE SET
        state=EXCLUDED.state, source_tx=EXCLUDED.source_tx, burn_locator=EXCLUDED.burn_locator,
        token_program=EXCLUDED.token_program, burn_authority=EXCLUDED.burn_authority,
        authority_role=EXCLUDED.authority_role, intent_locator=EXCLUDED.intent_locator,
        commitment_hex=EXCLUDED.commitment_hex, zcash_tx=EXCLUDED.zcash_tx,
        zcash_output_index=EXCLUDED.zcash_output_index, zcash_null_data_index=EXCLUDED.zcash_null_data_index,
        zcash_height=EXCLUDED.zcash_height, confirmations=EXCLUDED.confirmations,
        reject_reason=EXCLUDED.reject_reason, reject_message=EXCLUDED.reject_message,
        claim_package=EXCLUDED.claim_package, updated_at=EXCLUDED.updated_at`,
      [
        row.id, row.state, row.mint, row.owner, row.amountBase, row.decimals, row.destination,
        row.nonce, row.sourceTx, row.burnLocator, row.tokenProgram, row.burnAuthority,
        row.authorityRole, row.intentLocator, row.commitmentHex, row.zcashTx,
        row.zcashOutputIndex, row.zcashNullDataIndex, row.zcashHeight, row.confirmations,
        row.rejectReason, row.rejectMessage, JSON.stringify(row.claimPackage), row.idempotencyKey,
        row.createdAt, row.updatedAt,
      ],
    );
  }
  async listStamps() {
    const { rows } = await db().query("SELECT * FROM stamps ORDER BY created_at DESC");
    return rows.map((r) => stampFrom(r));
  }
  async getStamp(id: string) {
    const { rows } = await db().query("SELECT * FROM stamps WHERE id=$1", [id]);
    return rows[0] ? stampFrom(rows[0]) : null;
  }
  async stampsForMint(mint: string) {
    const { rows } = await db().query("SELECT * FROM stamps WHERE mint=$1 ORDER BY created_at DESC", [mint]);
    return rows.map((r) => stampFrom(r));
  }
  async upsertStamp(row: StampRow) {
    await db().query(
      `INSERT INTO stamps (
        id, job_id, protocol, version, source_network, destination_network, mint, token_program,
        source_tx, burn_locator, amount_base, decimals, destination, burn_authority, authority_role,
        intent_locator, nonce, commitment_hex, zcash_tx, zcash_output_index, zcash_null_data_index,
        zcash_height, confirmations, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
      )
      ON CONFLICT (id) DO UPDATE SET confirmations=EXCLUDED.confirmations`,
      [
        row.id, row.jobId, row.protocol, row.version, row.sourceNetwork, row.destinationNetwork,
        row.mint, row.tokenProgram, row.sourceTx, row.burnLocator, row.amountBase, row.decimals,
        row.destination, row.burnAuthority, row.authorityRole, row.intentLocator, row.nonce,
        row.commitmentHex, row.zcashTx, row.zcashOutputIndex, row.zcashNullDataIndex,
        row.zcashHeight, row.confirmations, row.createdAt,
      ],
    );
  }
  async listListings() {
    const { rows } = await db().query("SELECT * FROM listings ORDER BY created_at DESC");
    return rows.map((r) => listingFrom(r));
  }
  async getListing(id: string) {
    const { rows } = await db().query("SELECT * FROM listings WHERE id=$1", [id]);
    return rows[0] ? listingFrom(rows[0]) : null;
  }
  async upsertListing(row: ListingRow) {
    await db().query(
      `INSERT INTO listings (
        id, stamp_id, stamp_commitment_hex, sequence, state, seller_address, seller_public_key_hex,
        buyer_address, buyer_public_key_hex, price_zat, hash_lock_hex, preimage_hex,
        offer_artifact, offer_txid, transfer_artifact, transfer_txid, escrow_id, expiry_height,
        note, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15::jsonb,$16,$17,$18,$19,$20,$21
      )
      ON CONFLICT (id) DO UPDATE SET
        state=EXCLUDED.state, buyer_address=EXCLUDED.buyer_address,
        buyer_public_key_hex=EXCLUDED.buyer_public_key_hex, hash_lock_hex=EXCLUDED.hash_lock_hex,
        preimage_hex=EXCLUDED.preimage_hex, offer_artifact=EXCLUDED.offer_artifact,
        offer_txid=EXCLUDED.offer_txid, transfer_artifact=EXCLUDED.transfer_artifact,
        transfer_txid=EXCLUDED.transfer_txid, escrow_id=EXCLUDED.escrow_id,
        expiry_height=EXCLUDED.expiry_height, note=EXCLUDED.note, updated_at=EXCLUDED.updated_at`,
      [
        row.id, row.stampId, row.stampCommitmentHex, row.sequence, row.state, row.sellerAddress,
        row.sellerPublicKeyHex, row.buyerAddress, row.buyerPublicKeyHex, row.priceZat,
        row.hashLockHex, row.preimageHex, JSON.stringify(row.offerArtifact), row.offerTxid,
        JSON.stringify(row.transferArtifact), row.transferTxid, row.escrowId, row.expiryHeight,
        row.note, row.createdAt, row.updatedAt,
      ],
    );
  }
  async listTransfers() {
    const { rows } = await db().query("SELECT * FROM transfers ORDER BY created_at DESC");
    return rows.map((r) => transferFrom(r));
  }
  async upsertTransfer(row: TransferRow) {
    await db().query(
      `INSERT INTO transfers (
        id, stamp_id, stamp_commitment_hex, sequence, listing_id, txid, artifact, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
      ON CONFLICT (id) DO NOTHING`,
      [
        row.id, row.stampId, row.stampCommitmentHex, row.sequence, row.listingId, row.txid,
        JSON.stringify(row.artifact), row.createdAt,
      ],
    );
  }
  async loadDemo() {
    const { rows } = await db().query("SELECT payload FROM demo_state WHERE id='default'");
    if (!rows[0]) return { solana: emptyChain(), zcash: emptyZcash() };
    return deserializeDemo(rows[0].payload);
  }
  async saveDemo(solana: import("../solana/demo").DemoChainState, zcash: import("../zcash/demo").DemoZcashChain) {
    const payload = serializeDemo(solana, zcash);
    await db().query(
      `INSERT INTO demo_state (id, payload, updated_at) VALUES ('default', $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload, updated_at=NOW()`,
      [JSON.stringify(payload)],
    );
  }
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
