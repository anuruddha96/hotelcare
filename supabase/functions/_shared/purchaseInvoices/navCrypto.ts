/**
 * NAV Online Számla v3.0 authentication primitives.
 *
 * Specification (Interface Specification v3.0, sections 1.3.2 and 1.5.2):
 *  - passwordHash = UPPERCASE SHA-512 of the technical user's password,
 *    cryptoType="SHA-512".
 *  - requestSignature for every operation other than manageInvoice /
 *    manageAnnulment = UPPERCASE SHA3-512 of
 *      requestId + UTC timestamp masked as YYYYMMDDhhmmss + XML signing key,
 *    cryptoType="SHA3-512".
 *  - requestId: [+a-zA-Z0-9_]{1,30}, unique per taxpayer within ±1 day.
 *  - timestamp: UTC, \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z, ±1 day.
 *
 * HotelCare only performs read operations, so the XML exchange key
 * (AES-128 token decryption for manageInvoice) is never needed here.
 */
import { sha3_512Hex } from "./sha3.ts";

export const NAV_PASSWORD_CRYPTO = "SHA-512";
export const NAV_SIGNATURE_CRYPTO = "SHA3-512";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export async function sha512HexUpper(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest)).toUpperCase();
}

export function navPasswordHash(password: string): Promise<string> {
  if (!password) throw new Error("NAV technical user password is required");
  return sha512HexUpper(password);
}

const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;

/** "2017-12-30T18:25:45.000Z" → "20171230182545" */
export function signatureTimestampMask(isoTimestamp: string): string {
  const m = isoTimestamp.match(TIMESTAMP_RE);
  if (!m) throw new Error("NAV timestamp must be a UTC ISO-8601 value ending in Z");
  return `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}`;
}

export function navRequestSignature(requestId: string, isoTimestamp: string, signingKey: string): string {
  if (!/^[+a-zA-Z0-9_]{1,30}$/.test(requestId)) throw new Error("Invalid NAV requestId");
  if (!signingKey) throw new Error("NAV XML signing key is required");
  return sha3_512Hex(requestId + signatureTimestampMask(isoTimestamp) + signingKey).toUpperCase();
}

/** UTC timestamp with millisecond precision, as NAV expects. */
export function navTimestamp(now: Date = new Date()): string {
  return now.toISOString();
}

/** Unique request id matching [+a-zA-Z0-9_]{1,30}. */
export function newNavRequestId(prefix = "HC", now: Date = new Date()): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "HC";
  const time = now.getTime().toString(36).toUpperCase();
  const random = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36))
    .join("")
    .toUpperCase();
  return `${safePrefix}${time}${random}`.slice(0, 30);
}

export interface NavCredentialInput {
  login: string;
  password: string;
  signingKey: string;
  exchangeKey?: string | null;
}

export interface CredentialValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate the shape of NAV technical-user credentials before they are stored.
 * Values are never echoed back in messages.
 */
export function validateNavCredentials(input: NavCredentialInput): CredentialValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!/^[a-zA-Z0-9]{6,15}$/.test(input.login ?? "")) {
    errors.push("The technical user login must be 6–15 letters or digits.");
  }
  if (!input.password || input.password.length > 256) {
    errors.push("The technical user password is required.");
  }
  if (!input.signingKey || /\s/.test(input.signingKey) || input.signingKey.length < 16 || input.signingKey.length > 128) {
    errors.push("The XML signing key (aláírókulcs) looks invalid.");
  }
  if (input.exchangeKey) {
    if (/\s/.test(input.exchangeKey)) errors.push("The XML exchange key (cserekulcs) must not contain spaces.");
    else if (input.exchangeKey.length !== 16) warnings.push("The XML exchange key is usually 16 characters long.");
  } else {
    warnings.push("No XML exchange key stored. It is not needed for read-only incoming-invoice sync.");
  }
  return { ok: errors.length === 0, errors, warnings };
}
