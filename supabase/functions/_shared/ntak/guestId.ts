/**
 * NTAK guest identifier (vendegId, 9.1.1): SHA-256 (lowercase hex) of the
 * concatenated personal data, then BCrypt ($2a$, cost 10) with the
 * accommodation's constant 22-character salt; the last 31 characters are sent.
 *
 * Spec example: "dr. Teszt Edit Budapest 1979.07.12." with salt
 * zDaBMMumxc/1rLNjHHg55O -> 473/rnEtql5aigjoPG33qz1uARVImcW.
 *
 * The BCrypt implementation is injected (npm:bcryptjs in the edge function)
 * so this module stays dependency-free. Once a guest's id has been sent it is
 * stored and reused even if the personal data is corrected later (9.1.3).
 */

export interface GuestIdentity {
  title?: string | null;
  lastName?: string | null;
  firstName?: string | null;
  birthPlace?: string | null;
  birthDate?: string | null; // YYYY-MM-DD
}

export type BcryptHash = (data: string, salt: string) => string | Promise<string>;

const part = (v: string | null | undefined) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Fields that must be present before an id may be generated. */
export function missingIdentityFields(g: GuestIdentity): string[] {
  const missing: string[] = [];
  if (!part(g.lastName)) missing.push('last name');
  if (!part(g.firstName)) missing.push('first name');
  if (!part(g.birthPlace)) missing.push('place of birth');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(part(g.birthDate))) missing.push('date of birth');
  return missing;
}

/** "[title] family given birthplace YYYY.MM.DD." exactly as in the spec example. */
export function guestHashInput(g: GuestIdentity): string {
  const missing = missingIdentityFields(g);
  if (missing.length) throw new Error(`Guest identity incomplete: ${missing.join(', ')}`);
  const date = part(g.birthDate).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1.$2.$3.');
  return [part(g.title), part(g.lastName), part(g.firstName), part(g.birthPlace), date].filter(Boolean).join(' ');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const isValidSalt = (salt: string) => /^[./A-Za-z0-9]{22}$/.test(salt);

/** Random 22-character salt in the BCrypt alphabet (one constant salt per accommodation). */
export function generateSalt(): string {
  const alphabet = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(22));
  // Last character carries only 2 bits in BCrypt; restrict it to keep the salt canonical.
  return Array.from(bytes, (b, i) => (i === 21 ? '.Oeu'[b % 4] : alphabet[b % 64])).join('');
}

export async function computeVendegId(g: GuestIdentity, salt: string, bcryptHash: BcryptHash): Promise<string> {
  if (!isValidSalt(salt)) throw new Error('Invalid NTAK guest-id salt');
  const hex = await sha256Hex(guestHashInput(g));
  const hash = await bcryptHash(hex, `$2a$10$${salt}`);
  if (typeof hash !== 'string' || hash.length < 60) throw new Error('Unexpected BCrypt output');
  return hash.slice(-31);
}
