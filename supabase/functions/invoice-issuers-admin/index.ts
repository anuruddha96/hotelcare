/** Admin-only, organization-scoped issuer profiles for guest invoicing. No provider calls here. */
import {
  authorizeHotelCaller, corsHeaders, hasRole, json, OWNER_ROLES, serviceDb,
} from "../_shared/channex/http.ts";
import {
  encryptProviderAuth, issuerById, publicIssuer, type InvoiceIssuer, type ProviderAuth,
} from "../_shared/szamlazz/issuer.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
class InputError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
function field(data: Record<string, unknown>, name: string, max = 200) {
  return String(data[name] ?? "").trim().slice(0, max);
}
function validate(data: Record<string, unknown>) {
  const legal_name = field(data, "legal_name");
  const tax_number = field(data, "tax_number", 25);
  const zip = field(data, "zip", 15);
  const city = field(data, "city", 100);
  const street_address = field(data, "street_address");
  const billing_email = field(data, "billing_email");
  const bank_name = field(data, "bank_name");
  const bank_account = field(data, "bank_account", 80);
  const reply_to_email = field(data, "reply_to_email");
  const invoice_prefix = field(data, "invoice_prefix", 10).toUpperCase();
  const language = field(data, "language", 2) || "hu";
  const environment = field(data, "environment", 6) || "test";
  const connection_mode = field(data, "connection_mode", 20) || "own_account";
  if (!legal_name || !zip || !city || !street_address) throw new InputError("Company name and registered address are required");
  if (!/^\d{8}-\d-\d{2}$/.test(tax_number)) throw new InputError("Enter the exact Hungarian tax number (12345678-1-42)");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing_email)) throw new InputError("A valid company email is required");
  if (reply_to_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reply_to_email)) throw new InputError("Invalid reply-to email");
  if (invoice_prefix && !/^[A-Z0-9]{1,5}$/.test(invoice_prefix)) throw new InputError("Invoice prefix must have 1–5 uppercase letters/numbers");
  if (!["hu","en","de","it","ro","sk","hr","fr","es","cz","pl"].includes(language)) throw new InputError("Unsupported invoice language");
  if (!["test","live"].includes(environment)) throw new InputError("Invalid environment");
  if (!["own_account","delegated"].includes(connection_mode)) throw new InputError("Invalid connection method");
  if (connection_mode === "delegated" && !invoice_prefix) throw new InputError("A delegated issuer needs its agreed invoice prefix");
  return { legal_name, tax_number, zip, city, street_address, billing_email, bank_name, bank_account,
    reply_to_email, invoice_prefix, language, environment, connection_mode };
}
async function audit(db: Db, organization_slug: string, actor_id: string, operation: string, issuer_id?: string, hotel_id?: string) {
  const { error } = await db.from("invoice_issuer_audit")
    .insert({ organization_slug, actor_id, operation, issuer_id: issuer_id || null, hotel_id: hotel_id || null });
  if (error) throw new Error("Could not write invoice configuration audit");
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
    const p = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(p.action ?? "");
    const hotelId = String(p.hotel_id ?? "");
    if (!action || !hotelId) throw new InputError("Select a hotel before configuring invoicing");
    const db = serviceDb();
    const auth = await authorizeHotelCaller(req, db, hotelId);
    if (auth instanceof Response) return auth;
    if (!hasRole(auth, OWNER_ROLES)) return json({ ok: false, error: "Organization administrator required" }, 403);

    // Bind scope to the actually authorized hotel. No client-supplied organization_slug
    // can redirect writes into another tenant.
    const { data: hotel, error: hErr } = await db.from("hotel_configurations")
      .select("organization_id").eq("hotel_id", hotelId).eq("is_active", true).maybeSingle();
    if (hErr || !hotel) throw new InputError("Hotel configuration not found", 404);
    const { data: org, error: oErr } = await db.from("organizations")
      .select("slug").eq("id", hotel.organization_id).maybeSingle();
    if (oErr || !org) throw new InputError("Organization configuration not found", 404);
    const slug = String(org.slug);
    if (!auth.isSuperAdmin && auth.organizationSlug !== slug) return json({ ok: false, error: "Forbidden" }, 403);

    if (action === "list") {
      const { data: issuers, error } = await db.from("invoice_issuers")
        .select("*").eq("organization_slug", slug).order("legal_name");
      if (error) throw new Error(error.message);
      const { data: link, error: lErr } = await db.from("invoice_hotel_issuers")
        .select("issuer_id").eq("organization_slug", slug).eq("hotel_id", hotelId).maybeSingle();
      if (lErr) throw new Error(lErr.message);
      return json({ ok: true, companies: ((issuers || []) as InvoiceIssuer[]).map(publicIssuer),
        assigned_issuer_id: link?.issuer_id || null, hotel_id: hotelId, organization_slug: slug });
    }

    if (action === "save") {
      const input = (p.company ?? {}) as Record<string, unknown>;
      const clean = validate(input);
      const id = String(input.id || "");
      let existing: InvoiceIssuer | null = null;
      if (id) {
        existing = await issuerById(db, slug, id);
        if (!existing) throw new InputError("Issuer not found in this organization", 404);
      }
      const newSecret = field(input, "credential", 512);
      const username = field(input, "username", 200);
      const password = field(input, "password", 256);
      let secret: { credential_ciphertext: string; credential_iv: string } | object = {};
      if (clean.connection_mode === "own_account") {
        if (newSecret) secret = await encryptProviderAuth({ agentKey: newSecret });
      } else if (username || password) {
        if (!username || !password) throw new InputError("Both delegated user email and password are required");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) throw new InputError("Invalid delegated user email");
        secret = await encryptProviderAuth({ username, password } as ProviderAuth);
      }
      const modeChanged = !!existing && existing.connection_mode !== clean.connection_mode;
      if (modeChanged && !Object.keys(secret).length) throw new InputError("Enter credentials when changing connection type");
      // Edits never silently enable issuance; a separate deliberate action is required.
      const payload = { ...clean, ...secret, organization_slug: slug, enabled: false, updated_by: auth.userId };
      const operation = existing ? db.from("invoice_issuers").update(payload).eq("id", id).eq("organization_slug", slug)
        : db.from("invoice_issuers").insert({ ...payload, created_by: auth.userId });
      const { data, error } = await operation.select("*").single();
      if (error) throw new InputError("Unable to save issuer profile: " + error.message, 409);
      await audit(db, slug, auth.userId, Object.keys(secret).length && existing ? "rotate_key" : "save", data.id);
      return json({ ok: true, company: publicIssuer(data as InvoiceIssuer) });
    }

    if (action === "enable" || action === "disable") {
      const id = String(p.issuer_id || "");
      const company = await issuerById(db, slug, id);
      if (!company) throw new InputError("Issuer not found", 404);
      if (action === "enable") {
        if (!company.credential_ciphertext || !company.credential_iv) throw new InputError("Save provider credentials before enabling");
        if (p.confirm !== true) throw new InputError("Confirm issuer, environment and authorization before enabling");
        if (company.environment === "live" && p.nav_confirmed !== true) throw new InputError("Confirm NAV is connected for the LIVE company before enabling");
        if (company.connection_mode === "delegated" && p.delegation_approved !== true) throw new InputError("Confirm written delegation, approved supplier connection and dedicated user access");
      }
      const { error } = await db.from("invoice_issuers").update({
        enabled: action === "enable", updated_by: auth.userId,
      }).eq("id", id).eq("organization_slug", slug);
      if (error) throw new Error(error.message);
      await audit(db, slug, auth.userId, action, id);
      return json({ ok: true, enabled: action === "enable" });
    }

    if (action === "assign") {
      const id = String(p.issuer_id || "");
      const company = await issuerById(db, slug, id);
      if (!company) throw new InputError("Invoice company does not belong to this organization", 404);
      const { error } = await db.from("invoice_hotel_issuers").upsert({
        organization_slug: slug, hotel_id: hotelId, issuer_id: id,
        assigned_by: auth.userId, assigned_at: new Date().toISOString(),
      }, { onConflict: "organization_slug,hotel_id" });
      if (error) throw new Error(error.message);
      await audit(db, slug, auth.userId, "assign", id, hotelId);
      return json({ ok: true, assigned_issuer_id: id });
    }
    if (action === "unassign") {
      const { error } = await db.from("invoice_hotel_issuers")
        .delete().eq("organization_slug", slug).eq("hotel_id", hotelId);
      if (error) throw new Error(error.message);
      await audit(db, slug, auth.userId, "unassign", undefined, hotelId);
      return json({ ok: true, assigned_issuer_id: null });
    }
    throw new InputError("Unknown action");
  } catch (cause) {
    if (cause instanceof InputError) return json({ ok: false, error: cause.message }, cause.status);
    console.error("invoice-issuers-admin failure", cause instanceof Error ? cause.message : "unknown");
    return json({ ok: false, error: "Invoice configuration unavailable; no changes made to issued documents" }, 500);
  }
});