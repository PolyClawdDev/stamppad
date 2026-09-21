/**
 * The schema the Postgres store needs, carried in the code rather than read
 * off disk.
 *
 * A serverless bundle only ships the files its imports reach. A runtime
 * readFileSync of db/migrations resolves against a deployment root that has no
 * db directory in it, so the migration that was supposed to create these
 * tables throws ENOENT and the first query fails on a missing relation.
 * Keeping the statements next to the store that depends on them means the
 * schema is deployed whenever the store is.
 *
 * Every statement is written to be safe to run twice. The runner also records
 * what it has applied, but correctness does not depend on that record being
 * accurate, only on it saving work.
 */

export interface Migration {
  name: string;
  sql: string;
}

const INIT = `
-- STAMP durable store. Unique constraints aid recovery; they are not protocol validity.

CREATE TABLE IF NOT EXISTS launches (
  mint TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_data_url TEXT,
  quote_mint TEXT NOT NULL,
  quote_symbol TEXT NOT NULL,
  token_program TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  launch_supply TEXT NOT NULL,
  pool_base TEXT NOT NULL,
  current_supply TEXT NOT NULL,
  creator TEXT NOT NULL,
  launch_tx TEXT NOT NULL,
  stonk_url TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  mint TEXT NOT NULL,
  owner TEXT NOT NULL,
  amount_base TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  destination TEXT NOT NULL,
  nonce TEXT NOT NULL,
  source_tx TEXT,
  burn_locator TEXT,
  token_program TEXT,
  burn_authority TEXT,
  authority_role TEXT,
  intent_locator TEXT,
  commitment_hex TEXT,
  zcash_tx TEXT,
  zcash_output_index INTEGER,
  zcash_null_data_index INTEGER,
  zcash_height INTEGER,
  confirmations INTEGER NOT NULL DEFAULT 0,
  reject_reason TEXT,
  reject_message TEXT,
  claim_package JSONB,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_burn_event
  ON jobs (source_tx, burn_locator)
  WHERE source_tx IS NOT NULL AND burn_locator IS NOT NULL
    AND state NOT IN ('rejected');

CREATE TABLE IF NOT EXISTS stamps (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  protocol TEXT NOT NULL,
  version INTEGER NOT NULL,
  source_network TEXT NOT NULL,
  destination_network TEXT NOT NULL,
  mint TEXT NOT NULL,
  token_program TEXT NOT NULL,
  source_tx TEXT NOT NULL,
  burn_locator TEXT NOT NULL,
  amount_base TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  destination TEXT NOT NULL,
  burn_authority TEXT NOT NULL,
  authority_role TEXT NOT NULL,
  intent_locator TEXT NOT NULL,
  nonce TEXT NOT NULL,
  commitment_hex TEXT NOT NULL,
  zcash_tx TEXT NOT NULL,
  zcash_output_index INTEGER NOT NULL,
  zcash_null_data_index INTEGER NOT NULL,
  zcash_height INTEGER NOT NULL,
  confirmations INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_network, source_tx, burn_locator)
);

CREATE TABLE IF NOT EXISTS demo_state (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const MARKET = `
-- stamp-exp/1 ownership and marketplace state.
-- Database constraints protect the operator from duplicate work; protocol
-- validity is decided by the indexer replaying on-chain records.

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  stamp_id TEXT NOT NULL REFERENCES stamps(id),
  stamp_commitment_hex TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  state TEXT NOT NULL,
  seller_address TEXT NOT NULL,
  seller_public_key_hex TEXT NOT NULL,
  buyer_address TEXT,
  buyer_public_key_hex TEXT,
  price_zat TEXT NOT NULL,
  hash_lock_hex TEXT,
  preimage_hex TEXT,
  offer_artifact JSONB,
  offer_txid TEXT,
  transfer_artifact JSONB,
  transfer_txid TEXT,
  escrow_id TEXT,
  expiry_height INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one live listing per stamp: a second sale attempt cannot even be recorded.
CREATE UNIQUE INDEX IF NOT EXISTS listings_one_active
  ON listings (stamp_id)
  WHERE state NOT IN ('settled', 'cancelled', 'expired', 'failed');

CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  stamp_id TEXT NOT NULL REFERENCES stamps(id),
  stamp_commitment_hex TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  listing_id TEXT REFERENCES listings(id),
  txid TEXT NOT NULL,
  artifact JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stamp_commitment_hex, sequence)
);
`;

/**
 * Amounts are exact integer base units and are stored as text for that reason.
 * The check is what stops a value that went through a float somewhere from
 * being written at all, because "1e+21" or "1000.0000000001" would be accepted
 * by a text column and would be silently wrong forever after.
 *
 * NOT VALID means the constraint applies to every insert and update from now
 * on without scanning what is already there, so adding it cannot fail a deploy
 * against a database that already holds rows.
 */
const EXACT_AMOUNTS = `
DO $$ BEGIN
  ALTER TABLE launches ADD CONSTRAINT launches_amounts_are_integers
    CHECK (launch_supply ~ '^[0-9]+$' AND pool_base ~ '^[0-9]+$' AND current_supply ~ '^[0-9]+$')
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE jobs ADD CONSTRAINT jobs_amount_is_integer
    CHECK (amount_base ~ '^[0-9]+$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE stamps ADD CONSTRAINT stamps_amount_is_integer
    CHECK (amount_base ~ '^[0-9]+$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE listings ADD CONSTRAINT listings_price_is_integer
    CHECK (price_zat ~ '^[0-9]+$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

const LAUNCH_LINKS = `
ALTER TABLE launches ADD COLUMN IF NOT EXISTS website TEXT NOT NULL DEFAULT '';
ALTER TABLE launches ADD COLUMN IF NOT EXISTS twitter TEXT NOT NULL DEFAULT '';
ALTER TABLE launches ADD COLUMN IF NOT EXISTS telegram TEXT NOT NULL DEFAULT '';
`;

export const MIGRATIONS: Migration[] = [
  { name: "0001_init", sql: INIT },
  { name: "0002_market", sql: MARKET },
  { name: "0003_exact_amounts", sql: EXACT_AMOUNTS },
  { name: "0004_launch_links", sql: LAUNCH_LINKS },
];
