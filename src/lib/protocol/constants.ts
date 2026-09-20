export const PROTOCOL_ID = "stamp-exp" as const;
export const PROTOCOL_VERSION = 0 as const;

export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96QnHj5ZbxdnGBnVWJChLWKFgS4";
export const NATIVE_MINT = "So11111111111111111111111111111111111111112";

export const BURN_IX = 8;
export const BURN_CHECKED_IX = 15;

export const INTENT_MAGIC = Buffer.from("STMP");
export const OP_RETURN_MAGIC = Buffer.from("STMP");
export const TRANSFER_MAGIC = Buffer.from("STMX");
export const OFFER_MAGIC = Buffer.from("STMO");
export const OP_RETURN_PAYLOAD_LEN = 38;
export const RECORD_PAYLOAD_LEN = 74;

/**
 * zebrad rejects a transaction whose OP_RETURN script exceeds
 * DEFAULT_MAX_DATACARRIER_BYTES (83 = OP_RETURN + pushdata overhead + 80 data
 * bytes), and permits at most one such output per transaction.
 */
export const OP_RETURN_DATA_LIMIT = 80;
export const OP_RETURN_OUTPUTS_PER_TX = 1;

export const DESTINATION_NOTICE_ZATOSHIS = 10_000n;
export const ZIP317_MARGINAL_FEE = 5_000n;
export const ZIP317_GRACE_ACTIONS = 2n;

/** Issuance is ownership sequence 0. Transfer n moves the stamp to sequence n. */
export const GENESIS_SEQUENCE = 0;

export const SOURCE_NETWORKS = [
  "solana:demo",
  "solana:devnet",
  "solana:mainnet-beta",
] as const;

export const DEST_NETWORKS = ["zcash:demo", "zcash:test", "zcash:main"] as const;

export const DEST_NETWORK_CODE: Record<(typeof DEST_NETWORKS)[number], number> = {
  "zcash:demo": 0,
  "zcash:test": 1,
  "zcash:main": 2,
};

export const DEST_NETWORK_FROM_CODE: Record<number, (typeof DEST_NETWORKS)[number]> = {
  0: "zcash:demo",
  1: "zcash:test",
  2: "zcash:main",
};

export const ALLOWED_TOKEN_2022_EXTENSIONS = new Set([
  "metadataPointer",
  "tokenMetadata",
  "mintCloseAuthority",
]);

export const REJECTED_TOKEN_2022_EXTENSIONS = new Set([
  "transferFeeConfig",
  "transferHook",
  "confidentialTransferMint",
  "pausable",
  "permissionedBurn",
  "permanentDelegate",
  "nonTransferable",
  "interestBearingConfig",
  "scaledUiAmount",
  "defaultAccountState",
]);
