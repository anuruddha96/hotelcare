// Weekly automatic events sweep.
//
// Runs on a schedule so the events calendar stays current even when nobody
// presses "Find events". It walks the next 12 months for every market a
// property has configured and refreshes each month at most once a week.
//
// Guard rails (this calls a paid AI endpoint):
//   - bounded work: at most MAX_SLOTS AI searches per invocation,
//   - single flight: a run started in the last 10 minutes stops a second one,
//   - idempotent: every finished month is written to demand_event_search_runs
//     so the next invocation skips it for a week,
//   - circuit breaker: the sweep stops as soon as the AI key is rejected.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { searchEvents } from "../_shared/eventSearch.ts";

const MONTHS_AHEAD = 12;
const MAX_SLOTS = 6;          // AI searches per invocation
const REFRESH_DAYS = 7;       // a month is re-checked once a week
const LOCK_MINUTES = 10;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    if (!OPENAI_API_KEY) return json({ ok: false, error: "OPENAI_API_KEY is not configured" }, 200);

    // Single flight: another sweep is still working.
    const lockSince = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
    const { count: running } = await admin
      .from("demand_event_search_runs")
      .select("id", { count: "exact", head: true })
      .eq("source", "auto")
      .gte("created_at", lockSince);
    if ((running ?? 0) > 0) return json({ ok: true, skipped: "another sweep ran recently" });

    // Markets to cover: one per organisation + city.
    const { data: settings } = await admin
      .from("hotel_revenue_settings")
      .select("hotel_id, organization_slug, market_city, market_country");

    const markets = new Map<string, { organizationSlug: string; hotelId: string; city: string; country: string }>();
    for (const s of (settings ?? []) as Array<Record<string, string | null>>) {
      const organizationSlug = s.organization_slug ?? "";
      if (!organizationSlug) continue;
      const city = s.market_city || "Budapest";
      const country = s.market_country || "Hungary";
      const key = `${organizationSlug}|${city.toLowerCase()}`;
      if (!markets.has(key)) {
        markets.set(key, { organizationSlug, hotelId: s.hotel_id ?? "", city, country });
      }
    }

    // Months already refreshed within the last week are skipped.
    const freshSince = new Date(Date.now() - REFRESH_DAYS * 86_400_000).toISOString();
    const { data: recent } = await admin
      .from("demand_event_search_runs")
      .select("organization_slug, city, month")
      .gte("created_at", freshSince)
      .not("month", "is", null)
      .limit(5000);
    const done = new Set(
      (recent ?? []).map((r: Record<string, string>) => `${r.organization_slug}|${(r.city ?? "").toLowerCase()}|${r.month}`),
    );

    const now = new Date();
    const results: Array<Record<string, unknown>> = [];
    let slots = 0;

    outer:
    for (const market of markets.values()) {
      for (let i = 0; i < MONTHS_AHEAD; i++) {
        if (slots >= MAX_SLOTS) break outer;
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
        const month = monthKey(d);
        const slotKey = `${market.organizationSlug}|${market.city.toLowerCase()}|${month}`;
        if (done.has(slotKey)) continue;
        slots++;

        const result = await searchEvents({
          admin,
          openaiKey: OPENAI_API_KEY,
          organizationSlug: market.organizationSlug,
          city: market.city,
          country: market.country,
          month,
        });

        let added = 0;
        if (result.candidates.length > 0) {
          const rows = result.candidates.map((c) => ({
            organization_slug: market.organizationSlug,
            hotel_id: market.hotelId || null,
            city: c.city,
            country: c.country,
            title: c.title,
            category: c.category,
            venue: c.venue,
            event_date: c.event_date,
            end_date: c.end_date,
            expected_impact: c.expected_impact,
            recurs_annually: c.recurs_annually,
            url: c.url,
            confidence: c.confidence,
            source: "ai_auto",
            approved: true,
          }));
          const { data: ins, error } = await admin.from("demand_events").insert(rows).select("id");
          if (error) console.error("auto event insert failed", error.message);
          added = (ins ?? []).length;
        }

        await admin.from("demand_event_search_runs").insert({
          organization_slug: market.organizationSlug,
          hotel_id: market.hotelId || null,
          city: market.city,
          country: market.country,
          month,
          months_scanned: 1,
          events_found: result.all.length,
          events_added: added,
          source: "auto",
          run_by_name: "Hotel Care",
          error: result.error ?? null,
        });

        results.push({ org: market.organizationSlug, city: market.city, month, found: result.all.length, added, error: result.error ?? null });

        // Circuit breaker: a rejected key or exhausted quota will not fix itself
        // within this run, so stop instead of burning the remaining slots.
        if (result.error && /key|quota|credit/i.test(result.error)) break outer;
      }
    }

    return json({ ok: true, scanned: slots, results });
  } catch (e) {
    console.error("demand-events-auto error", e);
    return json({ ok: false, error: (e as Error)?.message ?? "Unexpected error" }, 200);
  }
});
