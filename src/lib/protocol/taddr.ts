/**
 * Transparent Zcash address decoding, with no Node built-ins.
 *
 * The convert screen has to validate the address a person types before it is
 * memoed into a burn, so the base58check and bech32m checks below run in the
 * browser as well as on the server. That rules out `node:crypto`, hence the
 * self-contained SHA-256.
 */
import bs58 from "bs58";

export type TransparentNetwork = "zcash:main" | "zcash:test";
export type TransparentKind = "p2pkh" | "p2sh" | "tex";

export interface TransparentAddressCheck {
  ok: boolean;
  network: TransparentNetwork | null;
  kind: TransparentKind | null;
  message: string;
}

const VERSIONS: Record<string, { network: TransparentNetwork; kind: "p2pkh" | "p2sh" }> = {
  "1cb8": { network: "zcash:main", kind: "p2pkh" },
  "1cbd": { network: "zcash:main", kind: "p2sh" },
  "1d25": { network: "zcash:test", kind: "p2pkh" },
  "1cba": { network: "zcash:test", kind: "p2sh" },
};

const KIND_LABEL: Record<TransparentKind, string> = {
  p2pkh: "transparent address",
  p2sh: "transparent multisig address",
  tex: "ZIP-320 transparent-source-export address",
};

export function describeTransparent(check: TransparentAddressCheck): string {
  if (!check.ok || !check.kind || !check.network) return check.message;
  const network = check.network === "zcash:main" ? "mainnet" : "testnet";
  return `${network} ${KIND_LABEL[check.kind]}`;
}

export function validateTransparentAddress(address: string): TransparentAddressCheck {
  if (!address) return bad("Enter a Zcash transparent address.");
  if (address !== address.trim()) return bad("Remove the space around the address.");

  const lower = address.toLowerCase();
  if (lower.startsWith("u1") || lower.startsWith("utest1")) {
    return bad("That is a unified address. Protocol v0 stamps are transparent only.");
  }
  if (lower.startsWith("zs") || lower.startsWith("zc") || lower.startsWith("ztest")) {
    return bad("That is a shielded address. Protocol v0 stamps are transparent only.");
  }
  if (lower.startsWith("tex1") || lower.startsWith("textest1")) {
    return checkTex(address, lower.startsWith("tex1") ? "tex" : "textest");
  }

  let raw: Uint8Array;
  try {
    raw = bs58.decode(address);
  } catch {
    return bad("That is not a Zcash transparent address. Mainnet ones start with t1 or t3.");
  }
  if (raw.length !== 26) {
    return bad("A transparent Zcash address decodes to 26 bytes; this one does not.");
  }
  const payload = raw.subarray(0, 22);
  const checksum = raw.subarray(22);
  if (!bytesEq(checksum, sha256(sha256(payload)).subarray(0, 4))) {
    return bad("That address failed its checksum, so a character is wrong.");
  }
  const meta = VERSIONS[toHex(payload.subarray(0, 2))];
  if (!meta) {
    return bad("Those version bytes are not a Zcash transparent address.");
  }
  return { ok: true, network: meta.network, kind: meta.kind, message: "" };
}

function checkTex(address: string, hrp: string): TransparentAddressCheck {
  if (address.toLowerCase() !== address && address.toUpperCase() !== address) {
    return bad("A TEX address must not mix upper and lower case.");
  }
  if (!verifyBech32m(address.toLowerCase(), hrp)) {
    return bad("That TEX address failed its bech32m checksum.");
  }
  return {
    ok: true,
    network: hrp === "tex" ? "zcash:main" : "zcash:test",
    kind: "tex",
    message: "",
  };
}

function bad(message: string): TransparentAddressCheck {
  return { ok: false, network: null, kind: null, message };
}

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a[i]! ^ b[i]!;
  return x === 0;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/* ---------- bech32m, as ZIP 320 TEX addresses use it ---------- */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32M_CONST = 0x2bc830a3;

export function verifyBech32m(address: string, expectedHrp: string): boolean {
  const pos = address.lastIndexOf("1");
  if (pos < 1) return false;
  if (address.slice(0, pos) !== expectedHrp) return false;
  const values: number[] = [];
  for (const ch of address.slice(pos + 1)) {
    const v = CHARSET.indexOf(ch);
    if (v < 0) return false;
    values.push(v);
  }
  if (values.length < 6) return false;
  return polymod([...hrpExpand(expectedHrp), ...values]) === BECH32M_CONST;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i]!;
    }
  }
  return chk;
}

/* ---------- SHA-256, FIPS 180-4, no Node built-ins ---------- */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(input: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const padded = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = input.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 0x1_0000_0000), false);
  view.setUint32(padded.length - 4, bits >>> 0, false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let acc = h[7]!;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (acc + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      acc = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + acc) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]!, false);
  return out;
}

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}
