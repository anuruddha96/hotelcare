/**
 * Daily purchase-invoice exception summary (scheduled worker only).
 *
 * Sends one e-mail per organization and day, only when there is something to
 * act on: NAV invoices without documents, reconciliation exceptions, pending
 * approvals and NAV connection problems. Amounts are never summed across
 * currencies. Recipients must still have access to the module.
 */
import { corsHeaders, isWorkerRequest, json, serviceDb, type Db } from "../_shared/purchaseInvoices/piAuth.ts";
import { sendEmail } from "../_shared/emailSender.ts";
import { budapestToday } from "../_shared/purchaseInvoices/reconcileRunner.ts";
import { sha512HexUpper } from "../_shared/purchaseInvoices/navCrypto.ts";

const BLOCKING = ["data_mismatch", "duplicate_document", "competing_nav_candidates", "correction_chain"];
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function count(query: Promise<{ count: number | null; error: unknown }>): Promise<number> {
  const { count: n } = await query;
  return n ?? 0;
}

export async function buildSummary(db: Db, org: string) {
  const [missing, exceptions, documentOnly, pendingApproval, connections] = await Promise.all([
    db.from("pi_missing_document_followups").select("id, nav_invoice_id, created_at, company_id, pi_nav_invoices(invoice_number, supplier_name, currency, gross_amount, invoice_issue_date)")
      .eq("organization_slug", org).in("status", ["open", "requested", "in_progress"]).order("created_at").limit(500),
    count(db.from("purchase_invoices").select("id", { count: "exact", head: true }).eq("organization_slug", org).in("nav_match_status", BLOCKING)),
    count(db.from("purchase_invoices").select("id", { count: "exact", head: true }).eq("organization_slug", org).eq("nav_match_status", "document_only")),
    count(db.from("purchase_invoices").select("id", { count: "exact", head: true }).eq("organization_slug", org)
      .eq("review_status", "pending_approval").not("approval_status", "in", "(approved,rejected)")),
    db.from("pi_nav_connections").select("id, environment, status, enabled, consecutive_failures, last_success_at, last_error_message, invoice_buyer_companies(name)")
      .eq("organization_slug", org).eq("enabled", true),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- embedded PostgREST rows
  const rows = (missing.data ?? []) as Array<Record<string, any>>;
  const byCurrency = new Map<string, { count: number; gross: number }>();
  for (const r of rows) {
    const nav = r.pi_nav_invoices ?? {};
    const cur = String(nav.currency ?? "HUF");
    const entry = byCurrency.get(cur) ?? { count: 0, gross: 0 };
    entry.count++;
    entry.gross += Number(nav.gross_amount ?? 0);
    byCurrency.set(cur, entry);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- embedded PostgREST rows
  const unhealthy = ((connections.data ?? []) as Array<Record<string, any>>).filter((c) =>
    c.status === "error" || (c.consecutive_failures ?? 0) > 0 || !c.last_success_at || Date.now() - Date.parse(c.last_success_at) > 26 * 3_600_000);
  return {
    missingCount: rows.length,
    oldest: rows.slice(0, 10).map((r) => ({
      invoice: r.pi_nav_invoices?.invoice_number ?? "—", supplier: r.pi_nav_invoices?.supplier_name ?? "—",
      issued: r.pi_nav_invoices?.invoice_issue_date ?? null, amount: r.pi_nav_invoices?.gross_amount ?? null, currency: r.pi_nav_invoices?.currency ?? null,
    })),
    missingByCurrency: [...byCurrency.entries()].map(([currency, v]) => ({ currency, count: v.count, gross: Math.round(v.gross * 100) / 100 })),
    exceptions,
    documentOnly,
    pendingApproval,
    unhealthyConnections: unhealthy.map((c) => ({ company: c.invoice_buyer_companies?.name ?? "—", environment: c.environment, error: c.last_error_message ?? null })),
  };
}

function render(org: string, s: Awaited<ReturnType<typeof buildSummary>>, appUrl: string) {
  const fmt = (n: number, cur: string) => new Intl.NumberFormat("hu-HU", { style: "currency", currency: cur, maximumFractionDigits: cur === "HUF" ? 0 : 2 }).format(n);
  const lines = [
    `NAV-ban szereplő, feltöltött bizonylat nélküli számlák / NAV invoices without a document: ${s.missingCount}`,
    ...s.missingByCurrency.map((m) => `  ${m.currency}: ${m.count} db, ${fmt(m.gross, m.currency)}`),
    `Egyeztetési eltérések / Reconciliation exceptions: ${s.exceptions}`,
    `NAV-ban (még) nem található bizonylatok / Documents not found in NAV: ${s.documentOnly}`,
    `Jóváhagyásra vár / Pending approval: ${s.pendingApproval}`,
    ...s.unhealthyConnections.map((c) => `NAV kapcsolat hiba / NAV connection issue: ${c.company} (${c.environment})${c.error ? ` – ${c.error}` : ""}`),
  ];
  const link = `${appUrl.replace(/\/$/, "")}/${encodeURIComponent(org)}/purchase-invoices`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111">
<h2 style="font-size:18px">Bejövő számlák – napi összefoglaló / Purchase invoices – daily summary</h2>
<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
${s.oldest.length ? `<p><strong>Legrégebbi hiányzó bizonylatok / Oldest missing documents</strong></p><table cellpadding="4" style="border-collapse:collapse">${s.oldest.map((o) =>
    `<tr><td>${escapeHtml(o.supplier)}</td><td>${escapeHtml(o.invoice)}</td><td>${escapeHtml(o.issued ?? "")}</td><td>${o.amount != null && o.currency ? escapeHtml(fmt(Number(o.amount), o.currency)) : ""}</td></tr>`).join("")}</table>` : ""}
<p><a href="${escapeHtml(link)}">Megnyitás a HotelCare-ben / Open in HotelCare</a></p>
<p style="color:#666;font-size:12px">A NAV egyezés nem jelenti a számla kifizetését. / A NAV match is not proof of payment.</p></div>`;
  return { html, text: `${lines.join("\n")}\n\n${link}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const db = serviceDb();
    if (!(await isWorkerRequest(req, db))) return json({ ok: false, error: "Unauthorized" }, 401);
    const today = budapestToday();
    const appUrl = Deno.env.get("HOTELCARE_APP_URL") ?? "https://my.hotelcare.app";
    const { data: orgs } = await db.from("pi_module_settings").select("organization_slug, notification_recipient_ids")
      .eq("module_enabled", true).eq("daily_summary_enabled", true);
    const results: Record<string, unknown> = {};
    for (const org of orgs ?? []) {
      const slug = String(org.organization_slug);
      const { data: already } = await db.from("pi_daily_summary_log").select("sent_on").eq("organization_slug", slug).eq("sent_on", today).maybeSingle();
      if (already) { results[slug] = "already_sent"; continue; }
      const summary = await buildSummary(db, slug);
      const exceptionCount = summary.missingCount + summary.exceptions + summary.documentOnly + summary.pendingApproval + summary.unhealthyConnections.length;
      if (exceptionCount === 0) { results[slug] = "nothing_to_report"; continue; }
      const ids: string[] = org.notification_recipient_ids ?? [];
      const { data: people } = ids.length
        ? await db.from("profiles").select("id, email, organization_slug").in("id", ids).eq("organization_slug", slug)
        : { data: [] };
      const recipients: string[] = [];
      for (const person of people ?? []) {
        if (!person.email) continue;
        const { data: allowed } = await db.rpc("pi_module_access_for", { _uid: person.id });
        if (allowed === true) recipients.push(String(person.email));
      }
      if (!recipients.length) { results[slug] = "no_recipients"; continue; }
      const { html, text } = render(slug, summary, appUrl);
      const sent = await sendEmail({
        admin: db, organizationSlug: slug, to: recipients, kind: "digest",
        subject: `HotelCare – bejövő számlák napi összefoglaló (${today})`, html, text,
      });
      if (!sent.ok && !sent.skipped) { results[slug] = { error: sent.error ?? "send failed" }; continue; }
      await db.from("pi_daily_summary_log").insert({
        organization_slug: slug, sent_on: today, recipients: recipients.length, exception_count: exceptionCount,
        fingerprint: (await sha512HexUpper(JSON.stringify(summary))).slice(0, 32),
      });
      results[slug] = { sent: recipients.length, exceptions: exceptionCount };
    }
    return json({ ok: true, date: today, results });
  } catch (cause) {
    console.error("pi-daily-summary failed", cause instanceof Error ? cause.message : "unknown error");
    return json({ ok: false, error: "Daily summary failed" }, 500);
  }
});
