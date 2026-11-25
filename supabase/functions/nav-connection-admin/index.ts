/**
 * NAV Online Számla connection administration (per legal company).
 *
 * Read-only incoming-invoice access only: no invoice is ever issued or
 * reported to NAV from here. Credentials are encrypted server-side and are
 * never returned to the browser; organization admins configure, test and
 * enable connections, controlling may view their status.
 */
import { authorizeCaller, corsHeaders, InputError, json, serviceDb, type Db, type UserCaller } from "../_shared/purchaseInvoices/piAuth.ts";
import { decryptNavCredentials, encryptNavCredentials, loginHint } from "../_shared/purchaseInvoices/navCredentials.ts";
import { validateNavCredentials } from "../_shared/purchaseInvoices/navCrypto.ts";
import { NavConfigError, softwareFromEnv, type NavEnvironment } from "../_shared/purchaseInvoices/navRequest.ts";
import { NavClient } from "../_shared/purchaseInvoices/navClient.ts";
import { NavApiError } from "../_shared/purchaseInvoices/navResponse.ts";
import { companyNameSimilarity, isValidHuTaxCore, taxCore8 } from "../_shared/purchaseInvoices/normalize.ts";
import { isoDate } from "../_shared/purchaseInvoices/navSyncPlan.ts";

const SAFE_CONNECTION_COLUMNS = [
  "id", "organization_slug", "company_id", "environment", "tax_number", "status", "enabled", "use_for_reconciliation",
  "credentials_set", "credentials_updated_at", "login_hint", "last_test_at", "last_test_ok", "last_test_result", "sync_from_date",
  "initial_sync_through", "initial_sync_completed_at", "ins_date_cursor", "last_backfill_at", "last_attempt_at", "last_success_at",
  "last_sync_state", "consecutive_failures", "next_retry_at", "last_error_code", "last_error_category", "last_error_message",
  "created_at", "updated_at",
].join(",");

function softwareStatus() {
  try {
    const software = softwareFromEnv((k) => Deno.env.get(k));
    return { configured: true, software_id: software.softwareId, error: null as string | null };
  } catch (cause) {
    return { configured: false, software_id: null, error: cause instanceof Error ? cause.message : "NAV software identity missing" };
  }
}

async function audit(db: Db, caller: UserCaller, event: string, detail: Record<string, unknown>) {
  await db.from("pi_nav_sync_events").insert({
    organization_slug: caller.organizationSlug, level: "info", event, detail: { ...detail, actor_id: caller.userId },
  });
}

async function loadConnection(db: Db, caller: UserCaller, id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new InputError("Select a NAV connection");
  const { data, error } = await db.from("pi_nav_connections").select("*").eq("id", id).eq("organization_slug", caller.organizationSlug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new InputError("NAV connection not found", 404);
  return data;
}

function requireAdmin(caller: UserCaller) {
  if (!caller.isFinanceAdmin) throw new InputError("Only an organization administrator can change NAV connections", 403);
}

async function testConnection(db: Db, caller: UserCaller, connection: Record<string, unknown>) {
  const { data: secret } = await db.from("pi_nav_connection_secrets")
    .select("credential_ciphertext, credential_iv").eq("connection_id", connection.id).maybeSingle();
  if (!secret) throw new InputError("Enter the NAV technical user credentials first");
  const { data: company } = await db.from("invoice_buyer_companies").select("name, legal_name").eq("id", connection.company_id).maybeSingle();
  const result: Record<string, unknown> = { tested_at: new Date().toISOString(), environment: connection.environment };
  let ok = false;
  try {
    const credentials = await decryptNavCredentials(secret, String(connection.id), db);
    const software = softwareFromEnv((k) => Deno.env.get(k));
    const client = new NavClient({
      environment: connection.environment as NavEnvironment,
      auth: { login: credentials.login, password: credentials.password, signingKey: credentials.signingKey, taxNumber: String(connection.tax_number) },
      software,
      maxAttempts: 2,
    });
    // 1) Authentication + taxpayer identity (lightweight, read-only).
    const taxpayer = await client.queryTaxpayer(String(connection.tax_number));
    const expected = String(company?.legal_name || company?.name || "");
    const similarity = taxpayer?.name && expected ? companyNameSimilarity(taxpayer.name, expected) : null;
    result.authentication = "ok";
    result.taxpayer_name = taxpayer?.name ?? null;
    result.taxpayer_valid = taxpayer?.valid ?? null;
    result.name_matches_company = similarity == null ? null : similarity >= 0.5;
    // 2) Permission to query incoming invoices (one digest page, yesterday→today).
    const today = isoDate(new Date());
    const yesterday = isoDate(new Date(Date.now() - 86_400_000));
    const page = await client.queryInvoiceDigest({ page: 1, issueDate: { from: yesterday, to: today } });
    result.incoming_query = "ok";
    result.sample_available_pages = page.availablePage;
    ok = true;
  } catch (cause) {
    if (cause instanceof NavApiError) {
      const summary = cause.safeSummary();
      result.error_code = summary.code;
      result.error_category = summary.category;
      result.error_message = summary.message;
    } else if (cause instanceof NavConfigError) {
      result.error_category = "config";
      result.error_message = cause.message;
    } else {
      result.error_category = "unknown";
      result.error_message = cause instanceof Error ? cause.message.slice(0, 300) : "NAV test failed";
    }
    if (result.authentication !== "ok") result.authentication = "failed";
    else result.incoming_query = "failed";
  }
  result.ok = ok;
  const nextStatus = ok ? (connection.enabled ? "active" : "ready") : (connection.enabled ? "error" : "draft");
  await db.from("pi_nav_connections").update({
    last_test_at: new Date().toISOString(), last_test_ok: ok, last_test_result: result, status: nextStatus, updated_by: caller.userId,
  }).eq("id", connection.id);
  await audit(db, caller, "connection_tested", { connection_id: connection.id, ok, error_code: result.error_code ?? null });
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
    const db = serviceDb();
    const caller = await authorizeCaller(req, db);
    if (caller instanceof Response) return caller;
    if (caller.kind !== "user") return json({ ok: false, error: "Forbidden" }, 403);
    if (!caller.canControlNav) return json({ ok: false, error: "NAV connections are visible to controlling and organization administrators only" }, 403);
    const p = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(p.action ?? "");

    if (action === "list") {
      const [{ data: connections, error }, { data: companies }] = await Promise.all([
        db.from("pi_nav_connections").select(SAFE_CONNECTION_COLUMNS).eq("organization_slug", caller.organizationSlug).order("created_at"),
        db.from("invoice_buyer_companies").select("id, name, legal_name, tax_id, is_active, registered_address")
          .eq("organization_slug", caller.organizationSlug).order("name"),
      ]);
      if (error) throw new Error(error.message);
      return json({
        ok: true,
        connections: connections ?? [],
        companies: (companies ?? []).map((c: Record<string, unknown>) => ({
          ...c, tax_core: taxCore8(c.tax_id as string), tax_valid: isValidHuTaxCore(taxCore8(c.tax_id as string)),
        })),
        software: softwareStatus(),
        can_manage: caller.isFinanceAdmin,
      });
    }

    requireAdmin(caller);

    if (action === "save_connection") {
      const environment = String(p.environment ?? "test");
      if (environment !== "test" && environment !== "production") throw new InputError("Choose the NAV test or production environment");
      const companyId = String(p.company_id ?? "");
      const { data: company } = await db.from("invoice_buyer_companies").select("id, tax_id, is_active")
        .eq("id", companyId).eq("organization_slug", caller.organizationSlug).maybeSingle();
      if (!company) throw new InputError("Legal company not found", 404);
      const taxNumber = taxCore8(company.tax_id);
      if (!taxNumber || !isValidHuTaxCore(taxNumber)) throw new InputError("The legal company needs a valid Hungarian tax number before connecting to NAV");
      const syncFrom = p.sync_from_date ? String(p.sync_from_date) : null;
      if (syncFrom && (!/^\d{4}-\d{2}-\d{2}$/.test(syncFrom) || syncFrom > isoDate(new Date()) || syncFrom < "2018-07-01")) {
        throw new InputError("The NAV history start date must be between 2018-07-01 and today");
      }
      const { data: existing } = await db.from("pi_nav_connections").select("*")
        .eq("organization_slug", caller.organizationSlug).eq("company_id", companyId).eq("environment", environment).maybeSingle();
      const patch: Record<string, unknown> = {
        organization_slug: caller.organizationSlug, company_id: companyId, environment, tax_number: taxNumber,
        use_for_reconciliation: p.use_for_reconciliation === true, updated_by: caller.userId,
      };
      if (p.sync_from_date !== undefined) patch.sync_from_date = syncFrom;
      if (existing && syncFrom !== existing.sync_from_date && p.sync_from_date !== undefined) {
        // History is re-read from the new start date; upserts keep this idempotent.
        Object.assign(patch, { initial_sync_through: null, initial_sync_completed_at: null });
      }
      if (existing && existing.tax_number !== taxNumber) {
        Object.assign(patch, { enabled: false, status: "draft", last_test_ok: null });
      }
      const query = existing
        ? db.from("pi_nav_connections").update(patch).eq("id", existing.id).select(SAFE_CONNECTION_COLUMNS).single()
        : db.from("pi_nav_connections").insert({ ...patch, created_by: caller.userId }).select(SAFE_CONNECTION_COLUMNS).single();
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      await audit(db, caller, existing ? "connection_updated" : "connection_created", { connection_id: data.id, environment, company_id: companyId });
      return json({ ok: true, connection: data });
    }

    if (action === "set_credentials") {
      const connection = await loadConnection(db, caller, p.connection_id);
      const credentials = {
        login: String(p.login ?? "").trim(),
        password: String(p.password ?? ""),
        signingKey: String(p.signing_key ?? "").trim(),
        exchangeKey: p.exchange_key ? String(p.exchange_key).trim() : null,
      };
      const validation = validateNavCredentials(credentials);
      if (!validation.ok) return json({ ok: false, error: validation.errors.join(" "), warnings: validation.warnings }, 400);
      const envelope = await encryptNavCredentials(credentials, connection.id, db);
      const { error } = await db.from("pi_nav_connection_secrets").upsert({
        connection_id: connection.id, ...envelope, key_version: 1, updated_by: caller.userId, updated_at: new Date().toISOString(),
      }, { onConflict: "connection_id" });
      if (error) throw new Error("Could not store the NAV credentials securely");
      // New credentials must pass a fresh test before the connection syncs again.
      await db.from("pi_nav_connections").update({
        credentials_set: true, credentials_updated_at: new Date().toISOString(), login_hint: loginHint(credentials.login),
        enabled: false, status: "draft", last_test_ok: null, updated_by: caller.userId,
      }).eq("id", connection.id);
      await audit(db, caller, "credentials_updated", { connection_id: connection.id });
      return json({ ok: true, warnings: validation.warnings });
    }

    if (action === "delete_credentials") {
      const connection = await loadConnection(db, caller, p.connection_id);
      await db.from("pi_nav_connection_secrets").delete().eq("connection_id", connection.id);
      await db.from("pi_nav_connections").update({
        credentials_set: false, login_hint: null, enabled: false, status: "draft", last_test_ok: null, updated_by: caller.userId,
      }).eq("id", connection.id);
      await audit(db, caller, "credentials_deleted", { connection_id: connection.id });
      return json({ ok: true });
    }

    if (action === "test") {
      const connection = await loadConnection(db, caller, p.connection_id);
      const result = await testConnection(db, caller, connection);
      return json({ ok: true, result });
    }

    if (action === "enable") {
      const connection = await loadConnection(db, caller, p.connection_id);
      const software = softwareStatus();
      if (!software.configured) throw new InputError(software.error ?? "NAV software identity is not configured");
      if (!connection.credentials_set) throw new InputError("Enter the NAV technical user credentials first");
      if (!connection.last_test_ok || !connection.last_test_at ||
        (connection.credentials_updated_at && connection.last_test_at < connection.credentials_updated_at)) {
        throw new InputError("Run a successful connection test with the current credentials before enabling");
      }
      if (!connection.sync_from_date) throw new InputError("Set the NAV history start date before enabling");
      if (connection.environment === "production" && p.confirm_production !== true) {
        throw new InputError("Confirm that this legal company authorized HotelCare to read its production NAV data");
      }
      await db.from("pi_nav_connections").update({
        enabled: true, status: "active", consecutive_failures: 0, next_retry_at: null, updated_by: caller.userId,
      }).eq("id", connection.id);
      await audit(db, caller, "connection_enabled", { connection_id: connection.id, environment: connection.environment });
      return json({ ok: true });
    }

    if (action === "disable") {
      const connection = await loadConnection(db, caller, p.connection_id);
      await db.from("pi_nav_connections").update({ enabled: false, status: "disabled", updated_by: caller.userId }).eq("id", connection.id);
      await audit(db, caller, "connection_disabled", { connection_id: connection.id });
      return json({ ok: true });
    }

    throw new InputError("Unknown action");
  } catch (cause) {
    if (cause instanceof InputError) return json({ ok: false, error: cause.message }, cause.status);
    console.error("nav-connection-admin failed", cause instanceof Error ? cause.message : "unknown error");
    return json({ ok: false, error: "NAV connection administration failed" }, 500);
  }
});
