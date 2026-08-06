// Phase 4 — outcome measurement for AI revenue recommendations.
// For every recommendation the team marked as applied, compare the booking
// position at the moment it was actioned with the position now.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TZ = "Europe/Budapest";
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function tzDay(iso: string | Date, tz = TZ): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

interface NightRow {
  stay_date: string; res_id: string; nightly_price_eur: number | null; created_at_pms: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userRes, error: userErr } = await userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    if (userErr || !userRes?.user) throw new Error("Unauthorized");

    const { data: profile } = await admin
      .from("profiles").select("role, organization_slug").eq("id", userRes.user.id).single();
    if (!profile || !["admin", "top_management", "top_management_manager"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const hotelId = String(body.hotel_id ?? "");
    if (!hotelId) throw new Error("hotel_id required");

    const { data: hotelCfg } = await admin.from("hotel_configurations")
      .select("hotel_id, organization_slug").eq("hotel_id", hotelId).maybeSingle();
    if (!hotelCfg) throw new Error("Unknown hotel");
    if (profile.role !== "admin" && profile.organization_slug && hotelCfg.organization_slug &&
      hotelCfg.organization_slug !== profile.organization_slug) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = tzDay(new Date());

    // Recommendations that were actioned in the last 90 days and have a stay date.
    const { data: recs } = await admin.from("rm_recommendations")
      .select("id, headline, category, arrival_date, status, acted_at, expected_impact, created_at")
      .eq("hotel_id", hotelId)
      .not("acted_at", "is", null)
      .in("status", ["applied", "partially_applied"])
      .gte("acted_at", new Date(Date.now() - 90 * 86400_000).toISOString())
      .order("acted_at", { ascending: false }).limit(200);

    const rows = (recs ?? []).filter((r) => r.arrival_date);
    if (rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, measured: 0, summary: null, results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dates = [...new Set(rows.map((r) => r.arrival_date as string))].sort();
    const { data: nightData } = await admin.from("revenue_booking_nights")
      .select("stay_date,res_id,nightly_price_eur,created_at_pms")
      .eq("hotel_id", hotelId).in("stay_date", dates).limit(20000);
    const nights = (nightData ?? []) as NightRow[];

    const byDate = new Map<string, NightRow[]>();
    for (const n of nights) {
      if (!byDate.has(n.stay_date)) byDate.set(n.stay_date, []);
      byDate.get(n.stay_date)!.push(n);
    }

    const results: Record<string, unknown>[] = [];
    for (const r of rows) {
      const date = r.arrival_date as string;
      const actedMs = Date.parse(r.acted_at as string);
      const all = byDate.get(date) ?? [];
      const before = all.filter((n) => n.created_at_pms && Date.parse(n.created_at_pms) <= actedMs);
      const after = all.filter((n) => n.created_at_pms && Date.parse(n.created_at_pms) > actedMs);

      const rev = (xs: NightRow[]) => xs.reduce((s, x) => s + Number(x.nightly_price_eur ?? 0), 0);
      const adrBefore = before.length ? rev(before) / before.length : null;
      const adrAfter = after.length ? rev(after) / after.length : null;
      const adrDelta = adrBefore !== null && adrAfter !== null ? adrAfter - adrBefore : null;
      const revenueDelta = rev(after);
      const expected = (r.expected_impact ?? {}) as { revenue_change?: number | null; adr_change?: number | null };
      const expectedRev = Number(expected.revenue_change ?? NaN);

      const daysObserved = Math.max(0, Math.round((Date.now() - actedMs) / 86400000));
      const settled = date < today;
      const verdict = !settled && daysObserved < 2 ? "too_early"
        : revenueDelta > 0 && (adrDelta === null || adrDelta >= 0) ? "positive"
        : revenueDelta > 0 ? "mixed"
        : after.length === 0 && settled ? "no_effect"
        : after.length === 0 ? "pending"
        : "negative";

      const outcome = {
        measured_at: new Date().toISOString(),
        days_observed: daysObserved,
        settled,
        rooms_before: before.length,
        rooms_after: after.length,
        rooms_delta: after.length,
        adr_before_eur: adrBefore === null ? null : round(adrBefore),
        adr_after_eur: adrAfter === null ? null : round(adrAfter),
        adr_delta_eur: adrDelta === null ? null : round(adrDelta),
        revenue_delta_eur: round(revenueDelta),
        expected_revenue_eur: Number.isFinite(expectedRev) ? round(expectedRev) : null,
        accuracy_pct: Number.isFinite(expectedRev) && expectedRev !== 0
          ? round(Math.max(0, 100 - Math.abs((revenueDelta - expectedRev) / expectedRev) * 100), 1)
          : null,
        verdict,
      };

      await admin.from("rm_recommendations").update({ outcome }).eq("id", r.id);
      results.push({
        id: r.id, headline: r.headline, category: r.category, arrival_date: date,
        status: r.status, acted_at: r.acted_at, outcome,
      });
    }

    const measurable = results.filter((x) => (x.outcome as { verdict: string }).verdict !== "too_early");
    const totalDelta = measurable.reduce((s, x) => s + Number((x.outcome as { revenue_delta_eur: number }).revenue_delta_eur || 0), 0);
    const wins = measurable.filter((x) => (x.outcome as { verdict: string }).verdict === "positive").length;

    return new Response(JSON.stringify({
      ok: true,
      measured: results.length,
      summary: {
        actioned: rows.length,
        measurable: measurable.length,
        positive: wins,
        hit_rate_pct: measurable.length ? round((wins / measurable.length) * 100, 1) : null,
        revenue_delta_eur: round(totalDelta),
      },
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("rm-measure-outcomes failed:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
