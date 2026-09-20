import { createHash } from "node:crypto";
import type { DestNetwork } from "./types";
import { decodeBase58, encodeBase58 } from "./encoding";

const VERSIONS: Record<string, { network: DestNetwork; kind: "p2pkh" | "p2sh" }> = {
  "1cb8": { network: "zcash:main", kind: "p2pkh" },
  "1cbd": { network: "zcash:main", kind: "p2sh" },
  "1d25": { network: "zcash:test", kind: "p2pkh" },
  "1cba": { network: "zcash:test", kind: "p2sh" },
};

export function validateDestination(
  network: DestNetwork,
  address: string,
): { ok: boolean; message: string } {
  if (network === "zcash:demo") {
    if (/^zdemo1[0-9a-z]{20,80}$/.test(address)) {
      return { ok: true, message: "demo transparent destination" };
    }
    return {
      ok: false,
      message:
        "Demo destinations look like zdemo1… (20–80 lowercase characters). Shielded z-addresses are not accepted.",
    };
  }

  if (address.startsWith("z") && !address.startsWith("zdemo1")) {
    return {
      ok: false,
      message:
        "Shielded and unified addresses are rejected in protocol v0. Ordinary stamps are transparent.",
    };
  }

  if (network === "zcash:main" && address.toLowerCase().startsWith("tex1")) {
    return validateBech32m(address, "tex");
  }
  if (network === "zcash:test" && address.toLowerCase().startsWith("textest1")) {
    return validateBech32m(address, "textest");
  }

  try {
    const raw = decodeBase58(address);
    if (raw.length < 6) {
      return { ok: false, message: "Destination is too short to be a transparent Zcash address." };
    }
    const payload = raw.subarray(0, raw.length - 4);
    const checksum = raw.subarray(raw.length - 4);
    const hash = sha256d(payload);
    if (!bytesEq(checksum, hash.subarray(0, 4))) {
      return { ok: false, message: "Destination failed the transparent address checksum." };
    }
    const version = Buffer.from(payload.subarray(0, 2)).toString("hex");
    const meta = VERSIONS[version];
    if (!meta || meta.network !== network) {
      return {
        ok: false,
        message: `Destination version bytes do not match ${network}. Use a transparent address for that network.`,
      };
    }
    return { ok: true, message: `${meta.kind} transparent address` };
  } catch {
    return { ok: false, message: "Destination is not a valid transparent Zcash address." };
  }
}

function sha256d(data: Uint8Array): Buffer {
  const once = createHash("sha256").update(data).digest();
  return createHash("sha256").update(once).digest();
}

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a[i]! ^ b[i]!;
  return x === 0;
}

function validateBech32m(address: string, hrp: string): { ok: boolean; message: string } {
  if (address.toLowerCase() !== address && address.toUpperCase() !== address) {
    return { ok: false, message: "TEX address must not mix case." };
  }
  return verifyBech32m(address.toLowerCase(), hrp)
    ? { ok: true, message: "ZIP-320 transparent-source-export address" }
    : { ok: false, message: "TEX address failed bech32m checksum." };
}

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32M_CONST = 0x2bc830a3;

function verifyBech32m(address: string, expectedHrp: string): boolean {
  const pos = address.lastIndexOf("1");
  if (pos < 1) return false;
  const hrp = address.slice(0, pos);
  const dataPart = address.slice(pos + 1);
  if (hrp !== expectedHrp) return false;
  const values: number[] = [];
  for (const ch of dataPart) {
    const v = CHARSET.indexOf(ch);
    if (v < 0) return false;
    values.push(v);
  }
  if (values.length < 6) return false;
  return bech32Polymod([...hrpExpand(hrp), ...values]) === BECH32M_CONST;
}

function hrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (const c of hrp) ret.push(c.charCodeAt(0) >> 5);
  ret.push(0);
  for (const c of hrp) ret.push(c.charCodeAt(0) & 31);
  return ret;
}

function bech32Polymod(values: number[]): number {
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

export function encodeDemoDestination(suffix: string): string {
  const body = suffix
    .toLowerCase()
    .replace(/[^0-9a-z]/g, "")
    .padEnd(20, "0")
    .slice(0, 40);
  return `zdemo1${body}`;
}

export function encodeMainnetLikeTestVector(): string {
  const version = Buffer.from("1cb8", "hex");
  const payload = Buffer.concat([version, Buffer.alloc(20, 7)]);
  const checksum = sha256d(payload).subarray(0, 4);
  return encodeBase58(Buffer.concat([payload, checksum]));
}
