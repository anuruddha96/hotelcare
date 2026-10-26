// Reconcile HotelCare purchase invoices against normalized NAV invoice records.
// This endpoint deliberately keeps matching deterministic/auditable: AI can help
// extract the HotelCare document, but the final NAV match is based on tax id,
// invoice number, dates and money controls.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type NavRecord = {
  source_id?: string | null;
  buyer_tax_id?: string | null;
  supplier_tax_id?: string | null;
  supplier_name?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  performance_date?: string | null;
  due_date?: string | null;
  currency?: string | null;
  net_amount?: number | string | null;
  vat_amount?: number | string | null;
  total_amount?: number | string | null;
  invoice_operation?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

type MatchCandidate = {
  invoice: any;
  score: number;
  details: Record<string, unknown>;
  hardConflict: boolean;
};

const FINANCE_ROLES = [
  "admin", "top_management", "top_management_manager", "control_finance", "back_office",
];

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function normalizeTaxId(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 11);
}

function normalizeInvoiceNo(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9áéíóöőúüű ]/gi, " ")
    .replace(/\b(kft|zrt|nyrt|bt|ltd|limited|korlatolt|felelossegu|tarsasag)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(value.split(" ").filter(x => x.length > 2));
}

function nameSimilarity(a: unknown, b: unknown): number {
  const aa = tokens(normalizeName(a));
  const bb = tokens(normalizeName(b));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const t of aa) if (bb.has(t)) intersection += 1;
  const union = new Set([...aa, ...bb]).size;
  return union ? intersection / union : 0;
}

function n(value: unknown): number | null {
  if (value == null || value === "") return null;
  const x = typeof value === "number"
    ? value
    : Number(String(value).replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, "."));
  return Number.isFinite(x) ? x : null;
}

function moneyDiff(a: unknown, b: unknown): number | null {
  const aa = n(a); const bb = n(b);
  return aa == null || bb == null ? null : Math.abs(aa - bb);
}

function dateDiffDays(a: unknown, b: unknown): number | null {
  if (!a || !b) return null;
  const da = new Date(String(a)); const db = new Date(String(b));
  if (!Number.isFinite(da.getTime()) || !Number.isFinite(db.getTime())) return null;
  return Math.abs(da.getTime() - db.getTime()) / 864e5;
}

function scoreCandidate(
  nav: NavRecord,
  invoice: any,
  amountTolerance: number,
  dateToleranceDays: number,
): MatchCandidate {
  const navTax = normalizeTaxId(nav.supplier_tax_id);
  const invTax = normalizeTaxId(invoice.merchant_tax_id);
  const navNo = normalizeInvoiceNo(nav.invoice_number);
  const invNo = normalizeInvoiceNo(invoice.invoice_number);

  const taxExact = !!navTax && !!invTax && navTax === invTax;
  const invoiceNoExact = !!navNo && !!invNo && navNo === invNo;
  const buyerTaxExact = !!normalizeTaxId(nav.buyer_tax_id) &&
    normalizeTaxId(nav.buyer_tax_id) === normalizeTaxId(invoice.buyer_tax_id);
  const totalDiff = moneyDiff(nav.total_amount, invoice.total_amount);
  const vatDiff = moneyDiff(nav.vat_amount, invoice.total_vat_amount);
  const dateDiff = dateDiffDays(nav.invoice_date, invoice.invoice_date);
  const supplierNameSimilarity = nameSimilarity(nav.supplier_name, invoice.merchant_name);

  let score = 0;
  if (taxExact) score += 0.34;
  if (invoiceNoExact) score += 0.34;
  if (totalDiff != null && totalDiff <= amountTolerance) score += 0.15;
  if (vatDiff != null && vatDiff <= amountTolerance) score += 0.07;
  if (dateDiff != null && dateDiff <= dateToleranceDays) score += 0.06;
  if (buyerTaxExact) score += 0.04;
  if (!taxExact && supplierNameSimilarity >= 0.8) score += 0.16;
  else if (!taxExact && supplierNameSimilarity >= 0.55) score += 0.08;

  // The invoice number is the strongest discriminator. A different number may
  // still be a probable OCR mismatch, but can never be an automatic exact match.
  if (navNo && invNo && !invoiceNoExact) score = Math.min(score, 0.86);
  if (navTax && invTax && !taxExact) score = Math.min(score, 0.84);

  const hardConflict = taxExact && invoiceNoExact && (
    (totalDiff != null && totalDiff > amountTolerance) ||
    (vatDiff != null && vatDiff > amountTolerance)
  );

  return {
    invoice,
    score: Math.max(0, Math.min(1, Number(score.toFixed(4)))),
    hardConflict,
    details: {
      tax_exact: taxExact,
      invoice_number_exact: invoiceNoExact,
      buyer_tax_exact: buyerTaxExact,
      supplier_name_similarity: Number(supplierNameSimilarity.toFixed(4)),
      total_difference: totalDiff,
      vat_difference: vatDiff,
      invoice_date_difference_days: dateDiff,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return response({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return response({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await admin
      .from("profiles")
      .select("id, role, organization_slug, assigned_hotel")
      .eq("id", user.id)
      .single();
    if (!profile || !FINANCE_ROLES.includes(profile.role)) return response({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const records: NavRecord[] = Array.isArray(body?.records) ? body.records : [];
    if (!records.length) return response({ error: "records[] is required" }, 400);
    if (records.length > 5000) return response({ error: "Maximum 5000 NAV records per run" }, 413);

    const organizationSlug = profile.organization_slug;
    const hotelId = body?.hotelId || null;
    const source = String(body?.source || "nav_import").slice(0, 50);

    const { data: settings } = await admin
      .from("invoice_automation_settings")
      .select("nav_auto_match_threshold, nav_amount_tolerance_huf, nav_date_tolerance_days")
      .eq("organization_slug", organizationSlug)
      .maybeSingle();
    const autoThreshold = Number(settings?.nav_auto_match_threshold ?? 0.97);
    const amountTolerance = Number(settings?.nav_amount_tolerance_huf ?? 2);
    const dateToleranceDays = Number(settings?.nav_date_tolerance_days ?? 2);

    const { data: run, error: runError } = await admin
      .from("purchase_invoice_reconciliation_runs")
      .insert({
        organization_slug: organizationSlug,
        hotel_id: hotelId,
        source,
        imported_by: user.id,
        records_received: records.length,
      })
      .select("id")
      .single();
    if (runError) throw runError;

    let query = admin
      .from("purchase_invoices")
      .select("id, hotel_id, merchant_name, merchant_tax_id, buyer_tax_id, invoice_number, invoice_date, total_amount, total_vat_amount, currency, nav_match_status")
      .eq("organization_slug", organizationSlug)
      .not("status", "eq", "failed");
    if (hotelId) query = query.eq("hotel_id", hotelId);

    const completeFrom = body?.completePeriod?.from ? String(body.completePeriod.from) : null;
    const completeTo = body?.completePeriod?.to ? String(body.completePeriod.to) : null;
    if (completeFrom) query = query.gte("invoice_date", completeFrom);
    if (completeTo) query = query.lte("invoice_date", completeTo);

    const { data: hotelcareInvoices, error: invoiceError } = await query.limit(10000);
    if (invoiceError) throw invoiceError;
    const invoices = hotelcareInvoices ?? [];

    const matchedInvoiceIds = new Set<string>();
    const exceptions: any[] = [];
    let exactMatches = 0;
    let probableMatches = 0;
    let conflicts = 0;
    let missingInHotelcare = 0;

    for (const rawRecord of records) {
      const record: NavRecord = {
        ...rawRecord,
        supplier_tax_id: normalizeTaxId(rawRecord.supplier_tax_id) || null,
        buyer_tax_id: normalizeTaxId(rawRecord.buyer_tax_id) || null,
        invoice_number: rawRecord.invoice_number ? String(rawRecord.invoice_number).trim() : null,
        currency: String(rawRecord.currency || "HUF").toUpperCase(),
        net_amount: n(rawRecord.net_amount),
        vat_amount: n(rawRecord.vat_amount),
        total_amount: n(rawRecord.total_amount),
      };

      const candidates = invoices
        .map(inv => scoreCandidate(record, inv, amountTolerance, dateToleranceDays))
        .filter(c => c.score >= 0.4 || c.hardConflict)
        .sort((a, b) => b.score - a.score);
      const best = candidates[0] || null;
      const second = candidates[1] || null;
      const ambiguous = !!best && !!second && Math.abs(best.score - second.score) < 0.06;

      let matchStatus = "missing_in_hotelcare";
      let matchedInvoiceId: string | null = null;
      let matchScore = best?.score ?? 0;
      let matchDetails: Record<string, unknown> = {
        run_id: run.id,
        candidate_count: candidates.length,
        ambiguous,
      };

      if (best?.hardConflict) {
        matchStatus = "conflict";
        matchedInvoiceId = best.invoice.id;
        conflicts += 1;
        matchDetails = { ...matchDetails, ...best.details, reason: "same_supplier_and_invoice_number_but_values_differ" };
      } else if (best && best.score >= autoThreshold && !ambiguous) {
        matchStatus = "matched";
        matchedInvoiceId = best.invoice.id;
        exactMatches += 1;
        matchDetails = { ...matchDetails, ...best.details, automatic: true };
      } else if (best && best.score >= 0.78 && !ambiguous) {
        matchStatus = "probable";
        matchedInvoiceId = best.invoice.id;
        probableMatches += 1;
        matchDetails = { ...matchDetails, ...best.details, automatic: false };
      } else {
        missingInHotelcare += 1;
        if (best) matchDetails = { ...matchDetails, ...best.details, best_candidate_invoice_id: best.invoice.id };
      }

      const navRow = {
        organization_slug: organizationSlug,
        hotel_id: hotelId,
        source,
        source_id: record.source_id || null,
        buyer_tax_id: record.buyer_tax_id || null,
        supplier_tax_id: record.supplier_tax_id || null,
        supplier_name: record.supplier_name || null,
        invoice_number: record.invoice_number || null,
        invoice_date: record.invoice_date || null,
        performance_date: record.performance_date || null,
        due_date: record.due_date || null,
        currency: record.currency || "HUF",
        net_amount: record.net_amount,
        vat_amount: record.vat_amount,
        total_amount: record.total_amount,
        invoice_operation: record.invoice_operation || null,
        matched_invoice_id: matchedInvoiceId,
        match_status: matchStatus,
        match_score: matchScore,
        match_details: matchDetails,
        raw_payload: record.raw_payload || rawRecord,
        imported_by: user.id,
        updated_at: new Date().toISOString(),
      };

      let navId: string | null = null;
      if (record.source_id) {
        const { data: saved, error } = await admin
          .from("purchase_invoice_nav_records")
          .upsert(navRow, { onConflict: "organization_slug,source,source_id" })
          .select("id")
          .single();
        if (error) throw error;
        navId = saved?.id ?? null;
      } else {
        const { data: saved, error } = await admin
          .from("purchase_invoice_nav_records")
          .insert(navRow)
          .select("id")
          .single();
        if (error) throw error;
        navId = saved?.id ?? null;
      }

      if (matchedInvoiceId) {
        matchedInvoiceIds.add(matchedInvoiceId);
        const detail = best?.details || {};
        await admin.from("purchase_invoices").update({
          nav_match_status: matchStatus,
          nav_match_score: matchScore,
          nav_last_checked_at: new Date().toISOString(),
          nav_record_id: navId,
          nav_difference: {
            total_difference: detail.total_difference ?? null,
            vat_difference: detail.vat_difference ?? null,
            invoice_date_difference_days: detail.invoice_date_difference_days ?? null,
          },
          auto_reconciled: matchStatus === "matched",
          needs_review: matchStatus === "conflict" ? true : undefined,
        }).eq("id", matchedInvoiceId);
      }

      if (matchStatus !== "matched") {
        exceptions.push({
          nav_record_id: navId,
          invoice_number: record.invoice_number,
          supplier_name: record.supplier_name,
          supplier_tax_id: record.supplier_tax_id,
          total_amount: record.total_amount,
          status: matchStatus,
          score: matchScore,
          matched_invoice_id: matchedInvoiceId,
          details: matchDetails,
        });
      }
    }

    // Only mark HotelCare invoices as missing in NAV when the caller explicitly
    // confirms that the uploaded/query result is a complete NAV period.
    let missingInNav = 0;
    if (completeFrom && completeTo) {
      const missingIds = invoices
        .filter(inv => !matchedInvoiceIds.has(inv.id))
        .map(inv => inv.id);
      missingInNav = missingIds.length;
      if (missingIds.length) {
        await admin.from("purchase_invoices").update({
          nav_match_status: "missing_in_nav",
          nav_match_score: 0,
          nav_last_checked_at: new Date().toISOString(),
          auto_reconciled: false,
        }).in("id", missingIds);
      }
    }

    const summary = {
      records_received: records.length,
      exact_matches: exactMatches,
      probable_matches: probableMatches,
      conflicts,
      missing_in_hotelcare: missingInHotelcare,
      missing_in_nav: missingInNav,
      match_rate: records.length ? Number((exactMatches / records.length).toFixed(4)) : 0,
      auto_match_threshold: autoThreshold,
      amount_tolerance: amountTolerance,
      date_tolerance_days: dateToleranceDays,
      complete_period: completeFrom && completeTo ? { from: completeFrom, to: completeTo } : null,
    };

    await admin.from("purchase_invoice_reconciliation_runs").update({
      exact_matches: exactMatches,
      probable_matches: probableMatches,
      conflicts,
      missing_in_hotelcare: missingInHotelcare,
      missing_in_nav: missingInNav,
      summary,
      completed_at: new Date().toISOString(),
    }).eq("id", run.id);

    return response({ success: true, run_id: run.id, summary, exceptions: exceptions.slice(0, 500) });
  } catch (error) {
    console.error("reconcile-purchase-invoices-nav", error);
    return response({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
