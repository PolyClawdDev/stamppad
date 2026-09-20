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
