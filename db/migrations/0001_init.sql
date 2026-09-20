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
