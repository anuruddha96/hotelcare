/**
 * Server-only NAV credential envelope (AES-256-GCM).
 *
 * The 256-bit key lives in Supabase Vault (`hotelcare_nav_credential_key`) and
 * is readable only by the service role through nav_credential_key_internal().
 * Each ciphertext is bound to its connection id as additional authenticated
 * data, so an envelope copied onto another company's connection fails to
 * decrypt. Plaintext credentials are never logged, returned or stored.
 */
export interface NavStoredCredentials {
  login: string;
  password: string;
  signingKey: string;
  exchangeKey?: string | null;
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped service-role client
type Db = any;

const encoder = new TextEncoder();
const toB64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, (c) => String.fromCharCode(c)).join(""));
const fromB64 = (value: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(value);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

async function aesKey(db: Db): Promise<CryptoKey> {
  const { data, error } = await db.rpc("nav_credential_key_internal");
  if (error || typeof data !== "string" || !data) throw new Error("Secure NAV credential storage is unavailable");
  const raw = fromB64(data);
  if (raw.length !== 32) throw new Error("Secure NAV credential key is invalid");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptNavCredentials(
  credentials: NavStoredCredentials, connectionId: string, db: Db,
): Promise<{ credential_ciphertext: string; credential_iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(`nav-connection:${connectionId}`) },
    await aesKey(db),
    encoder.encode(JSON.stringify(credentials)),
  );
  return { credential_ciphertext: toB64(new Uint8Array(cipher)), credential_iv: toB64(iv) };
}

export async function decryptNavCredentials(
  envelope: { credential_ciphertext: string; credential_iv: string }, connectionId: string, db: Db,
): Promise<NavStoredCredentials> {
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(envelope.credential_iv), additionalData: encoder.encode(`nav-connection:${connectionId}`) },
      await aesKey(db),
      fromB64(envelope.credential_ciphertext),
    );
  } catch {
    throw new Error("Stored NAV credentials could not be decrypted; re-enter them");
  }
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as NavStoredCredentials;
  if (!parsed?.login || !parsed?.password || !parsed?.signingKey) throw new Error("Stored NAV credentials are incomplete");
  return parsed;
}

/** Non-secret hint so administrators can recognize which technical user is stored. */
export function loginHint(login: string): string {
  return login.length <= 4 ? "••••" : `••••${login.slice(-3)}`;
}
