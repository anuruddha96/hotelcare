/** Server-only Számlázz.hu legal issuer configuration and AES-GCM credential envelope. */
export interface InvoiceIssuer {
  id: string; organization_slug: string; legal_name: string; tax_number: string;
  zip: string; city: string; street_address: string; billing_email: string;
  bank_name: string; bank_account: string; reply_to_email: string;
  invoice_prefix: string; language: string; environment: "test" | "live";
  connection_mode: "own_account" | "delegated";
  credential_ciphertext: string | null; credential_iv: string | null; enabled: boolean;
}
export type ProviderAuth = { agentKey: string } | { username: string; password: string };

// deno-lint-ignore no-explicit-any
type Db = any;
function encryptionKey(): Uint8Array {
  const raw = Deno.env.get("SZAMLAZZ_CONFIG_ENCRYPTION_KEY") || "";
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0)); }
  catch { throw new Error("Invoicing credential encryption key is invalid"); }
  if (bytes.length !== 32) throw new Error("Set SZAMLAZZ_CONFIG_ENCRYPTION_KEY to a base64-encoded 32-byte secret");
  return bytes;
}
const toB64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, c => String.fromCharCode(c)).join(""));
async function aesKey() {
  return crypto.subtle.importKey("raw", encryptionKey(), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function encryptProviderAuth(auth: ProviderAuth): Promise<{ credential_ciphertext: string; credential_iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(auth));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), plaintext));
  return { credential_ciphertext: toB64(cipher), credential_iv: toB64(iv) };
}
export async function decryptProviderAuth(issuer: InvoiceIssuer): Promise<ProviderAuth> {
  if (!issuer.credential_ciphertext || !issuer.credential_iv) throw new Error("No provider credentials for selected invoice company");
  const bytes = Uint8Array.from(atob(issuer.credential_ciphertext), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(issuer.credential_iv), c => c.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(), bytes);
  const data = JSON.parse(new TextDecoder().decode(plaintext)) as ProviderAuth;
  if ("agentKey" in data && typeof data.agentKey === "string" && data.agentKey) return data;
  if ("username" in data && data.username && data.password) return data;
  throw new Error("Selected invoice company has invalid provider credentials");
}
export function publicIssuer(issuer: InvoiceIssuer) {
  const { credential_ciphertext: _secret, credential_iv: _iv, ...safe } = issuer;
  void _secret; void _iv;
  return { ...safe, credentials_set: Boolean(issuer.credential_ciphertext && issuer.credential_iv) };
}
export async function issuerForHotel(db: Db, organizationSlug: string, hotelId: string): Promise<InvoiceIssuer | null> {
  const { data: link, error: linkError } = await db.from("invoice_hotel_issuers")
    .select("issuer_id").eq("organization_slug", organizationSlug).eq("hotel_id", hotelId).maybeSingle();
  if (linkError) throw new Error(linkError.message);
  if (!link) return null;
  return issuerById(db, organizationSlug, String(link.issuer_id));
}
export async function issuerById(db: Db, organizationSlug: string, id: string): Promise<InvoiceIssuer | null> {
  const { data, error } = await db.from("invoice_issuers")
    .select("*").eq("organization_slug", organizationSlug).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as InvoiceIssuer | null;
}
export function issuerCanIssue(issuer: InvoiceIssuer | null): boolean {
  return Boolean(issuer?.enabled && issuer?.credential_ciphertext && issuer?.credential_iv);
}