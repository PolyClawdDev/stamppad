import {
  ALLOWED_TOKEN_2022_EXTENSIONS,
  BURN_CHECKED_IX,
  BURN_IX,
  MEMO_PROGRAM_ID,
  NATIVE_MINT,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  REJECTED_TOKEN_2022_EXTENSIONS,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants";
import { validateDestination } from "./address";
import {
  bufferEq,
  commitmentOf,
  decodeIntent,
  decodeOpReturnPayload,
  encodeOpReturnPayload,
  readU64LE,
  toHex,
} from "./encoding";
import type {
  AcceptedIssuance,
  BurnDecode,
  CanonicalSolanaTx,
  ClaimPackage,
  DestNetwork,
  IssuanceFields,
  SourceNetwork,
  ValidationResult,
  ZcashPublication,
} from "./types";

export function decodeBurn(tx: CanonicalSolanaTx): BurnDecode | null {
  for (const item of tx.instructions) {
    const { programId, data, accounts } = item.instruction;
    if (programId !== TOKEN_PROGRAM_ID && programId !== TOKEN_2022_PROGRAM_ID) continue;
    if (data.length < 9 || accounts.length < 3) continue;
    const tag = data[0]!;
    if (tag !== BURN_IX && tag !== BURN_CHECKED_IX) continue;
    const amountBase = readU64LE(data, 1);
    const decimals = tag === BURN_CHECKED_IX && data.length >= 10 ? data[9]! : null;
    return {
      locator: item.locator,
      programId,
      tokenAccount: accounts[0]!,
      mint: accounts[1]!,
      authority: accounts[2]!,
      amountBase,
      decimals,
      checked: tag === BURN_CHECKED_IX,
    };
  }
  return null;
}

export function decodeIntents(tx: CanonicalSolanaTx) {
  const found = [];
  for (const item of tx.instructions) {
    if (item.instruction.programId !== MEMO_PROGRAM_ID) continue;
    const intent = decodeIntent(item.instruction.data, item.locator);
    if (intent) found.push(intent);
  }
  return found;
}

export function validateBurn(
  tx: CanonicalSolanaTx,
  expected: {
    sourceNetwork: SourceNetwork;
    destinationNetwork: DestNetwork;
    mint: string;
    amountBase: bigint;
    decimals: number;
    destination: string;
  },
): ValidationResult {
  if (tx.network !== expected.sourceNetwork) {
    return fail("wrong_network", `Transaction is on ${tx.network}, expected ${expected.sourceNetwork}.`);
  }
  if (tx.err) {
    return fail("tx_failed", "The Solana transaction failed. A failed burn cannot issue a stamp.");
  }
  if (tx.commitment !== "finalized") {
    return fail("not_finalized", "The burn is not finalized. STAMP only accepts finalized Solana transactions.");
  }

  const burn = decodeBurn(tx);
  if (!burn) {
    return fail("tx_failed", "No supported Token program Burn or BurnChecked instruction was found.");
  }
  if (burn.programId !== TOKEN_PROGRAM_ID && burn.programId !== TOKEN_2022_PROGRAM_ID) {
    return fail("wrong_program", "The burn was not executed by the classic Token program or Token-2022.");
  }
  if (burn.mint !== expected.mint || burn.mint !== tx.mint.address) {
    return fail("wrong_mint", "The burn mint does not match the claimed mint.");
  }
  if (tx.mint.address === NATIVE_MINT || burn.mint === NATIVE_MINT) {
    return fail("native_mint", "The native SOL mint cannot be burned for a stamp.");
  }
  if (tx.mint.programId !== burn.programId) {
    return fail("wrong_program", "Mint owner program does not match the burn program.");
  }
  if (!tx.mint.initialized) {
    return fail("wrong_mint", "Mint account is not initialized.");
  }
  if (burn.amountBase !== expected.amountBase || burn.amountBase <= 0n) {
    return fail("wrong_amount", "Burn amount does not match the claimed base units.");
  }
  if (tx.mint.decimals !== expected.decimals) {
    return fail("wrong_decimals", `Mint decimals are ${tx.mint.decimals}, claimed ${expected.decimals}.`);
  }
  if (burn.checked && burn.decimals !== tx.mint.decimals) {
    return fail("wrong_decimals", "BurnChecked decimals do not match the mint.");
  }

  const ext = rejectExtensions(tx.mint.extensions);
  if (ext) return ext;

  const account = tx.tokenAccounts[burn.tokenAccount];
  if (!account || account.mint !== burn.mint) {
    return fail("wrong_mint", "Token account does not belong to this mint.");
  }
  if (account.frozen) {
    return fail("frozen_account", "The token account is frozen, so the burn is not eligible.");
  }

  let authorityRole: "owner" | "delegate";
  if (account.owner === burn.authority) {
    authorityRole = "owner";
  } else if (account.delegate === burn.authority && account.delegatedAmount >= burn.amountBase) {
    authorityRole = "delegate";
  } else {
    return fail(
      "unsupported_authority",
      "Only the token account owner or an approved delegate may authorize a v0 stamp burn.",
    );
  }

  if (!tx.signers.includes(burn.authority)) {
    return fail("authority_not_signer", "The burn authority did not sign the transaction.");
  }

  const intents = decodeIntents(tx);
  if (intents.length === 0) {
    return fail(
      "missing_intent",
      "No STAMP intent memo was found in the same transaction. A memo alone on another transaction does not prove authority.",
    );
  }
  if (intents.length > 1) {
    return fail("intent_mismatch", "The transaction contains more than one STAMP intent memo.");
  }
  const intent = intents[0]!;
  if (intent.mint !== burn.mint || intent.amountBase !== burn.amountBase) {
    return fail("intent_mismatch", "Intent memo mint or amount does not match the burn.");
  }
  if (intent.destinationNetwork !== expected.destinationNetwork) {
    return fail("wrong_network", "Intent destination network does not match this validator.");
  }
  if (intent.destination !== expected.destination) {
    return fail(
      "unauthorized_destination",
      "The authorized destination in the signed intent does not match the claimed destination.",
    );
  }
  const dest = validateDestination(expected.destinationNetwork, intent.destination);
  if (!dest.ok) return fail("invalid_destination", dest.message);

  const issuance: IssuanceFields = {
    protocol: PROTOCOL_ID,
    version: PROTOCOL_VERSION,
    sourceNetwork: expected.sourceNetwork,
    destinationNetwork: expected.destinationNetwork,
    mint: burn.mint,
    tokenProgram: burn.programId,
    sourceTx: tx.signature,
    burnLocator: burn.locator,
    amountBase: burn.amountBase.toString(10),
    decimals: tx.mint.decimals,
    destination: intent.destination,
    burnAuthority: burn.authority,
    authorityRole,
    intentLocator: intent.locator,
    nonce: intent.nonce,
  };

  return {
    ok: true,
    issuance,
    commitment: commitmentOf(issuance),
    burn,
    intent,
  };
}

export function validatePublication(
  issuance: IssuanceFields,
  publication: ZcashPublication,
  minConfirmations: number,
): { ok: true } | { ok: false; reason: "zcash_payload_invalid" | "zcash_destination_missing" | "wrong_network"; message: string } {
  if (publication.network !== issuance.destinationNetwork) {
    return {
      ok: false,
      reason: "wrong_network",
      message: `Publication is on ${publication.network}, expected ${issuance.destinationNetwork}.`,
    };
  }
  const expected = encodeOpReturnPayload(commitmentOf(issuance));
  const dataOut = publication.outputs.find((o) => o.nullData && decodeOpReturnPayload(o.nullData));
  if (!dataOut?.nullData || !bufferEq(dataOut.nullData, expected)) {
    return {
      ok: false,
      reason: "zcash_payload_invalid",
      message: "Zcash transaction does not carry the expected STMP commitment in an OP_RETURN output.",
    };
  }
  const destOut = publication.outputs.find(
    (o) => o.address === issuance.destination && o.valueZat >= 10_000n,
  );
  if (!destOut) {
    return {
      ok: false,
      reason: "zcash_destination_missing",
      message: "Zcash transaction does not pay the authorized transparent destination.",
    };
  }
  if (!publication.inBestChain || publication.confirmations < minConfirmations) {
    return {
      ok: false,
      reason: "zcash_payload_invalid",
      message: `Publication is not confirmed to depth ${minConfirmations} on the best chain.`,
    };
  }
  return { ok: true };
}

/**
 * A mainnet inscription has no OP_RETURN. The reveal pays dust to the
 * destination and carries the envelope in the scriptSig, so the OP_RETURN
 * check used for demo publications does not apply.
 */
export function acceptPublishedStamp(
  issuance: IssuanceFields,
  publication: ZcashPublication,
): AcceptedIssuance {
  const destOut =
    publication.outputs.find((o) => o.address === issuance.destination) ?? publication.outputs[0];
  return {
    ...issuance,
    commitmentHex: toHex(commitmentOf(issuance)),
    zcashTx: publication.txid,
    zcashOutputIndex: destOut?.index ?? 0,
    zcashNullDataIndex: destOut?.index ?? 0,
    zcashHeight: publication.height ?? 0,
    confirmations: publication.confirmations,
  };
}

export function acceptIssuance(
  issuance: IssuanceFields,
  publication: ZcashPublication,
): AcceptedIssuance {
  const dataOut = publication.outputs.find((o) => o.nullData && decodeOpReturnPayload(o.nullData))!;
  const destOut = publication.outputs.find((o) => o.address === issuance.destination)!;
  return {
    ...issuance,
    commitmentHex: toHex(commitmentOf(issuance)),
    zcashTx: publication.txid,
    zcashOutputIndex: destOut.index,
    zcashNullDataIndex: dataOut.index,
    zcashHeight: publication.height ?? 0,
    confirmations: publication.confirmations,
  };
}

export function buildClaimPackage(issuance: IssuanceFields, tx: CanonicalSolanaTx): ClaimPackage {
  const commitment = commitmentOf(issuance);
  return {
    protocol: PROTOCOL_ID,
    version: PROTOCOL_VERSION,
    preimage: [
      PROTOCOL_ID,
      String(PROTOCOL_VERSION),
      issuance.sourceNetwork,
      issuance.destinationNetwork,
      issuance.mint,
      issuance.tokenProgram,
      issuance.sourceTx,
      issuance.burnLocator,
      issuance.amountBase,
      String(issuance.decimals),
      issuance.destination,
      issuance.burnAuthority,
      issuance.authorityRole,
      issuance.intentLocator,
      issuance.nonce,
    ].join("\n"),
    commitmentHex: toHex(commitment),
    solana: {
      network: tx.network,
      signature: tx.signature,
      transaction: tx,
    },
    destination: issuance.destination,
    zcashPayloadHex: toHex(encodeOpReturnPayload(commitment)),
    notes:
      "Another compatible publisher may create a transparent Zcash transaction paying destination and this OP_RETURN. Do not burn again. Paying publication fees is not custody of the burned tokens.",
  };
}

function rejectExtensions(extensions: string[]): ValidationResult | null {
  for (const ext of extensions) {
    if (REJECTED_TOKEN_2022_EXTENSIONS.has(ext)) {
      return fail(
        "unsupported_extension",
        `Mint extension “${ext}” is not supported. STAMP only accepts classic SPL mints or Token-2022 mints with metadata-related extensions.`,
      );
    }
    if (!ALLOWED_TOKEN_2022_EXTENSIONS.has(ext)) {
      return fail("unknown_extension", `Mint carries an unrecognized extension “${ext}”.`);
    }
  }
  return null;
}

function fail(reason: import("./types").RejectReason, message: string): ValidationResult {
  return { ok: false, reason, message };
}
