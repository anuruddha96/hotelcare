import { decodeTokenKey } from "./token-key.ts";

// Fixed public test vectors only; never use these as production keys.
const fixture = Uint8Array.from({ length: 32 }, (_, i) => i + 224);
const hex = Array.from(fixture, n => n.toString(16).padStart(2, "0")).join("");
const base64 = btoa(String.fromCharCode(...fixture));
const url = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function assertKey(value: string) {
  const decoded = decodeTokenKey(value);
  if (decoded.length !== 32 || decoded.some((n, i) => n !== fixture[i])) throw new Error("WRONG_KEY_BYTES");
}
Deno.test("accepts canonical Base64 with surrounding whitespace", () => assertKey("  " + base64 + "\n"));
Deno.test("accepts exact hex and URL-safe or unpadded encodings", () => {
  for (const value of [hex, hex.toUpperCase(), url, base64.slice(0, -1)]) assertKey(value);
});
Deno.test("rejects malformed, truncated and arbitrary password values", () => {
  for (const value of ["", "openssl rand -base64 32", "x".repeat(32), base64.slice(0, -4), "!" + base64.slice(1), hex + "00", base64.slice(0, -2) + "/="]) {
    let rejected = false;
    try { decodeTokenKey(value); } catch { rejected = true; }
    if (!rejected) throw new Error("INVALID_KEY_ACCEPTED");
  }
});
