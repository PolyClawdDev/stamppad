/**
 * Which stamps count.
 *
 * Zcash consensus has no opinion here. The reveal script drops the envelope
 * after checking one signature, so the chain will happily carry a stamp that
 * cites a burn nobody made. The rule is applied off-chain, and this module is
 * that rule: a stamp counts only if it cites a finalized Solana burn that
 * nobody has already claimed, for exactly the amount destroyed, delivered to
 * the address the burner named in the same transaction.
 *
 * Everything here is a pure function over observed chain data, so two
 * operators reading the same blocks derive the same set. Formats follow what
 * the chains actually return; see src/lib/zcash/inscription.ts for the
 * envelope decoded off mainnet.
 */
import { decodeStamp, type StampPayload } from "./zcash/inscription";

/** A reveal transaction observed on Zcash. */
export interface ObservedInscription {
  txid: string;
  height: number;
  /** Full scriptSig of the spending input, envelope included. */
  scriptSigHex: string;
  /** Outputs of the reveal, in order. The stamp is delivered by paying dust. */
  outputs: Array<{ address: string; zatoshis: number }>;
}

/** A burn observed on Solana, reduced to the fields the rule depends on. */
export interface ObservedBurn {
  signature: string;
  slot: number;
  /** False while the transaction is still short of the required commitment. */
  finalized: boolean;
  /** Non-null when the transaction failed. A failed burn destroyed nothing. */
  err: unknown;
  mint: string;
  /** Destroyed amount in base units. */
  amountBase: string;
  decimals: number;
  /** Authority that signed the burn instruction. */
  authority: string;
  /** Memos carried by the same transaction, with the account that signed each. */
  memos: Array<{ text: string; signer: string }>;
}

export type RejectionReason =
  | "not_an_inscription"
  | "foreign_protocol"
  | "burn_not_found"
  | "burn_failed"
  | "burn_unconfirmed"
  | "mint_mismatch"
  | "amount_mismatch"
  | "recipient_unauthorized"
  | "not_delivered"
  | "already_claimed";

export interface AcceptedStamp {
  /** The reveal transaction is the stamp's identity. */
  id: string;
  height: number;
  payload: StampPayload;
  burn: ObservedBurn;
  /** Zatoshis paid to the recipient by the reveal. */
  deliveredZatoshis: number;
}

export interface RejectedStamp {
  id: string;
  height: number;
  reason: RejectionReason;
  message: string;
  /** Present whenever the envelope decoded, even if the claim failed. */
  payload: StampPayload | null;
}

export interface PendingStamp {
  id: string;
  height: number;
  payload: StampPayload;
  confirmations: number;
}

export interface StampSet {
  accepted: AcceptedStamp[];
  rejected: RejectedStamp[];
  pending: PendingStamp[];
  /** Accepted base units per Solana mint. Equals the burns claimed, exactly. */
  supplyByMint: Record<string, string>;
  /** Accepted stamp id per burn signature. One burn, one stamp. */
  claimedBurns: Record<string, string>;
}

export interface IndexOptions {
  inscriptions: ObservedInscription[];
  burns: ObservedBurn[];
  /** Zcash chain tip, for confirmation counting. */
  tipHeight: number;
  minConfirmations: number;
  /**
   * Protocol identifiers to index. Reading another project's identifier is
   * fine; writing one we do not own is not, so this is a read-side list.
   */
  acceptProtocols: string[];
}

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) return null;
  return Uint8Array.from(clean.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
}

/**
 * Orders inscriptions the way both chains agree on: by height, then by txid.
 * Two indexers must break ties identically or they disagree about who claimed
 * a burn first.
 */
function canonicalOrder(a: ObservedInscription, b: ObservedInscription): number {
  if (a.height !== b.height) return a.height - b.height;
  return a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : 0;
}

export function indexInscriptions(options: IndexOptions): StampSet {
  const burns = new Map(options.burns.map((burn) => [burn.signature, burn]));
  const accepted: AcceptedStamp[] = [];
  const rejected: RejectedStamp[] = [];
  const pending: PendingStamp[] = [];
  const claimedBurns: Record<string, string> = {};
  const supply = new Map<string, bigint>();

  const reject = (
    item: ObservedInscription,
    reason: RejectionReason,
    message: string,
    payload: StampPayload | null,
  ) => {
    rejected.push({ id: item.txid, height: item.height, reason, message, payload });
  };

  for (const item of [...options.inscriptions].sort(canonicalOrder)) {
    const script = hexToBytes(item.scriptSigHex);
    const payload = script ? decodeStamp(script) : null;
    if (!payload) {
      reject(item, "not_an_inscription", "No stamp envelope in this transaction.", null);
      continue;
    }

    if (!options.acceptProtocols.includes(payload.p)) {
      reject(item, "foreign_protocol", `Protocol "${payload.p}" is not indexed here.`, payload);
      continue;
    }

    const confirmations = options.tipHeight - item.height + 1;
    if (confirmations < options.minConfirmations) {
      pending.push({ id: item.txid, height: item.height, payload, confirmations });
      continue;
    }

    const burn = burns.get(payload.burn);
    if (!burn) {
      reject(item, "burn_not_found", "The burn this stamp cites is not on Solana.", payload);
      continue;
    }
    if (burn.err !== null) {
      reject(item, "burn_failed", "The cited transaction failed, so nothing was burned.", payload);
      continue;
    }
    if (!burn.finalized) {
      reject(item, "burn_unconfirmed", "The cited burn is not finalized.", payload);
      continue;
    }
    if (burn.mint !== payload.mint) {
      reject(
        item,
        "mint_mismatch",
        `Stamp names ${payload.mint} but the burn destroyed ${burn.mint}.`,
        payload,
      );
      continue;
    }
    if (burn.amountBase !== payload.amt) {
      reject(
        item,
        "amount_mismatch",
        `Stamp claims ${payload.amt} base units; the burn destroyed ${burn.amountBase}.`,
        payload,
      );
      continue;
    }

    // The burner chose the destination by memoing it in the burn transaction,
    // signed by the same authority. Anything else is recipient substitution.
    const authorized = burn.memos.some(
      (memo) => memo.text.trim() === payload.to && memo.signer === burn.authority,
    );
    if (!authorized) {
      reject(
        item,
        "recipient_unauthorized",
        "The burn does not carry a memo from its authority naming this address.",
        payload,
      );
      continue;
    }

    const delivered = item.outputs
      .filter((output) => output.address === payload.to)
      .reduce((sum, output) => sum + output.zatoshis, 0);
    if (delivered <= 0) {
      reject(item, "not_delivered", "The reveal pays nothing to the stamp's address.", payload);
      continue;
    }

    const existing = claimedBurns[payload.burn];
    if (existing) {
      reject(item, "already_claimed", `Burn already claimed by stamp ${existing}.`, payload);
      continue;
    }

    claimedBurns[payload.burn] = item.txid;
    supply.set(payload.mint, (supply.get(payload.mint) ?? 0n) + BigInt(payload.amt));
    accepted.push({
      id: item.txid,
      height: item.height,
      payload,
      burn,
      deliveredZatoshis: delivered,
    });
  }

  const supplyByMint: Record<string, string> = {};
  for (const [mint, units] of [...supply.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    supplyByMint[mint] = units.toString(10);
  }

  return { accepted, rejected, pending, supplyByMint, claimedBurns };
}

/**
 * Accepted supply must equal the burns those stamps claim, per mint. If this
 * ever fails, the set is wrong rather than merely surprising.
 */
export function supplyEqualsBurns(set: StampSet): boolean {
  const fromBurns = new Map<string, bigint>();
  for (const stamp of set.accepted) {
    fromBurns.set(
      stamp.burn.mint,
      (fromBurns.get(stamp.burn.mint) ?? 0n) + BigInt(stamp.burn.amountBase),
    );
  }
  const mints = new Set([...Object.keys(set.supplyByMint), ...fromBurns.keys()]);
  for (const mint of mints) {
    if ((set.supplyByMint[mint] ?? "0") !== (fromBurns.get(mint) ?? 0n).toString(10)) return false;
  }
  return true;
}
