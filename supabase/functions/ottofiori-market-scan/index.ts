// Hotel Ottofiori daily market-rate scan.
//
// Runs once each morning and refreshes the next 60 stay dates for every active
// competitor configured in Hotel Authority. It deliberately uses the same
// public-web method as competitor-rate-scan (hotel site, Booking.com and Google
// Hotels), but uses the richer web-search model/context because this is only one
// scheduled run per day and accurate market evidence matters more than saving a
// few cents. Every quote is stored as an observation and reconciled before it
// becomes a market rate, so one bad scrape cannot directly steer pricing.

import { createClient } from "npm:@supabase/supabase-js@2";

const HOTEL_ID = "ottofiori";
const DEFAULT_DAYS = 60;
const MAX_DAYS = 60;
const CHUNK_DAYS = 20;
const LEASE_ID = "ottofiori-market-scan";
const MODEL = "gpt-4o";
const SEARCH_CONTEXT = "medium" as const;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Rate = {
  date: string;
  price: number | null;
  currency?: string | null;
  room_type?: string | null;
  board?: string | null;
  refundable?: boolean | null;
  source_url?: string | null;
  confidence?: number | null;
};

type Competitor = {
  id: string;
  name: string;
  source_url: string | null;
  organization_slug: string;
};

function isoAdd(base: Date, days: number) {
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function extractJson(text: string): { currency?: string; rates?: Rate[] } | null {
  const cleaned = String(text ?? "").replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* continue */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* ignore */ }
  }
  return null;
}

function normaliseBoard(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s.includes("breakfast") && !s.includes("without") && !s.includes("no breakfast")) return "breakfast";
  return "room_only";
}

function estimateCost(inputTokens: number, outputTokens: number) {
  // gpt-4o rough list prices + one medium-context web search.
  return Number((((inputTokens / 1_000_000) * 2.5) + ((outputTokens / 1_000_000) * 10) + 0.0275).toFixed(5));
}

async function askRates(apiKey: string, c: Competitor, dates: string[], strict = false) {
  const prompt = strict ? [
    `Find real public nightly prices for hotel "${c.name}" in Budapest, cheapest standard double room, 2 adults, 1 night.`,
    c.source_url ? `Reference page: ${c.source_url}.` : "",
    `Stay dates: ${dates.join(", ")}.`,
    `Search the hotel website, Booking.com and Google Hotels.`,
    `Do not guess or interpolate. If a date cannot be verified, use null.`,
    `Return JSON only: {"currency":"EUR","rates":[{"date":"YYYY-MM-DD","price":123,"room_type":"Standard Double","board":"room_only","refundable":true,"source_url":"https://...","confidence":0.9}]}`,
  ].filter(Boolean).join(" ") : [
    `Act as a hotel market-rate checker. Find the currently advertised public nightly rate for "${c.name}" in Budapest.`,
    c.source_url ? `Start with this configured competitor page: ${c.source_url}.` : "",
    `Check the hotel website, Booking.com and Google Hotels for each of these stay dates: ${dates.join(", ")}.`,
    `Compare the cheapest available STANDARD DOUBLE room for 2 adults, one night. Prefer room-only; if only breakfast is visible, report it and label board=breakfast.`,
    `For each verified date include room_type, board, refundable, exact source_url and confidence 0..1.`,
    `Never invent a price. Use null when no public price can be verified.`,
    `Return strict JSON only: {"currency":"EUR","rates":[{"date":"YYYY-MM-DD","price":123,"currency":"EUR","room_type":"Standard Double","board":"room_only","refundable":true,"source_url":"https://...","confidence":0.9}]}`,
  ].filter(Boolean).join(" ");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(100_000),
    body: JSON.stringify({
      model: MODEL,
      tools: [{ type: "web_search_preview", search_context_size: SEARCH_CONTEXT }],
      max_output_tokens: 6500,
      input: prompt,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`OpenAI ${response.status}: ${detail}`);
  }

  const payload = await response.json();
  const inputTokens = Number(payload?.usage?.input_tokens ?? 0);
  const outputTokens = Number(payload?.usage?.output_tokens ?? 0);
  const text: string = payload.output_text
    ?? (payload.output ?? [])
      .flatMap((o: { content?: { text?: string }[] }) => o.content ?? [])
      .map((p: { text?: string }) => p.text ?? "")
      .join("");
  const parsed = extractJson(text);
  return {
    rates: Array.isArray(parsed?.rates) ? parsed!.rates! : [],
    currency: parsed?.currency ?? "EUR",
    inputTokens,
    outputTokens,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return json({ error: "OPENAI_API_KEY is not configured" }, 500);

  const body = await req.json().catch(() => ({}));
  const days = Math.min(Math.max(Number(body.days ?? DEFAULT_DAYS), 1), MAX_DAYS);

  const { data: claimed } = await admin.rpc("claim_competitor_scan_lease", {
    _id: LEASE_ID,
    _minutes: 45,
  });
  if (!claimed) return json({ ok: true, skipped: "another Ottofiori market scan is running or paused" });

  const work = (async () => {
    try {
      const { data: competitors, error: competitorError } = await admin
        .from("competitor_properties")
        .select("id,name,source_url,organization_slug")
        .eq("hotel_id", HOTEL_ID)
        .eq("active", true)
        .order("name");
      if (competitorError) throw competitorError;

      const list = (competitors ?? []) as Competitor[];
      if (!list.length) return;

      const org = list[0].organization_slug;
      const { data: budgetRows } = await admin.rpc("ai_spend_snapshot", { _org: org });
      const budget = Array.isArray(budgetRows) ? budgetRows[0] : budgetRows;
      if (budget && budget.within_budget === false) {
        console.warn("ottofiori-market-scan skipped: AI budget reached");
        return;
      }

      const start = new Date();
      const startIso = start.toISOString().slice(0, 10);
      const dates = Array.from({ length: days }, (_, i) => isoAdd(start, i));
      const endIso = dates[dates.length - 1] ?? startIso;

      for (const c of list) {
        const { data: run } = await admin.from("competitor_scan_runs").insert({
          hotel_id: HOTEL_ID,
          organization_slug: c.organization_slug,
          competitor_id: c.id,
          window_from: startIso,
          window_to: endIso,
          dates_requested: days,
          status: "running",
          model: MODEL,
        }).select("id").maybeSingle();
        const runId = run?.id ?? null;
        let observations = 0;
        let error: string | null = null;

        try {
          for (let offset = 0; offset < dates.length; offset += CHUNK_DAYS) {
            const window = dates.slice(offset, offset + CHUNK_DAYS);
            let answer;
            try {
              answer = await askRates(apiKey, c, window, false);
              await admin.from("ai_usage_log").insert({
                organization_slug: c.organization_slug,
                hotel_id: HOTEL_ID,
                function_name: "ottofiori-market-scan",
                model: MODEL,
                input_tokens: answer.inputTokens,
                output_tokens: answer.outputTokens,
                web_searches: 1,
                estimated_cost_usd: estimateCost(answer.inputTokens, answer.outputTokens),
                ok: true,
              });
            } catch (e) {
              error = e instanceof Error ? e.message : String(e);
              answer = { rates: [], currency: "EUR", inputTokens: 0, outputTokens: 0 };
            }

            // A once-daily scan is allowed one stronger re-check when an entire
            // date window yielded no usable quote. This materially improves
            // coverage without creating a continuous scraper.
            if (!answer.rates.some((r: Rate) => r?.price != null)) {
              try {
                const retry = await askRates(apiKey, c, window, true);
                await admin.from("ai_usage_log").insert({
                  organization_slug: c.organization_slug,
                  hotel_id: HOTEL_ID,
                  function_name: "ottofiori-market-scan-retry",
                  model: MODEL,
                  input_tokens: retry.inputTokens,
                  output_tokens: retry.outputTokens,
                  web_searches: 1,
                  estimated_cost_usd: estimateCost(retry.inputTokens, retry.outputTokens),
                  ok: true,
                });
                answer = retry;
              } catch (e) {
                error = e instanceof Error ? e.message : String(e);
              }
            }

            const rows = answer.rates
              .filter((r: Rate) => r && r.price != null && Number.isFinite(Number(r.price)))
              .filter((r: Rate) => r.date >= startIso && r.date <= endIso)
              .filter((r: Rate) => r.confidence == null || Number(r.confidence) >= 0.45)
              .map((r: Rate) => ({
                competitor_id: c.id,
                hotel_id: HOTEL_ID,
                organization_slug: c.organization_slug,
                stay_date: r.date,
                rate: Number(r.price),
                currency: String(r.currency ?? answer.currency ?? "EUR").slice(0, 6),
                room_type: r.room_type ? String(r.room_type).slice(0, 120) : null,
                occupancy: 2,
                board: normaliseBoard(r.board),
                refundable: typeof r.refundable === "boolean" ? r.refundable : null,
                source_page_url: r.source_url ? String(r.source_url).slice(0, 500) : c.source_url,
                raw_confidence: r.confidence == null ? null : Math.max(0, Math.min(1, Number(r.confidence))),
                model: MODEL,
                run_id: runId,
                observed_at: new Date().toISOString(),
              }));

            if (rows.length) {
              const { error: insertError } = await admin.from("competitor_rate_observations").insert(rows);
              if (insertError) throw insertError;
              observations += rows.length;
            }
          }

          let reconciled = 0;
          if (observations > 0) {
            const { data: count, error: recError } = await admin.rpc("reconcile_competitor_rates", {
              _competitor_id: c.id,
              _from: startIso,
              _to: endIso,
              _window_hours: 96,
            });
            if (recError) throw recError;
            reconciled = Number(count ?? 0);
          }

          const status = reconciled > 0 ? "ok" : "no_prices_found";
          if (runId) await admin.from("competitor_scan_runs").update({
            prices_found: reconciled,
            status,
            error: reconciled > 0 ? null : error,
            finished_at: new Date().toISOString(),
          }).eq("id", runId);
          await admin.from("competitor_properties").update({
            last_scan_at: new Date().toISOString(),
            last_scan_status: status,
            last_scan_prices: reconciled,
            last_scan_error: reconciled > 0 ? null : error,
          }).eq("id", c.id);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          if (runId) await admin.from("competitor_scan_runs").update({
            status: "failed",
            error: error.slice(0, 500),
            finished_at: new Date().toISOString(),
          }).eq("id", runId);
          await admin.from("competitor_properties").update({
            last_scan_at: new Date().toISOString(),
            last_scan_status: "failed",
            last_scan_error: error.slice(0, 500),
          }).eq("id", c.id);
        }
      }
    } finally {
      await admin.rpc("release_competitor_scan_lease", { _id: LEASE_ID }).catch(() => {});
    }
  })();

  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (rt) rt.waitUntil(work); else await work;

  return json({ ok: true, started: true, hotelId: HOTEL_ID, days });
});
