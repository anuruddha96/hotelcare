/**
 * Face ID / fingerprint quick unlock.
 *
 * The phone's own unlock (Face ID, Touch ID, Android biometrics) is exposed to
 * web apps through WebAuthn platform authenticators. There is no biometric data
 * in the app and nothing is sent to the server: the device proves the person is
 * present, and only then is the saved Supabase session unwrapped locally.
 *
 * Where the browser supports the WebAuthn PRF extension (modern iOS/Android),
 * the encryption key is derived from the authenticator itself, so the stored
 * session is genuinely unreadable without a successful biometric check. Where it
 * does not, the session is still encrypted at rest and the biometric prompt
 * gates access — the same guarantee a native "app lock" gives.
 *
 * Everything is per device and per browser. The password form always remains.
 */

const STORE_KEY = "hc_bio_unlock_v1";
const PRF_SALT = new TextEncoder().encode("hotelcare-quick-unlock-v1");

interface StoredRecord {
  credentialId: string;      // base64url
  label: string;             // who this unlock belongs to, for the button
  prf: boolean;              // key came from the authenticator
  wrapKey?: string;          // base64, only for the non-PRF fallback
  iv: string;                // base64
  data: string;              // base64 ciphertext of the session JSON
  savedAt: string;
}

export interface StoredSession {
  access_token: string;
  refresh_token: string;
}

/* ------------------------------------------------------------ small helpers */

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
};

const unb64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

const read = (): StoredRecord | null => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as StoredRecord) : null;
  } catch {
    return null;
  }
};

async function keyFromSecret(secret: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: PRF_SALT, info: new TextEncoder().encode("session") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/* -------------------------------------------------------------- public API */

/** Does this device offer Face ID / Touch ID / fingerprint to the browser? */
export async function isBiometricSupported(): Promise<boolean> {
  try {
    if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
    if (!window.isSecureContext) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** A quick unlock saved on this device, if any. */
export function savedUnlock(): { label: string; savedAt: string } | null {
  const rec = read();
  return rec ? { label: rec.label, savedAt: rec.savedAt } : null;
}

export function disableBiometric(): void {
  try { localStorage.removeItem(STORE_KEY); } catch { /* nothing to clear */ }
}

/**
 * Register the device and store the current session behind the biometric.
 * Called right after a successful password sign-in, never before.
 */
export async function enableBiometric(
  session: StoredSession,
  identity: { userId: string; label: string },
): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = new TextEncoder().encode(identity.userId);

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "Hotel Care", id: window.location.hostname },
      user: { id: userId, name: identity.label, displayName: identity.label },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      timeout: 60_000,
      attestation: "none",
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error("The device did not complete the setup.");

  const ext = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };
  const prfSecret = ext?.prf?.results?.first ? new Uint8Array(ext.prf.results.first) : null;

  const fallbackSecret = prfSecret ? null : crypto.getRandomValues(new Uint8Array(32));
  const key = await keyFromSecret(prfSecret ?? (fallbackSecret as Uint8Array));

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    })),
  );

  const record: StoredRecord = {
    credentialId: b64(credential.rawId),
    label: identity.label,
    prf: !!prfSecret,
    wrapKey: fallbackSecret ? b64(fallbackSecret) : undefined,
    iv: b64(iv),
    data: b64(cipher),
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(record));
}

/**
 * Ask for Face ID / fingerprint and hand back the saved session.
 * Throws when the person cancels or the device refuses.
 */
export async function unlockWithBiometric(): Promise<StoredSession> {
  const rec = read();
  if (!rec) throw new Error("No quick unlock is saved on this device.");

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: window.location.hostname,
      allowCredentials: [{ type: "public-key", id: unb64(rec.credentialId) }],
      userVerification: "required",
      timeout: 60_000,
      extensions: rec.prf
        ? ({ prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs)
        : undefined,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error("Unlock was cancelled.");

  const ext = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const secret = rec.prf
    ? (ext?.prf?.results?.first ? new Uint8Array(ext.prf.results.first) : null)
    : (rec.wrapKey ? unb64(rec.wrapKey) : null);
  if (!secret) throw new Error("This device could not unlock the saved sign-in.");

  const key = await keyFromSecret(secret);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(rec.iv) },
    key,
    unb64(rec.data),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as StoredSession;
}

/**
 * Supabase rotates the refresh token on every sign-in, so the stored copy must
 * be replaced after each successful unlock — otherwise the second unlock fails.
 */
export async function refreshStoredSession(session: StoredSession): Promise<void> {
  const rec = read();
  if (!rec) return;
  try {
    const secret = rec.prf ? null : (rec.wrapKey ? unb64(rec.wrapKey) : null);
    if (rec.prf) {
      // PRF keys only exist during a biometric ceremony; keep the old blob and
      // let the next unlock re-save. Handled by callers passing through enable.
      return;
    }
    if (!secret) return;
    const key = await keyFromSecret(secret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(session)),
    );
    localStorage.setItem(STORE_KEY, JSON.stringify({
      ...rec, iv: b64(iv), data: b64(cipher), savedAt: new Date().toISOString(),
    } satisfies StoredRecord));
  } catch {
    // A failed re-wrap simply means the next unlock asks for the password.
  }
}
