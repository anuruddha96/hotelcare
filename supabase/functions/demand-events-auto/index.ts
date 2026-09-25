// Weekly automatic events sweep.
//
// Runs on a schedule so the events calendar stays current even when nobody
// presses "Find events". It walks the next 12 months once per configured
// city/country market, regardless of how many hotels or organisations share it.
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
import { aiFeatureEnabled, checkAiBudget } from "../_shared/aiBudget.ts";

// Cost control: this sweep pays for a web search per month scanned. It now
// runs weekly on a rotating 3-month window, so the full 12-month horizon is
// still refreshed about once a month for a quarter of the old spend.
const WINDOW_MONTHS = 3;      // months looked at per invocation
const WINDOW_SLOTS = 4;       // rotating windows: months 1-3, 4-6, 7-9, 10-12
const MAX_SLOTS = 3;          // AI searches per invocation
const REFRESH_DAYS = 30;      // a month is re-checked at most once a month
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

    // Markets to cover: exactly one search pool per city + country, even when
    // several organisations or hotels participate in that market.
    const [{ data: hotels }, { data: orgs }] = await Promise.all([
      admin
        .from("hotel_configurations")
        .select("hotel_id, organization_id, market_city, market_country, is_active")
        .eq("is_active", true),
      admin.from("organizations").select("id, slug"),
    ]);

    const orgById = new Map(
      ((orgs ?? []) as Array<{ id: string; slug: string }>).map((o) => [o.id, o.slug]),
    );
    type MarketMember = { organizationSlug: string; hotelId: string };
    type MarketPool = {
      city: string;
      country: string;
      members: Map<string, MarketMember>;
    };

    const markets = new Map<string, MarketPool>();
    for (const h of (hotels ?? []) as Array<Record<string, string | boolean | null>>) {
      const organizationSlug = orgById.get(String(h.organization_id ?? "")) ?? "";
      const city = String(h.market_city ?? "").trim();
      const country = String(h.market_country ?? "").trim();
      if (!organizationSlug || !city || !country) continue;

      const key = `${country.toLowerCase()}|${city.toLowerCase()}`;
      const market = markets.get(key) ?? { city, country, members: new Map<string, MarketMember>() };
      if (!market.members.has(organizationSlug)) {
        market.members.set(organizationSlug, {
          organizationSlug,
          hotelId: String(h.hotel_id ?? ""),
        });
      }
      markets.set(key, market);
    }

    // A fresh search by any participant refreshes the whole market pool.
    const freshSince = new Date(Date.now() - REFRESH_DAYS * 86_400_000).toISOString();
    const { data: recent } = await admin
      .from("demand_event_search_runs")
      .select("city, country, month")
      .gte("created_at", freshSince)
      .not("month", "is", null)
      .limit(5000);
    const done = new Set(
      (recent ?? []).map((r: Record<string, string | null>) =>
        `${String(r.country ?? "").toLowerCase()}|${String(r.city ?? "").toLowerCase()}|${r.month ?? ""}`
      ),
    );

    const now = new Date();
    const results: Array<Record<string, unknown>> = [];
    let slots = 0;

    // Rotating window: which quarter of the 12-month horizon this run covers.
    const weekIndex = Math.floor(Date.now() / (7 * 86_400_000));
    const windowStart = (weekIndex % WINDOW_SLOTS) * WINDOW_MONTHS;

    outer:
    for (const market of markets.values()) {
      const members = Array.from(market.members.values()).sort((a, b) => {
        if (a.organizationSlug === "hotelcare" && b.organizationSlug !== "hotelcare") return -1;
        if (b.organizationSlug === "hotelcare" && a.organizationSlug !== "hotelcare") return 1;
        return a.organizationSlug.localeCompare(b.organizationSlug);
      });

      for (let i = windowStart; i < windowStart + WINDOW_MONTHS; i++) {
        if (slots >= MAX_SLOTS) break outer;
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
        const month = monthKey(d);
        const slotKey = `${market.country.toLowerCase()}|${market.city.toLowerCase()}|${month}`;
        if (done.has(slotKey)) continue;

        // Use one eligible participant for the paid search. The result is then
        // mirrored by the database to every organisation in this market.
        let runner: MarketMember | null = null;
        let skipReason = "automatic event sweep is disabled or over budget";
        for (const member of members) {
          if (!(await aiFeatureEnabled(admin, member.organizationSlug, "event_sweep_enabled"))) continue;
          const budget = await checkAiBudget(admin, member.organizationSlug, { scheduled: true });
          if (!budget.allowed) {
            skipReason = budget.reason;
            continue;
          }
          runner = member;
          break;
        }

        if (!runner) {
          results.push({ city: market.city, country: market.country, month, skipped: skipReason });
          continue;
        }

        slots++;
        const result = await searchEvents({
          admin,
          openaiKey: OPENAI_API_KEY,
          organizationSlug: runner.organizationSlug,
          city: market.city,
          country: market.country,
          month,
        });

        let added = 0;
        if (result.candidates.length > 0) {
          const rows = result.candidates.map((candidate) => ({
            organization_slug: runner!.organizationSlug,
            hotel_id: runner!.hotelId || null,
            city: candidate.city,
            country: candidate.country,
            title: candidate.title,
            category: candidate.category,
            venue: candidate.venue,
            event_date: candidate.event_date,
            end_date: candidate.end_date,
            expected_impact: candidate.expected_impact,
            recurs_annually: candidate.recurs_annually,
            url: candidate.url,
            confidence: candidate.confidence,
            source: "ai_auto",
            approved: true,
          }));
          const { data: ins, error } = await admin.from("demand_events").insert(rows).select("id");
          if (error) console.error("auto event insert failed", error.message);
          added = (ins ?? []).length;
        }

        // Each tenant gets a local refresh record so existing RLS/UI continues
        // to show the same market refresh status without cross-tenant reads.
        const runRows = members.map((member) => ({
          organization_slug: member.organizationSlug,
          hotel_id: member.hotelId || null,
          city: market.city,
          country: market.country,
          month,
          months_scanned: 1,
          events_found: result.all.length,
          events_added: added,
          source: "auto",
          run_by_name: "Hotel Care",
          error: result.error ?? null,
        }));
        const { error: runError } = await admin.from("demand_event_search_runs").insert(runRows);
        if (runError) console.error("shared event run log failed", runError.message);

        done.add(slotKey);
        results.push({
          city: market.city,
          country: market.country,
          month,
          organizations: members.length,
          found: result.all.length,
          added,
          error: result.error ?? null,
        });

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
