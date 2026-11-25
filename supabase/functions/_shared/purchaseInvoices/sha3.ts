/**
 * Portable SHA3-512 (FIPS 202) used for the NAV Online Számla v3.0
 * `requestSignature` (cryptoType="SHA3-512").
 *
 * WebCrypto does not offer SHA-3, and this module must run unchanged in both
 * Supabase Edge (Deno) and the Vitest/Node test runner, so the Keccak-f[1600]
 * permutation is implemented here with 64-bit BigInt lanes. Inputs are tiny
 * (requestId + timestamp + signing key), so performance is not a concern.
 *
 * Verified against the official NAV specification example (section 1.5.1)
 * and the FIPS 202 vectors in src/test/purchaseInvoices/navCrypto.test.ts.
 */

const MASK64 = (1n << 64n) - 1n;

const ROUND_CONSTANTS: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// Rotation offsets r[x][y], stored at index x + 5y.
const ROTATIONS: number[] = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

function rotl64(value: bigint, shift: number): bigint {
  if (shift === 0) return value;
  const s = BigInt(shift);
  return ((value << s) | (value >> (64n - s))) & MASK64;
}

function keccakF1600(state: bigint[]): void {
  const c = new Array<bigint>(5);
  const d = new Array<bigint>(5);
  const b = new Array<bigint>(25);
  for (let round = 0; round < 24; round++) {
    // θ
    for (let x = 0; x < 5; x++) {
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      d[x] = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
    }
    for (let i = 0; i < 25; i++) state[i] ^= d[i % 5];
    // ρ and π
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const idx = x + 5 * y;
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(state[idx], ROTATIONS[idx]);
      }
    }
    // χ
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const idx = x + 5 * y;
        state[idx] = b[idx] ^ ((~b[((x + 1) % 5) + 5 * y] & MASK64) & b[((x + 2) % 5) + 5 * y]);
      }
    }
    // ι
    state[0] ^= ROUND_CONSTANTS[round];
  }
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** SHA3-512 digest of raw bytes. */
export function sha3_512(input: Uint8Array): Uint8Array {
  const rate = 72; // (1600 - 2 * 512) / 8
  const state = new Array<bigint>(25).fill(0n);

  // pad10*1 with SHA-3 domain separation bits (0x06 ... 0x80)
  const paddedLength = Math.floor(input.length / rate) * rate + rate;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] ^= 0x06;
  padded[paddedLength - 1] ^= 0x80;

  for (let offset = 0; offset < paddedLength; offset += rate) {
    for (let lane = 0; lane < rate / 8; lane++) {
      let value = 0n;
      for (let byte = 7; byte >= 0; byte--) {
        value = (value << 8n) | BigInt(padded[offset + lane * 8 + byte]);
      }
      state[lane] ^= value;
    }
    keccakF1600(state);
  }

  const out = new Uint8Array(64);
  for (let lane = 0; lane < 8; lane++) {
    let value = state[lane];
    for (let byte = 0; byte < 8; byte++) {
      out[lane * 8 + byte] = Number(value & 0xffn);
      value >>= 8n;
    }
  }
  return out;
}

/** Lower-case hex SHA3-512 of a UTF-8 string. */
export function sha3_512Hex(text: string): string {
  return toHex(sha3_512(new TextEncoder().encode(text)));
}
