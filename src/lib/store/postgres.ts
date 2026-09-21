import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { emptyChain } from "../solana/demo";
import { emptyZcash } from "../zcash/demo";
import { MIGRATIONS } from "./schema";
import { deserializeClaim, deserializeDemo, serializeClaim, serializeDemo } from "./serialize";
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

/**
 * One arbitrary constant, shared by every instance of this app and by nothing
 * else. Two cold starts that reach for the schema at the same moment queue up
 * behind it instead of both running CREATE TABLE and one of them dying on a
 * duplicate relation.
 */
const SCHEMA_LOCK = "8147326159021453";

let migrating: Promise<void> | null = null;

/**
 * Creates the schema if it is not there yet, once per process and at most once
 * at a time across the whole fleet.
 *
 * A failure clears the memo so the next request can try again; a deployment
 * that lost its database for a minute should recover on its own rather than
 * stay broken until it is redeployed.
 */
export function ensureMigrated(): Promise<void> {
  if (!migrating) {
    migrating = migrate().catch((error) => {
      migrating = null;
      throw error;
    });
  }
  return migrating;
}

export async function migrate(): Promise<void> {
  const client = await db().connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${SCHEMA_LOCK})`);
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           name TEXT PRIMARY KEY,
           applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`,
      );
      const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
      const applied = new Set(rows.map((r) => r.name));
      for (const step of MIGRATIONS) {
        if (applied.has(step.name)) continue;
        await client.query("BEGIN");
        try {
          await client.query(step.sql);
          await client.query(
            "INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
            [step.name],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      await client.query(`SELECT pg_advisory_unlock(${SCHEMA_LOCK})`);
    }
  } finally {
    client.release();
  }
}

async function q<R extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<QueryResult<R>> {
  await ensureMigrated();
  return db().query<R>(text, values);
}

/**
 * node-postgres hands back a Date for a timestamptz. Stringifying that Date
 * before parsing it again drops the milliseconds, so a row read back would not
 * equal the row written. Use the Date directly.
 */
function isoFrom(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
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
    createdAt: isoFrom(r.created_at),
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
    claimPackage: r.claim_package
      ? deserializeClaim(r.claim_package as ReturnType<typeof serializeClaim>)
      : null,
    idempotencyKey: String(r.idempotency_key),
    createdAt: isoFrom(r.created_at),
    updatedAt: isoFrom(r.updated_at),
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
    createdAt: isoFrom(r.created_at),
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
    createdAt: isoFrom(r.created_at),
    updatedAt: isoFrom(r.updated_at),
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
    createdAt: isoFrom(r.created_at),
  };
}

/**
 * Newest first, and deterministic when two rows share a timestamp, so a list
 * does not reshuffle between two reads of the same data.
 */
const NEWEST_FIRST = "ORDER BY created_at DESC, id DESC";

export class PostgresStore implements Store {
  async listLaunches() {
    const { rows } = await q(`SELECT * FROM launches ORDER BY created_at DESC, mint DESC`);
    return rows.map((r) => launchFrom(r));
  }
  async getLaunch(mint: string) {
    const { rows } = await q("SELECT * FROM launches WHERE mint=$1", [mint]);
    return rows[0] ? launchFrom(rows[0]) : null;
  }
  async upsertLaunch(row: LaunchRow) {
    await q(
      `INSERT INTO launches (
        mint, name, symbol, description, image_data_url, quote_mint, quote_symbol,
        token_program, decimals, launch_supply, pool_base, current_supply, creator,
        launch_tx, stonk_url, source, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (mint) DO UPDATE SET
        name=EXCLUDED.name, symbol=EXCLUDED.symbol, description=EXCLUDED.description,
        image_data_url=EXCLUDED.image_data_url, quote_mint=EXCLUDED.quote_mint,
        quote_symbol=EXCLUDED.quote_symbol, token_program=EXCLUDED.token_program,
        decimals=EXCLUDED.decimals, launch_supply=EXCLUDED.launch_supply,
        pool_base=EXCLUDED.pool_base, current_supply=EXCLUDED.current_supply,
        creator=EXCLUDED.creator, launch_tx=EXCLUDED.launch_tx,
        stonk_url=EXCLUDED.stonk_url, source=EXCLUDED.source, created_at=EXCLUDED.created_at`,
      [
        row.mint, row.name, row.symbol, row.description, row.imageDataUrl, row.quoteMint,
        row.quoteSymbol, row.tokenProgram, row.decimals, row.launchSupply, row.poolBase,
        row.currentSupply, row.creator, row.launchTx, row.stonkUrl, row.source, row.createdAt,
      ],
    );
  }
  async listJobs() {
    const { rows } = await q(`SELECT * FROM jobs ${NEWEST_FIRST}`);
    return rows.map((r) => jobFrom(r));
  }
  async getJob(id: string) {
    const { rows } = await q("SELECT * FROM jobs WHERE id=$1", [id]);
    return rows[0] ? jobFrom(rows[0]) : null;
  }
  async findJobByIdempotency(key: string) {
    const { rows } = await q("SELECT * FROM jobs WHERE idempotency_key=$1", [key]);
    return rows[0] ? jobFrom(rows[0]) : null;
  }
  async upsertJob(row: JobRow) {
    await q(
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
        state=EXCLUDED.state, mint=EXCLUDED.mint, owner=EXCLUDED.owner,
        amount_base=EXCLUDED.amount_base, decimals=EXCLUDED.decimals,
        destination=EXCLUDED.destination, nonce=EXCLUDED.nonce, source_tx=EXCLUDED.source_tx,
        burn_locator=EXCLUDED.burn_locator, token_program=EXCLUDED.token_program,
        burn_authority=EXCLUDED.burn_authority, authority_role=EXCLUDED.authority_role,
        intent_locator=EXCLUDED.intent_locator, commitment_hex=EXCLUDED.commitment_hex,
        zcash_tx=EXCLUDED.zcash_tx, zcash_output_index=EXCLUDED.zcash_output_index,
        zcash_null_data_index=EXCLUDED.zcash_null_data_index,
        zcash_height=EXCLUDED.zcash_height, confirmations=EXCLUDED.confirmations,
        reject_reason=EXCLUDED.reject_reason, reject_message=EXCLUDED.reject_message,
        claim_package=EXCLUDED.claim_package, idempotency_key=EXCLUDED.idempotency_key,
        created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at`,
      [
        row.id, row.state, row.mint, row.owner, row.amountBase, row.decimals, row.destination,
        row.nonce, row.sourceTx, row.burnLocator, row.tokenProgram, row.burnAuthority,
        row.authorityRole, row.intentLocator, row.commitmentHex, row.zcashTx,
        row.zcashOutputIndex, row.zcashNullDataIndex, row.zcashHeight, row.confirmations,
        row.rejectReason, row.rejectMessage,
        row.claimPackage === null ? null : JSON.stringify(serializeClaim(row.claimPackage)),
        row.idempotencyKey, row.createdAt, row.updatedAt,
      ],
    );
  }
  async listStamps() {
    const { rows } = await q(`SELECT * FROM stamps ${NEWEST_FIRST}`);
    return rows.map((r) => stampFrom(r));
  }
  async getStamp(id: string) {
    const { rows } = await q("SELECT * FROM stamps WHERE id=$1", [id]);
    return rows[0] ? stampFrom(rows[0]) : null;
  }
  async stampsForMint(mint: string) {
    const { rows } = await q(`SELECT * FROM stamps WHERE mint=$1 ${NEWEST_FIRST}`, [mint]);
    return rows.map((r) => stampFrom(r));
  }
  async upsertStamp(row: StampRow) {
    await q(
      `INSERT INTO stamps (
        id, job_id, protocol, version, source_network, destination_network, mint, token_program,
        source_tx, burn_locator, amount_base, decimals, destination, burn_authority, authority_role,
        intent_locator, nonce, commitment_hex, zcash_tx, zcash_output_index, zcash_null_data_index,
        zcash_height, confirmations, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
      )
      ON CONFLICT (id) DO UPDATE SET
        job_id=EXCLUDED.job_id, protocol=EXCLUDED.protocol, version=EXCLUDED.version,
        source_network=EXCLUDED.source_network, destination_network=EXCLUDED.destination_network,
        mint=EXCLUDED.mint, token_program=EXCLUDED.token_program, source_tx=EXCLUDED.source_tx,
        burn_locator=EXCLUDED.burn_locator, amount_base=EXCLUDED.amount_base,
        decimals=EXCLUDED.decimals, destination=EXCLUDED.destination,
        burn_authority=EXCLUDED.burn_authority, authority_role=EXCLUDED.authority_role,
        intent_locator=EXCLUDED.intent_locator, nonce=EXCLUDED.nonce,
        commitment_hex=EXCLUDED.commitment_hex, zcash_tx=EXCLUDED.zcash_tx,
        zcash_output_index=EXCLUDED.zcash_output_index,
        zcash_null_data_index=EXCLUDED.zcash_null_data_index,
        zcash_height=EXCLUDED.zcash_height, confirmations=EXCLUDED.confirmations,
        created_at=EXCLUDED.created_at`,
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
    const { rows } = await q(`SELECT * FROM listings ${NEWEST_FIRST}`);
    return rows.map((r) => listingFrom(r));
  }
  async getListing(id: string) {
    const { rows } = await q("SELECT * FROM listings WHERE id=$1", [id]);
    return rows[0] ? listingFrom(rows[0]) : null;
  }
  async upsertListing(row: ListingRow) {
    await q(
      `INSERT INTO listings (
        id, stamp_id, stamp_commitment_hex, sequence, state, seller_address, seller_public_key_hex,
        buyer_address, buyer_public_key_hex, price_zat, hash_lock_hex, preimage_hex,
        offer_artifact, offer_txid, transfer_artifact, transfer_txid, escrow_id, expiry_height,
        note, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15::jsonb,$16,$17,$18,$19,$20,$21
      )
      ON CONFLICT (id) DO UPDATE SET
        stamp_id=EXCLUDED.stamp_id, stamp_commitment_hex=EXCLUDED.stamp_commitment_hex,
        sequence=EXCLUDED.sequence, state=EXCLUDED.state, seller_address=EXCLUDED.seller_address,
        seller_public_key_hex=EXCLUDED.seller_public_key_hex, buyer_address=EXCLUDED.buyer_address,
        buyer_public_key_hex=EXCLUDED.buyer_public_key_hex, price_zat=EXCLUDED.price_zat,
        hash_lock_hex=EXCLUDED.hash_lock_hex, preimage_hex=EXCLUDED.preimage_hex,
        offer_artifact=EXCLUDED.offer_artifact, offer_txid=EXCLUDED.offer_txid,
        transfer_artifact=EXCLUDED.transfer_artifact, transfer_txid=EXCLUDED.transfer_txid,
        escrow_id=EXCLUDED.escrow_id, expiry_height=EXCLUDED.expiry_height,
        note=EXCLUDED.note, created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at`,
      [
        row.id, row.stampId, row.stampCommitmentHex, row.sequence, row.state, row.sellerAddress,
        row.sellerPublicKeyHex, row.buyerAddress, row.buyerPublicKeyHex, row.priceZat,
        row.hashLockHex, row.preimageHex,
        row.offerArtifact === null ? null : JSON.stringify(row.offerArtifact), row.offerTxid,
        row.transferArtifact === null ? null : JSON.stringify(row.transferArtifact),
        row.transferTxid, row.escrowId, row.expiryHeight,
        row.note, row.createdAt, row.updatedAt,
      ],
    );
  }
  async listTransfers() {
    const { rows } = await q(`SELECT * FROM transfers ${NEWEST_FIRST}`);
    return rows.map((r) => transferFrom(r));
  }
  async upsertTransfer(row: TransferRow) {
    await q(
      `INSERT INTO transfers (
        id, stamp_id, stamp_commitment_hex, sequence, listing_id, txid, artifact, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
      ON CONFLICT (id) DO UPDATE SET
        stamp_id=EXCLUDED.stamp_id, stamp_commitment_hex=EXCLUDED.stamp_commitment_hex,
        sequence=EXCLUDED.sequence, listing_id=EXCLUDED.listing_id, txid=EXCLUDED.txid,
        artifact=EXCLUDED.artifact, created_at=EXCLUDED.created_at`,
      [
        row.id, row.stampId, row.stampCommitmentHex, row.sequence, row.listingId, row.txid,
        JSON.stringify(row.artifact), row.createdAt,
      ],
    );
  }
  async loadDemo() {
    const { rows } = await q("SELECT payload FROM demo_state WHERE id='default'");
    if (!rows[0]) return { solana: emptyChain(), zcash: emptyZcash() };
    return deserializeDemo(rows[0].payload);
  }
  async saveDemo(solana: import("../solana/demo").DemoChainState, zcash: import("../zcash/demo").DemoZcashChain) {
    const payload = serializeDemo(solana, zcash);
    await q(
      `INSERT INTO demo_state (id, payload, updated_at) VALUES ('default', $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload, updated_at=NOW()`,
      [JSON.stringify(payload)],
    );
  }
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ensureMigrated();
  const client = await db().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Closes the pool so a process can exit, or a test can simulate a restart. */
export async function closePool(): Promise<void> {
  const open = pool;
  pool = null;
  migrating = null;
  if (open) await open.end();
}
