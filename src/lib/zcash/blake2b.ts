/**
 * BLAKE2b with personalization, per RFC 7693 and the BLAKE2 specification.
 *
 * Every digest in ZIP-244 is a personalized BLAKE2b-256, and personalization is
 * precisely the part Node cannot do: `createHash("blake2b512")` exposes no salt
 * or personal field, and there is no 256-bit variant. The personal string is
 * what separates a txid from a signature digest from a block commitment, so
 * without it nothing here can be computed at all.
 *
 * Personalization only changes the initial chaining value: the 64-byte
 * parameter block is XORed into IV before any data is absorbed. That means the
 * compression function can be checked against Node's blake2b512 on arbitrary
 * input, and the parameter handling can be checked against the RFC's keyed and
 * unkeyed vectors. Both are done in the tests, along with reproducing a real
 * mainnet txid, which exercises the personalized path end to end.
 */

const MASK = (1n << 64n) - 1n;

const IV: readonly bigint[] = [
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n,
];

/** Message-word permutation, ten rounds' worth; rounds 10 and 11 reuse 0 and 1. */
const SIGMA: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];

const BLOCK_BYTES = 128;

function rotr64(value: bigint, bits: bigint): bigint {
  return ((value >> bits) | (value << (64n - bits))) & MASK;
}

export interface Blake2bOptions {
  /** Output length in bytes, 1 to 64. ZIP-244 uses 32 throughout. */
  digestLength?: number;
  /** 16-byte personalization. Shorter strings are zero-padded, as BLAKE2 requires. */
  personal?: Uint8Array | string;
  /** 16-byte salt. Unused by Zcash, present because the parameter block has it. */
  salt?: Uint8Array;
  /** Up to 64 key bytes. Unused by Zcash; kept so the RFC vectors can be run. */
  key?: Uint8Array;
}

function fixedWidth(value: Uint8Array | string | undefined, width: number, label: string): Uint8Array {
  const out = new Uint8Array(width);
  if (value === undefined) return out;
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (bytes.length > width) throw new Error(`${label} must be at most ${width} bytes`);
  out.set(bytes);
  return out;
}

class Blake2b {
  private readonly h: bigint[];
  private readonly digestLength: number;
  private readonly block = new Uint8Array(BLOCK_BYTES);
  private blockLength = 0;
  /** Bytes absorbed, including the block currently buffered. */
  private counter = 0n;
  private finished = false;

  constructor(options: Blake2bOptions = {}) {
    const digestLength = options.digestLength ?? 64;
    if (digestLength < 1 || digestLength > 64) throw new Error("digest length must be 1..64 bytes");
    const key = options.key ?? new Uint8Array(0);
    if (key.length > 64) throw new Error("key must be at most 64 bytes");

    // Parameter block: length, key length, fanout 1, depth 1, then salt and
    // personal in the last 32 bytes. Everything else is zero for sequential use.
    const params = new Uint8Array(64);
    params[0] = digestLength;
    params[1] = key.length;
    params[2] = 1;
    params[3] = 1;
    params.set(fixedWidth(options.salt, 16, "salt"), 32);
    params.set(fixedWidth(options.personal, 16, "personalization"), 48);

    const view = new DataView(params.buffer);
    this.h = IV.map((word, i) => word ^ view.getBigUint64(i * 8, true));
    this.digestLength = digestLength;

    // A keyed hash absorbs the key as a full, separately padded first block.
    if (key.length > 0) {
      const keyBlock = new Uint8Array(BLOCK_BYTES);
      keyBlock.set(key);
      this.update(keyBlock);
    }
  }

  update(input: Uint8Array): this {
    if (this.finished) throw new Error("blake2b instance already finalized");
    let offset = 0;
    while (offset < input.length) {
      if (this.blockLength === BLOCK_BYTES) {
        // Hold the last full block back: the counter for a non-final block must
        // not include bytes that turn out to be the tail of the message.
        this.compress(this.block, false);
        this.blockLength = 0;
      }
      const take = Math.min(BLOCK_BYTES - this.blockLength, input.length - offset);
      this.block.set(input.subarray(offset, offset + take), this.blockLength);
      this.blockLength += take;
      this.counter += BigInt(take);
      offset += take;
    }
    return this;
  }

  digest(): Uint8Array {
    if (this.finished) throw new Error("blake2b instance already finalized");
    this.finished = true;
    this.block.fill(0, this.blockLength);
    this.compress(this.block, true);

    const out = new Uint8Array(64);
    const view = new DataView(out.buffer);
    for (let i = 0; i < 8; i += 1) view.setBigUint64(i * 8, this.h[i]!, true);
    return out.subarray(0, this.digestLength);
  }

  private compress(block: Uint8Array, last: boolean): void {
    const m: bigint[] = new Array(16);
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    for (let i = 0; i < 16; i += 1) m[i] = view.getBigUint64(i * 8, true);

    const v: bigint[] = [...this.h, ...IV];
    v[12] = v[12]! ^ (this.counter & MASK);
    v[13] = v[13]! ^ ((this.counter >> 64n) & MASK);
    if (last) v[14] = v[14]! ^ MASK;

    const mix = (a: number, b: number, c: number, d: number, x: bigint, y: bigint) => {
      v[a] = (v[a]! + v[b]! + x) & MASK;
      v[d] = rotr64(v[d]! ^ v[a]!, 32n);
      v[c] = (v[c]! + v[d]!) & MASK;
      v[b] = rotr64(v[b]! ^ v[c]!, 24n);
      v[a] = (v[a]! + v[b]! + y) & MASK;
      v[d] = rotr64(v[d]! ^ v[a]!, 16n);
      v[c] = (v[c]! + v[d]!) & MASK;
      v[b] = rotr64(v[b]! ^ v[c]!, 63n);
    };

    for (let round = 0; round < 12; round += 1) {
      const s = SIGMA[round % 10]!;
      mix(0, 4, 8, 12, m[s[0]!]!, m[s[1]!]!);
      mix(1, 5, 9, 13, m[s[2]!]!, m[s[3]!]!);
      mix(2, 6, 10, 14, m[s[4]!]!, m[s[5]!]!);
      mix(3, 7, 11, 15, m[s[6]!]!, m[s[7]!]!);
      mix(0, 5, 10, 15, m[s[8]!]!, m[s[9]!]!);
      mix(1, 6, 11, 12, m[s[10]!]!, m[s[11]!]!);
      mix(2, 7, 8, 13, m[s[12]!]!, m[s[13]!]!);
      mix(3, 4, 9, 14, m[s[14]!]!, m[s[15]!]!);
    }

    for (let i = 0; i < 8; i += 1) this.h[i] = this.h[i]! ^ v[i]! ^ v[i + 8]!;
  }
}

export function blake2b(input: Uint8Array, options: Blake2bOptions = {}): Uint8Array {
  return new Blake2b(options).update(input).digest();
}

/** The shape every ZIP-244 node takes: 32 bytes out, personalized, no key. */
export function blake2b256(personal: Uint8Array | string, input: Uint8Array): Uint8Array {
  return blake2b(input, { digestLength: 32, personal });
}

/** Incremental personalized BLAKE2b-256, for hashing a list without concatenating it. */
export function blake2b256Writer(personal: Uint8Array | string): {
  update(bytes: Uint8Array): void;
  digest(): Uint8Array;
} {
  const hash = new Blake2b({ digestLength: 32, personal });
  return {
    update: (bytes: Uint8Array) => void hash.update(bytes),
    digest: () => hash.digest(),
  };
}
