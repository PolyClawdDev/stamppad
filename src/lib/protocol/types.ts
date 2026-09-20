import type { DEST_NETWORKS, SOURCE_NETWORKS } from "./constants";

export type SourceNetwork = (typeof SOURCE_NETWORKS)[number];
export type DestNetwork = (typeof DEST_NETWORKS)[number];
export type AuthorityRole = "owner" | "delegate";

export type JobState =
  | "draft"
  | "awaiting_authorization"
  | "burn_submitted"
  | "burn_finalized"
  | "publication_pending"
  | "zcash_confirmation_pending"
  | "confirmed"
  | "rejected"
  | "retryable"
  | "manual_review";

export type RejectReason =
  | "tx_failed"
  | "not_finalized"
  | "wrong_network"
  | "wrong_program"
  | "wrong_mint"
  | "wrong_amount"
  | "wrong_decimals"
  | "native_mint"
  | "unsupported_extension"
  | "frozen_account"
  | "unauthorized_destination"
  | "missing_intent"
  | "intent_mismatch"
  | "authority_not_signer"
  | "unsupported_authority"
  | "duplicate_claim"
  | "duplicate_publication"
  | "invalid_destination"
  | "zcash_payload_invalid"
  | "zcash_destination_missing"
  | "solana_reorg"
  | "insufficient_publication_funds"
  | "unknown_extension";

export interface InstructionRef {
  programId: string;
  accounts: string[];
  data: Uint8Array;
}

export interface CanonicalInstruction {
  locator: string;
  instruction: InstructionRef;
}

export interface TokenAccountView {
  address: string;
  mint: string;
  owner: string;
  amount: bigint;
  delegate: string | null;
  delegatedAmount: bigint;
  frozen: boolean;
}

export interface MintView {
  address: string;
  programId: string;
  supply: bigint;
  decimals: number;
  initialized: boolean;
  extensions: string[];
}

export interface CanonicalSolanaTx {
  signature: string;
  slot: number;
  network: SourceNetwork;
  commitment: "processed" | "confirmed" | "finalized";
  err: unknown | null;
  signers: string[];
  instructions: CanonicalInstruction[];
  tokenAccounts: Record<string, TokenAccountView>;
  mint: MintView;
}

export interface IntentV0 {
  version: 0;
  destinationNetwork: DestNetwork;
  destination: string;
  amountBase: bigint;
  mint: string;
  nonce: string;
  locator: string;
}

export interface BurnDecode {
  locator: string;
  programId: string;
  tokenAccount: string;
  mint: string;
  authority: string;
  amountBase: bigint;
  decimals: number | null;
  checked: boolean;
}

export interface IssuanceFields {
  protocol: "stamp-exp";
  version: 0;
  sourceNetwork: SourceNetwork;
  destinationNetwork: DestNetwork;
  mint: string;
  tokenProgram: string;
  sourceTx: string;
  burnLocator: string;
  amountBase: string;
  decimals: number;
  destination: string;
  burnAuthority: string;
  authorityRole: AuthorityRole;
  intentLocator: string;
  nonce: string;
}

export interface AcceptedIssuance extends IssuanceFields {
  commitmentHex: string;
  zcashTx: string;
  zcashOutputIndex: number;
  zcashNullDataIndex: number;
  zcashHeight: number;
  confirmations: number;
}

export interface ZcashPublication {
  txid: string;
  network: DestNetwork;
  height: number | null;
  confirmations: number;
  inBestChain: boolean;
  outputs: ZcashOutput[];
}

export interface ZcashOutput {
  index: number;
  valueZat: bigint;
  address: string | null;
  nullData: Uint8Array | null;
}

export interface ValidationOk {
  ok: true;
  issuance: IssuanceFields;
  commitment: Uint8Array;
  burn: BurnDecode;
  intent: IntentV0;
}

export interface ValidationErr {
  ok: false;
  reason: RejectReason;
  message: string;
}

export type ValidationResult = ValidationOk | ValidationErr;

export interface LedgerEvent {
  kind: "solana_tx" | "zcash_tx";
  solana?: CanonicalSolanaTx;
  zcash?: ZcashPublication;
}

export interface ClaimPackage {
  protocol: "stamp-exp";
  version: 0;
  preimage: string;
  commitmentHex: string;
  solana: {
    network: SourceNetwork;
    signature: string;
    transaction: CanonicalSolanaTx;
  };
  destination: string;
  zcashPayloadHex: string;
  notes: string;
}
