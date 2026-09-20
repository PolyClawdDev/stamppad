import { compareLocators, toHex } from "./encoding";
import { acceptIssuance, decodeBurn, decodeIntents, validateBurn, validatePublication } from "./validate";
import type {
  AcceptedIssuance,
  CanonicalSolanaTx,
  DestNetwork,
  SourceNetwork,
  ZcashPublication,
} from "./types";

export interface RebuildInput {
  sourceNetwork: SourceNetwork;
  destinationNetwork: DestNetwork;
  minZcashConfirmations: number;
  solana: CanonicalSolanaTx[];
  zcash: ZcashPublication[];
}

export interface RebuildOutput {
  accepted: AcceptedIssuance[];
  pending: Array<{ sourceTx: string; reason: string }>;
  rejected: Array<{ sourceTx: string; reason: string; message: string }>;
  acceptedStampUnits: Record<string, string>;
}

export function compareBurnEvents(a: CanonicalSolanaTx, b: CanonicalSolanaTx): number {
  if (a.slot !== b.slot) return a.slot - b.slot;
  if (a.signature !== b.signature) return a.signature < b.signature ? -1 : 1;
  return 0;
}

export function rebuildLedger(input: RebuildInput): RebuildOutput {
  const solana = [...input.solana].sort((a, b) => {
    const c = compareBurnEvents(a, b);
    if (c !== 0) return c;
    return 0;
  });

  const accepted: AcceptedIssuance[] = [];
  const pending: RebuildOutput["pending"] = [];
  const rejected: RebuildOutput["rejected"] = [];
  const seen = new Set<string>();
  const acceptedByCommitment = new Map<string, AcceptedIssuance>();

  for (const tx of solana) {
    const destGuess = guessDestination(tx, input.destinationNetwork);
    const burnAmt = guessAmount(tx);
    if (!destGuess || burnAmt === null) {
      rejected.push({
        sourceTx: tx.signature,
        reason: "missing_intent",
        message: "Transaction is not a complete STAMP burn+intent pair.",
      });
      continue;
    }
    const result = validateBurn(tx, {
      sourceNetwork: input.sourceNetwork,
      destinationNetwork: input.destinationNetwork,
      mint: tx.mint.address,
      amountBase: burnAmt,
      decimals: tx.mint.decimals,
      destination: destGuess,
    });
    if (!result.ok) {
      rejected.push({ sourceTx: tx.signature, reason: result.reason, message: result.message });
      continue;
    }

    const eventId = `${result.issuance.sourceNetwork}:${result.issuance.sourceTx}:${result.issuance.burnLocator}`;
    if (seen.has(eventId)) {
      rejected.push({
        sourceTx: tx.signature,
        reason: "duplicate_claim",
        message: "A previous accepted or pending claim already covers this burn event.",
      });
      continue;
    }

    const matches = input.zcash
      .filter((z) => publicationMatches(result.issuance, z, input.minZcashConfirmations))
      .sort((a, b) => (a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : 0));

    if (matches.length === 0) {
      const anyPub = input.zcash.find((z) =>
        z.outputs.some((o) => o.nullData && toHex(o.nullData).includes(toHex(result.commitment))),
      );
      if (anyPub && (!anyPub.inBestChain || anyPub.confirmations < input.minZcashConfirmations)) {
        pending.push({
          sourceTx: tx.signature,
          reason: "zcash_confirmation_pending",
        });
      } else {
        pending.push({ sourceTx: tx.signature, reason: "publication_pending" });
      }
      seen.add(eventId);
      continue;
    }

    const winner = matches[0]!;
    for (const extra of matches.slice(1)) {
      rejected.push({
        sourceTx: tx.signature,
        reason: "duplicate_publication",
        message: `Losing publication ${extra.txid}; winner is ${winner.txid}.`,
      });
    }

    const acceptedRow = acceptIssuance(result.issuance, winner);
    accepted.push(acceptedRow);
    acceptedByCommitment.set(acceptedRow.commitmentHex, acceptedRow);
    seen.add(eventId);
  }

  accepted.sort((a, b) => {
    if (a.sourceTx !== b.sourceTx) return a.sourceTx < b.sourceTx ? -1 : 1;
    return compareLocators(a.burnLocator, b.burnLocator);
  });

  const acceptedStampUnits: Record<string, string> = {};
  for (const row of accepted) {
    const prev = BigInt(acceptedStampUnits[row.mint] ?? "0");
    acceptedStampUnits[row.mint] = (prev + BigInt(row.amountBase)).toString(10);
  }

  void acceptedByCommitment;
  return { accepted, pending, rejected, acceptedStampUnits };
}

function guessDestination(tx: CanonicalSolanaTx, network: DestNetwork): string | null {
  const intents = decodeIntents(tx);
  const match = intents.find((i) => i.destinationNetwork === network);
  return match?.destination ?? null;
}

function guessAmount(tx: CanonicalSolanaTx): bigint | null {
  return decodeBurn(tx)?.amountBase ?? null;
}

function publicationMatches(
  issuance: import("./types").IssuanceFields,
  publication: ZcashPublication,
  min: number,
): boolean {
  return validatePublication(issuance, publication, min).ok;
}

export function stableLedgerJson(output: RebuildOutput): string {
  return `${JSON.stringify(output, null, 2)}\n`;
}
