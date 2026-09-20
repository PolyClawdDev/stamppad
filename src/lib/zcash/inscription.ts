/**
 * Zcash inscription envelope, as observed on mainnet.
 *
 * Decoded from the live stamp in transaction
 * b2cbded5c37c2cca8918a077a73e2ca349005efba046cee0866b34dd879c5acb
 * (block 3,490,084, 2026-09-20) and its commit
 * 09c6f37b77ba89584112dae21731efa0e7f138f9e6289952c7c8f839f3095050.
 *
 * The payload does NOT go in an OP_RETURN. It rides in the redeem script of a
 * P2SH input, which is why it can exceed zebrad's 80-byte datacarrier limit:
 * the commit transaction pays a P2SH address, and the reveal spends it with the
 * data pushed in the scriptSig. The reveal pays dust to the stamp's recipient.
 *
 * The tag grammar below is inferred from a single mainnet sample, so it is
 * asserted byte-for-byte in tests rather than assumed. Anything read off the
 * chain is decoded permissively; anything we write follows the sample exactly.
 */

/** Marker that opens every envelope. */
export const ENVELOPE_MAGIC = "ord";

/** Tag preceding the content type. */
const TAG_CONTENT_TYPE = 0x52; // OP_2
/** Tag preceding the first body chunk. */
const TAG_BODY = 0x51; // OP_1
/** Tag preceding each continuation chunk. */
const TAG_CONTINUATION = 0x00; // OP_0

export const CONTENT_TYPE = "application/json";

/**
 * The observed encoder splits the body at 240 bytes even though a script push
 * may carry 520, so chunking is reproduced at 240 to stay byte-identical.
 */
const CHUNK_BYTES = 240;

/** Field order as written on chain. JSON is compared as bytes, so order matters. */
export interface StampPayload {
  /** Protocol identifier. The mainnet sample carries "zsamtest". */
  p: string;
  op: "mint";
  v: number;
  /** Solana mint whose units were destroyed. */
  mint: string;
  /** Solana transaction signature of the burn being claimed. */
  burn: string;
  /** Destroyed amount in the mint's base units, as a decimal string. */
  amt: string;
  /** Zcash transparent address the stamp is delivered to. */
  to: string;
}

function pushData(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 0x4c) return Uint8Array.from([bytes.length, ...bytes]);
  if (bytes.length <= 0xff) return Uint8Array.from([0x4c, bytes.length, ...bytes]);
  if (bytes.length <= 0xffff) {
    return Uint8Array.from([0x4d, bytes.length & 0xff, bytes.length >> 8, ...bytes]);
  }
  throw new Error("inscription chunk exceeds two-byte push length");
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Canonical JSON for a stamp. Key order is fixed because the bytes are the record. */
export function encodePayload(payload: StampPayload): string {
  return JSON.stringify({
    p: payload.p,
    op: payload.op,
    v: payload.v,
    mint: payload.mint,
    burn: payload.burn,
    amt: payload.amt,
    to: payload.to,
  });
}

/** The data section of the reveal scriptSig: magic, content type, and body chunks. */
export function encodeEnvelope(body: string, contentType = CONTENT_TYPE): Uint8Array {
  const bytes = new TextEncoder().encode(body);
  const parts: Uint8Array[] = [
    pushData(new TextEncoder().encode(ENVELOPE_MAGIC)),
    Uint8Array.from([TAG_CONTENT_TYPE]),
    pushData(new TextEncoder().encode(contentType)),
  ];
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    parts.push(Uint8Array.from([offset === 0 ? TAG_BODY : TAG_CONTINUATION]));
    parts.push(pushData(bytes.subarray(offset, offset + CHUNK_BYTES)));
  }
  return concat(parts);
}

export function encodeStamp(payload: StampPayload): Uint8Array {
  return encodeEnvelope(encodePayload(payload));
}

interface ScriptItem {
  opcode?: number;
  data?: Uint8Array;
}

/** Splits a script into pushes and bare opcodes. Stops cleanly on a truncated push. */
export function parseScript(script: Uint8Array): ScriptItem[] {
  const items: ScriptItem[] = [];
  let offset = 0;
  while (offset < script.length) {
    const opcode = script[offset];
    let length: number | null = null;
    let headerBytes = 1;
    if (opcode >= 0x01 && opcode <= 0x4b) {
      length = opcode;
    } else if (opcode === 0x4c) {
      length = script[offset + 1];
      headerBytes = 2;
    } else if (opcode === 0x4d) {
      length = script[offset + 1] | (script[offset + 2] << 8);
      headerBytes = 3;
    }
    if (length === null) {
      items.push({ opcode });
      offset += 1;
      continue;
    }
    const start = offset + headerBytes;
    if (start + length > script.length) break;
    items.push({ data: script.subarray(start, start + length) });
    offset = start + length;
  }
  return items;
}

export interface DecodedEnvelope {
  contentType: string;
  body: string;
}

/**
 * Pulls the envelope out of a reveal scriptSig. The signature and redeem script
 * that follow the data section are ignored, so this works on a full scriptSig.
 */
export function decodeEnvelope(script: Uint8Array): DecodedEnvelope | null {
  const items = parseScript(script);
  const start = items.findIndex(
    (item) => item.data && new TextDecoder().decode(item.data) === ENVELOPE_MAGIC,
  );
  if (start < 0) return null;

  let contentType = "";
  const chunks: Uint8Array[] = [];
  let reading: "none" | "contentType" | "body" = "none";

  for (const item of items.slice(start + 1)) {
    if (item.opcode === TAG_CONTENT_TYPE) {
      reading = "contentType";
      continue;
    }
    if (item.opcode === TAG_BODY || item.opcode === TAG_CONTINUATION) {
      reading = "body";
      continue;
    }
    if (!item.data) continue;
    if (reading === "contentType") {
      contentType = new TextDecoder().decode(item.data);
      reading = "none";
      continue;
    }
    if (reading === "body") {
      chunks.push(item.data);
      reading = "none";
    }
  }

  if (chunks.length === 0) return null;
  return { contentType, body: new TextDecoder().decode(concat(chunks)) };
}

/** Decodes and validates a stamp payload. Returns null for anything unrecognised. */
export function decodeStamp(script: Uint8Array): StampPayload | null {
  const envelope = decodeEnvelope(script);
  if (!envelope) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope.body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  if (value.op !== "mint") return null;
  if (
    typeof value.p !== "string" ||
    typeof value.mint !== "string" ||
    typeof value.burn !== "string" ||
    typeof value.amt !== "string" ||
    typeof value.to !== "string" ||
    typeof value.v !== "number"
  ) {
    return null;
  }
  if (!/^[0-9]+$/.test(value.amt)) return null;
  return {
    p: value.p,
    op: "mint",
    v: value.v,
    mint: value.mint,
    burn: value.burn,
    amt: value.amt,
    to: value.to,
  };
}

export interface RevealScript {
  /** Public key the reveal signature is checked against. */
  publicKey: Uint8Array;
  /** 32-byte value committed to the script and immediately dropped. */
  commitment: Uint8Array;
  /** Number of OP_DROPs clearing the pushed envelope items. */
  drops: number;
}

/**
 * Reads the redeem script of a reveal input.
 *
 * Observed shape: <pubkey> OP_CHECKSIGVERIFY <32 bytes> OP_DROP x8 OP_1. Only
 * the signature is enforced; the commitment and envelope are dropped, so Zcash
 * consensus has no opinion on whether the stamp is valid. That is why the
 * indexer, not the chain, decides which stamps count.
 */
export function decodeRedeemScript(script: Uint8Array): RevealScript | null {
  const items = parseScript(script);
  const pushes = items.filter((item) => item.data);
  const publicKey = pushes.find((item) => item.data!.length === 33)?.data;
  const commitment = pushes.find((item) => item.data!.length === 32)?.data;
  if (!publicKey || !commitment) return null;
  const drops = items.filter((item) => item.opcode === 0x75).length;
  return { publicKey, commitment, drops };
}
