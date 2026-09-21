/**
 * secp256k1, only as much as recovering a public key from a signature needs.
 *
 * A transparent Zcash address commits to a secp256k1 key, and the only way to
 * prove control of one is to check a signature against it. Wallets emit the
 * recoverable form that Bitcoin Core established: a compact blob carrying r, s
 * and a recovery id, with no public key attached. Verifying it means recovering
 * the key and seeing which address it implies, so recovery is unavoidable.
 *
 * Node's crypto cannot recover, and neither can the Web Crypto API, so the
 * curve arithmetic lives here rather than in a new dependency. Affine
 * coordinates with a modular inverse per addition are slow, which does not
 * matter: this runs a handful of times per ownership proof, never in a loop.
 *
 * Scalars are compared and reduced but never branched on secretly, because
 * nothing here touches a private key. Verification is entirely public data.
 */

const P = BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f");
export const N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const B = 7n;
const G: Point = {
  x: BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
  y: BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8"),
};

/** An affine point, or null for the point at infinity. */
export type Point = { x: bigint; y: bigint } | null;

function mod(value: bigint, m: bigint = P): bigint {
  const r = value % m;
  return r >= 0n ? r : r + m;
}

function modPow(base: bigint, exponent: bigint, m: bigint): bigint {
  let result = 1n;
  let b = mod(base, m);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

/** Extended Euclid. Throws rather than returning a wrong answer for 0. */
function modInv(value: bigint, m: bigint): bigint {
  const a = mod(value, m);
  if (a === 0n) throw new Error("no inverse for zero");
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return mod(old_s, m);
}

export function isOnCurve(point: Point): boolean {
  if (!point) return true;
  return mod(point.y * point.y - point.x * point.x * point.x - B) === 0n;
}

function pointDouble(point: Point): Point {
  if (!point || point.y === 0n) return null;
  const slope = mod(3n * point.x * point.x * modInv(2n * point.y, P));
  const x = mod(slope * slope - 2n * point.x);
  return { x, y: mod(slope * (point.x - x) - point.y) };
}

export function pointAdd(a: Point, b: Point): Point {
  if (!a) return b;
  if (!b) return a;
  if (a.x === b.x) {
    // Same x means either a doubling or two points that cancel.
    return mod(a.y + b.y) === 0n ? null : pointDouble(a);
  }
  const slope = mod((b.y - a.y) * modInv(b.x - a.x, P));
  const x = mod(slope * slope - a.x - b.x);
  return { x, y: mod(slope * (a.x - x) - a.y) };
}

export function pointMul(scalar: bigint, point: Point): Point {
  let k = mod(scalar, N);
  if (k === 0n || !point) return null;
  let result: Point = null;
  let addend: Point = point;
  while (k > 0n) {
    if (k & 1n) result = pointAdd(result, addend);
    addend = pointDouble(addend);
    k >>= 1n;
  }
  return result;
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bigIntTo32Bytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function encodePoint(point: Point, compressed: boolean): Uint8Array {
  if (!point) throw new Error("cannot encode the point at infinity");
  const x = bigIntTo32Bytes(point.x);
  if (!compressed) {
    const out = new Uint8Array(65);
    out[0] = 0x04;
    out.set(x, 1);
    out.set(bigIntTo32Bytes(point.y), 33);
    return out;
  }
  const out = new Uint8Array(33);
  out[0] = point.y & 1n ? 0x03 : 0x02;
  out.set(x, 1);
  return out;
}

/**
 * Recovers the public key that signed `digest`, given a signature and which of
 * the candidate keys to take. Returns null when the recovery id describes a
 * point that is not on the curve, which is how a forged blob fails.
 */
export function recoverPublicKey(
  digest: Uint8Array,
  r: bigint,
  s: bigint,
  recoveryId: number,
): Point {
  if (r <= 0n || r >= N || s <= 0n || s >= N) return null;
  if (recoveryId < 0 || recoveryId > 3) return null;

  // The high bit of the recovery id says r overflowed the curve order. The
  // cofactor is 1, so only one extra candidate exists.
  const x = r + (recoveryId >> 1 ? N : 0n);
  if (x >= P) return null;

  const alpha = mod(x * x * x + B);
  // p is congruent to 3 mod 4, so this exponent is the square root.
  const beta = modPow(alpha, (P + 1n) / 4n, P);
  if (mod(beta * beta) !== alpha) return null;
  const y = (beta & 1n) === BigInt(recoveryId & 1) ? beta : P - beta;

  const R: Point = { x, y };
  if (!isOnCurve(R)) return null;

  const e = mod(bytesToBigInt(digest), N);
  const rInv = modInv(r, N);
  const point = pointAdd(
    pointMul(mod(s * rInv, N), R),
    pointMul(mod((N - e) * rInv, N), G),
  );
  if (!point || !isOnCurve(point)) return null;
  return point;
}

/** Verifies a signature against a known key, for checking recovery honestly. */
export function verifySignature(digest: Uint8Array, r: bigint, s: bigint, key: Point): boolean {
  if (!key || r <= 0n || r >= N || s <= 0n || s >= N) return false;
  const e = mod(bytesToBigInt(digest), N);
  const sInv = modInv(s, N);
  const point = pointAdd(pointMul(mod(e * sInv, N), G), pointMul(mod(r * sInv, N), key));
  if (!point) return false;
  return mod(point.x, N) === r;
}

export function decodePoint(bytes: Uint8Array): Point {
  if (bytes.length === 65 && bytes[0] === 0x04) {
    const point = { x: bytesToBigInt(bytes.subarray(1, 33)), y: bytesToBigInt(bytes.subarray(33)) };
    return isOnCurve(point) ? point : null;
  }
  if (bytes.length === 33 && (bytes[0] === 0x02 || bytes[0] === 0x03)) {
    const x = bytesToBigInt(bytes.subarray(1));
    if (x >= P) return null;
    const alpha = mod(x * x * x + B);
    const beta = modPow(alpha, (P + 1n) / 4n, P);
    if (mod(beta * beta) !== alpha) return null;
    const wantOdd = bytes[0] === 0x03;
    const y = (beta & 1n) === (wantOdd ? 1n : 0n) ? beta : P - beta;
    return { x, y };
  }
  return null;
}

export const generator = G;
