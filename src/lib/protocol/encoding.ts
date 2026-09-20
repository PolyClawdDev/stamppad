import { createHash } from "node:crypto";
import {
  DEST_NETWORK_CODE,
  DEST_NETWORK_FROM_CODE,
  INTENT_MAGIC,
  OP_RETURN_MAGIC,
  OP_RETURN_PAYLOAD_LEN,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
} from "./constants";
import type { DestNetwork, IssuanceFields, IntentV0 } from "./types";

export function sha256(data: Uint8Array | string): Uint8Array {
  return createHash("sha256").update(data).digest();
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function fromHex(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("invalid hex");
  }
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

export function canonicalPreimage(fields: IssuanceFields): string {
  return [
    PROTOCOL_ID,
    String(PROTOCOL_VERSION),
    fields.sourceNetwork,
    fields.destinationNetwork,
    fields.mint,
    fields.tokenProgram,
    fields.sourceTx,
    fields.burnLocator,
    fields.amountBase,
    String(fields.decimals),
    fields.destination,
    fields.burnAuthority,
    fields.authorityRole,
    fields.intentLocator,
    fields.nonce,
  ].join("\n");
}

export function commitmentOf(fields: IssuanceFields): Uint8Array {
  return sha256(canonicalPreimage(fields));
}

export function encodeIntent(intent: Omit<IntentV0, "locator">): Uint8Array {
  const dest = Buffer.from(intent.destination, "ascii");
  if (dest.length < 1 || dest.length > 90) {
    throw new Error("destination length out of range");
  }
  const nonce = fromHex(intent.nonce);
  if (nonce.length !== 16) throw new Error("nonce must be 16 bytes");
  const mint = decodeBase58Pubkey(intent.mint);
  const buf = Buffer.alloc(8 + dest.length + 8 + 32 + 16);
  INTENT_MAGIC.copy(buf, 0);
  buf.writeUInt16LE(0, 4);
  buf.writeUInt8(DEST_NETWORK_CODE[intent.destinationNetwork], 6);
  buf.writeUInt8(dest.length, 7);
  dest.copy(buf, 8);
  writeU64LE(buf, 8 + dest.length, intent.amountBase);
  Buffer.from(mint).copy(buf, 16 + dest.length);
  Buffer.from(nonce).copy(buf, 48 + dest.length);
  return new Uint8Array(buf);
}

export function decodeIntent(data: Uint8Array, locator: string): IntentV0 | null {
  if (data.length < 56) return null;
  if (!bufferEq(data.subarray(0, 4), INTENT_MAGIC)) return null;
  const version = data[4]! | (data[5]! << 8);
  if (version !== 0) return null;
  const netCode = data[6]!;
  const destNet = DEST_NETWORK_FROM_CODE[netCode];
  if (!destNet) return null;
  const n = data[7]!;
  if (n < 1 || n > 90) return null;
  if (data.length !== 8 + n + 8 + 32 + 16) return null;
  const destination = Buffer.from(data.subarray(8, 8 + n)).toString("ascii");
  const amountBase = readU64LE(data, 8 + n);
  const mint = encodeBase58(data.subarray(16 + n, 48 + n));
  const nonce = toHex(data.subarray(48 + n, 64 + n));
  return {
    version: 0,
    destinationNetwork: destNet,
    destination,
    amountBase,
    mint,
    nonce,
    locator,
  };
}

export function encodeOpReturnPayload(commitment: Uint8Array): Uint8Array {
  if (commitment.length !== 32) throw new Error("commitment must be 32 bytes");
  const buf = Buffer.alloc(OP_RETURN_PAYLOAD_LEN);
  OP_RETURN_MAGIC.copy(buf, 0);
  buf.writeUInt16LE(0, 4);
  Buffer.from(commitment).copy(buf, 6);
  return new Uint8Array(buf);
}

export function decodeOpReturnPayload(data: Uint8Array): Uint8Array | null {
  if (data.length !== OP_RETURN_PAYLOAD_LEN) return null;
  if (!bufferEq(data.subarray(0, 4), OP_RETURN_MAGIC)) return null;
  const version = data[4]! | (data[5]! << 8);
  if (version !== 0) return null;
  return data.subarray(6, 38);
}

export function writeU64LE(buf: Buffer, offset: number, value: bigint): void {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error("u64 out of range");
  }
  buf.writeBigUInt64LE(value, offset);
}

export function readU64LE(data: Uint8Array, offset: number): bigint {
  return Buffer.from(data.subarray(offset, offset + 8)).readBigUInt64LE(0);
}

export function bufferEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a[i]! ^ b[i]!;
  return x === 0;
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      const n = digits[j]! * 256 + carry;
      digits[j] = n % 58;
      carry = (n / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let zeros = 0;
  for (const b of bytes) {
    if (b === 0) zeros++;
    else break;
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => BASE58_ALPHABET[d]).join("");
}

export function decodeBase58(text: string): Uint8Array {
  if (!text) return new Uint8Array();
  const bytes = [0];
  for (const ch of text) {
    const value = BASE58_ALPHABET.indexOf(ch);
    if (value < 0) throw new Error("invalid base58");
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      const n = bytes[j]! * 58 + carry;
      bytes[j] = n % 256;
      carry = (n / 256) | 0;
    }
    while (carry > 0) {
      bytes.push(carry % 256);
      carry = (carry / 256) | 0;
    }
  }
  let zeros = 0;
  for (const ch of text) {
    if (ch === "1") zeros++;
    else break;
  }
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes.reverse()]);
}

export function decodeBase58Pubkey(text: string): Uint8Array {
  const raw = decodeBase58(text);
  if (raw.length !== 32) throw new Error("public key must be 32 bytes");
  return raw;
}

export function isBase58Pubkey(text: string): boolean {
  try {
    decodeBase58Pubkey(text);
    return true;
  } catch {
    return false;
  }
}

export function locatorOuter(index: number): string {
  return `outer:${index}`;
}

export function locatorInner(outer: number, inner: number): string {
  return `outer:${outer}/inner:${inner}`;
}

export function compareLocators(a: string, b: string): number {
  const pa = parseLocator(a);
  const pb = parseLocator(b);
  if (pa.outer !== pb.outer) return pa.outer - pb.outer;
  if (pa.inner === null && pb.inner === null) return 0;
  if (pa.inner === null) return -1;
  if (pb.inner === null) return 1;
  return pa.inner - pb.inner;
}

export function parseLocator(locator: string): { outer: number; inner: number | null } {
  const m = /^outer:(\d+)(?:\/inner:(\d+))?$/.exec(locator);
  if (!m) throw new Error(`invalid locator ${locator}`);
  return { outer: Number(m[1]), inner: m[2] === undefined ? null : Number(m[2]) };
}

export function destNetworkCode(network: DestNetwork): number {
  return DEST_NETWORK_CODE[network];
}
