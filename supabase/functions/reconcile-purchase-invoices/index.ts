/**
 * Purchase-invoice ↔ NAV reconciliation and controlling decisions.
 *
 *  run                    any module user (own organization) or the worker
 *  manual_match           controlling: link a document to a NAV record (reason required)
 *  mark_not_expected      controlling: document is not expected in NAV (reason required)
 *  mark_nav_not_expected  controlling: NAV record needs no uploaded document (reason required)
 *  clear_manual           controlling: undo a manual decision
 *  resolve_conflict       controlling: accept the NAV value or keep the document value
 *
 * Decisions never approve an invoice and never write anything to NAV.
 */
import { authorizeCaller, corsHeaders, InputError, json, serviceDb, type Db, type UserCaller } from "../_shared/purchaseInvoices/piAuth.ts";
import { runReconciliation } from "../_shared/purchaseInvoices/reconcileRunner.ts";
import { taxCore8 } from "../_shared/purchaseInvoices/normalize.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPLICABLE_FIELDS: Record<string, "text" | "date" | "numeric" | "uuid"> = {
  merchant_tax_id: "text", merchant_name: "text", merchant_address: "text", merchant_bank_account: "text",
  buyer_tax_id: "text", buyer_name: "text", buyer_company_id: "uuid", invoice_number: "text", invoice_date: "date",
  performance_date: "date", due_date: "date", payment_method: "text", currency: "text", net_amount: "numeric",
  total_vat_amount: "numeric", total_amount: "numeric",
};

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new InputError(`Select a ${label}`);
  return value;
}
function reason(value: unknown): string {
  const text = String(value ?? "").trim();
  if (text.length < 3) throw new InputError("A reason is required for this decision");
  return text.slice(0, 500);
}

async function loadInvoice(db: Db, caller: UserCaller, invoiceId: string) {
  const { data } = await db.from("purchase_invoices")
    .select("id, organization_slug, buyer_company_id, buyer_tax_id, approval_status, nav_manual_status, hotel_id")
    .eq("id", invoiceId).eq("organization_slug", caller.organizationSlug).maybeSingle();
  if (!data) throw new InputError("Invoice not found", 404);
  if (data.approval_status === "approved") throw new InputError("Approved invoices are locked. A chief controller must reopen the invoice first.");
  return data;
}
async function loadNav(db: Db, caller: UserCaller, navId: string) {
  const { data } = await db.from("pi_nav_invoices")
    .select("id, organization_slug, company_id, customer_tax_number, customer_group_member_tax_number, invoice_number, manual_status")
    .eq("id", navId).eq("organization_slug", caller.organizationSlug).maybeSingle();
  if (!data) throw new InputError("NAV invoice not found", 404);
  return data;
}
async function event(db: Db, caller: UserCaller, action: string, detail: Record<string, unknown>, invoiceId: string | null, navId: string | null, companyId: string | null) {
  await db.from("pi_reconciliation_events").insert({
    organization_slug: caller.organizationSlug, company_id: companyId, invoice_id: invoiceId, nav_invoice_id: navId,
    actor_id: caller.userId, actor_kind: "user", action, detail,
  });
}
function castValue(field: string, value: string | null) {
  if (value == null) return null;
  const kind = APPLICABLE_FIELDS[field];
  if (kind === "numeric") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new InputError("The NAV value is not a number");
    return n;
  }
  if (kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError("The NAV value is not a date");
  if (kind === "uuid" && !UUID.test(value)) throw new InputError("The NAV legal company is invalid");
  return value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
    const db = serviceDb();
    const caller = await authorizeCaller(req, db, { allowWorker: true });
    if (caller instanceof Response) return caller;
    const p = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(p.action ?? "run");

    if (caller.kind === "worker") {
      if (action !== "run") throw new InputError("Workers may only run reconciliation");
      const orgs = new Set<string>();
      if (typeof p.organization_slug === "string" && p.organization_slug) orgs.add(p.organization_slug);
      else {
        const { data } = await db.from("pi_module_settings").select("organization_slug").eq("module_enabled", true);
        for (const row of data ?? []) orgs.add(row.organization_slug);
      }
      const results: Record<string, unknown> = {};
      for (const org of orgs) {
        const r = await runReconciliation(db, org);
        results[org] = { status: r.status, runs: r.runs, summary: r.result?.summary ?? null, error: r.error ?? null };
      }
      return json({ ok: true, results });
    }

    if (action === "run") {
      const result = await runReconciliation(db, caller.organizationSlug);
      if (result.status === "failed") return json({ ok: false, error: "Reconciliation failed. Please try again." }, 500);
      return json({ ok: true, status: result.status, runs: result.runs, summary: result.result?.summary ?? null, applied: result.result?.applied ?? null });
    }

    if (!caller.canControlNav) return json({ ok: false, error: "Only controlling can make reconciliation decisions" }, 403);
    const now = new Date().toISOString();

    if (action === "manual_match") {
      const invoice = await loadInvoice(db, caller, id(p.invoice_id, "document"));
      const nav = await loadNav(db, caller, id(p.nav_invoice_id, "NAV invoice"));
      const why = reason(p.reason);
      // The legal company named on the invoice decides; a property assignment cannot override it.
      const invoiceCore = taxCore8(invoice.buyer_tax_id);
      const navCustomer = [taxCore8(nav.customer_tax_number), taxCore8(nav.customer_group_member_tax_number)];
      const sameCompany = invoice.buyer_company_id === nav.company_id || (!!invoiceCore && navCustomer.includes(invoiceCore));
      if (!sameCompany) throw new InputError("The NAV invoice belongs to a different legal company than the buyer on this document");
      const { error } = await db.from("purchase_invoices").update({
        nav_manual_status: "matched", nav_manual_nav_invoice_id: nav.id, nav_manual_reason: why, nav_manual_by: caller.userId, nav_manual_at: now,
      }).eq("id", invoice.id);
      if (error) throw new InputError(error.message);
      await event(db, caller, "manual_match", { reason: why }, invoice.id, nav.id, nav.company_id);
    } else if (action === "mark_not_expected") {
      const invoice = await loadInvoice(db, caller, id(p.invoice_id, "document"));
      const why = reason(p.reason);
      const { error } = await db.from("purchase_invoices").update({
        nav_manual_status: "not_expected", nav_manual_nav_invoice_id: null, nav_manual_reason: why, nav_manual_by: caller.userId, nav_manual_at: now,
      }).eq("id", invoice.id);
      if (error) throw new InputError(error.message);
      await event(db, caller, "document_not_expected", { reason: why }, invoice.id, null, invoice.buyer_company_id);
    } else if (action === "mark_nav_not_expected") {
      const nav = await loadNav(db, caller, id(p.nav_invoice_id, "NAV invoice"));
      const why = reason(p.reason);
      const { error } = await db.from("pi_nav_invoices").update({
        manual_status: "not_expected", manual_reason: why, manual_by: caller.userId, manual_at: now,
      }).eq("id", nav.id);
      if (error) throw new Error(error.message);
      await event(db, caller, "nav_not_expected", { reason: why }, null, nav.id, nav.company_id);
    } else if (action === "clear_manual") {
      if (p.invoice_id) {
        const invoice = await loadInvoice(db, caller, id(p.invoice_id, "document"));
        const { error } = await db.from("purchase_invoices").update({
          nav_manual_status: null, nav_manual_nav_invoice_id: null, nav_manual_reason: null, nav_manual_by: caller.userId, nav_manual_at: now,
        }).eq("id", invoice.id);
        if (error) throw new InputError(error.message);
        await event(db, caller, "manual_cleared", {}, invoice.id, null, invoice.buyer_company_id);
      } else {
        const nav = await loadNav(db, caller, id(p.nav_invoice_id, "NAV invoice"));
        await db.from("pi_nav_invoices").update({ manual_status: null, manual_reason: null, manual_by: caller.userId, manual_at: now }).eq("id", nav.id);
        // The follow-up closed by the exclusion is reopened if the record is still unmatched.
        await db.from("pi_missing_document_followups").update({ status: "open", resolution: null, resolved_at: null, resolved_by: null })
          .eq("nav_invoice_id", nav.id).eq("status", "resolved").eq("resolution", "not_required");
        await event(db, caller, "manual_cleared", {}, null, nav.id, nav.company_id);
      }
    } else if (action === "resolve_conflict") {
      const provenanceId = id(p.provenance_id, "field difference");
      const decision = String(p.decision ?? "");
      if (decision !== "accept_nav" && decision !== "keep_document") throw new InputError("Choose whether to accept the NAV value or keep the document value");
      const note = decision === "keep_document" ? reason(p.reason) : String(p.reason ?? "").trim().slice(0, 500) || null;
      const { data: row } = await db.from("pi_invoice_field_provenance").select("*")
        .eq("id", provenanceId).eq("organization_slug", caller.organizationSlug).maybeSingle();
      if (!row) throw new InputError("Field difference not found", 404);
      if (row.status !== "open") throw new InputError("This difference has already been decided");
      const invoice = await loadInvoice(db, caller, row.invoice_id);
      if (decision === "accept_nav") {
        if (!(row.field in APPLICABLE_FIELDS)) throw new InputError("This field must be corrected manually on the invoice");
        const value = castValue(row.field, row.nav_value);
        const patch: Record<string, unknown> = { [row.field]: value };
        if (row.field === "currency") patch.currency_source = "nav";
        const { error } = await db.from("purchase_invoices").update(patch).eq("id", invoice.id);
        if (error) throw new InputError(error.message);
        await db.from("purchase_invoice_audit_log").insert({
          invoice_id: invoice.id, organization_slug: caller.organizationSlug, user_id: caller.userId, action: "nav_value_accepted",
          field: row.field, old_value: row.ocr_value, new_value: row.nav_value, notes: note,
        });
      }
      await db.from("pi_invoice_field_provenance").update({
        status: decision === "accept_nav" ? "accepted" : "rejected", final_value: decision === "accept_nav" ? row.nav_value : row.ocr_value,
        decided_by: caller.userId, decided_at: now, decision_note: note, updated_at: now,
      }).eq("id", row.id);
      await event(db, caller, "conflict_resolved", { field: row.field, decision, note }, invoice.id, row.nav_invoice_id, invoice.buyer_company_id);
    } else {
      throw new InputError("Unknown action");
    }

    const result = await runReconciliation(db, caller.organizationSlug);
    return json({ ok: true, reconciliation: { status: result.status, summary: result.result?.summary ?? null } });
  } catch (cause) {
    if (cause instanceof InputError) return json({ ok: false, error: cause.message }, cause.status);
    console.error("reconcile-purchase-invoices failed", cause instanceof Error ? cause.message : "unknown error");
    return json({ ok: false, error: "Reconciliation request failed" }, 500);
  }
});
