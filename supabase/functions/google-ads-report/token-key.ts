/**
 * Decode a 256-bit AES key without silently hashing, truncating or padding
 * user-provided passwords. Standard Base64 remains compatible with existing
 * encrypted records. Also allow exact 32-byte hex and Base64URL encodings.
 */
export function decodeTokenKey(value: string): Uint8Array {
  const input = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(input)) {
    return Uint8Array.from(input.match(/.{2}/g)!, pair => parseInt(pair, 16));
  }
  if (!/^[A-Za-z0-9+/]{43}=?$/.test(input) &&
      !/^[A-Za-z0-9_-]{43}=?$/.test(input)) {
    throw new Error("INVALID_GOOGLE_ADS_TOKEN_KEY");
  }
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/").replace(/=$/, "") + "=";
  const raw = atob(normalized);
  if (raw.length !== 32 || btoa(raw) !== normalized) {
    throw new Error("INVALID_GOOGLE_ADS_TOKEN_KEY");
  }
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
