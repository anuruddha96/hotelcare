// Competitor rate watch — reads publicly published nightly rates.
//
// Uses the hotel's own OpenAI key with web search. Each competitor is asked in
// small date chunks (a single 30–60 day question used to time out or come back
// truncated). Prices are stored fully qualified — room type, occupancy, board,
// refundability, the page they were read from and a confidence score — so the
// market average compares like with like instead of mixing a non-refundable
// room-only rate with a flexible rate including breakfast.
//
// A blank-date second pass re-asks only the nights a competitor left empty, so
// coverage fills in over consecutive runs instead of sitting at "0 prices".
// The scheduled sweep takes a single-flight lease and pauses itself when the
// OpenAI key is rejected, out of credit, or rate limited.

import { createClient } from "npm:@supabase/supabase-js@2";

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

interface ScannedRate {
  date: string;
  price: number | null;
  currency?: string | null;
  room_type?: string | null;
  board?: string | null;
  refundable?: boolean | null;
  source_url?: string | null;
  confidence?: number | null;
}

class ScanBlocked extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function extractJson(text: string): unknown {
  const cleaned = (text ?? "").replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* try to find a block */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* give up */ }
  }
  return null;
}

// Cost control: web search is billed per call, so the scheduled sweep asks few,
// wide questions with the cheap model, and only the manual button uses the
// expensive one.
const CHUNK_DAYS = 20;
const LEASE_ID = "competitor-rate-scan";
/** Scheduled sweep: near horizon every week, the full 60 nights fortnightly. */
const CRON_NEAR_DAYS = 14;
const CRON_FULL_DAYS = 60;
/** A competitor scanned this recently is skipped by the scheduled sweep. */
const CRON_FRESH_HOURS = 120;

function isoAdd(base: Date, days: number) {
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** One web-search question covering a short date range for one competitor. */
async function askDates(
  apiKey: string,
  competitor: { name: string; source_url: string | null },
  dates: string[],
  strict = false,
  tier: "cheap" | "rich" = "rich",
): Promise<{
  rates: ScannedRate[]; currency: string | null; error: string | null; model: string | null;
  usage: { model: string | null; inputTokens: number; outputTokens: number; searchContext: "low" | "medium" };
}> {
  const prompt = strict ? [
    // Retry wording: short, no prose, one line per date. Long prompts are what
    // make the model answer in prose that cannot be parsed.
    `Nightly public price, cheapest standard double room, 2 adults, 1 night,`,
    `hotel "${competitor.name}" Budapest${competitor.source_url ? ` (${competitor.source_url})` : ""}.`,
    `Dates: ${dates.join(", ")}.`,
    `Answer with JSON only, no explanation:`,
    `{"currency":"EUR","rates":[{"date":"YYYY-MM-DD","price":123,"confidence":0.8}]}.`,
    `Use null for price when no public price is visible.`,
  ].filter(Boolean).join(" ") : [
    `Find the publicly advertised nightly room price for the hotel "${competitor.name}" in Budapest`,
    competitor.source_url ? `(official page: ${competitor.source_url})` : "",
    `for each of these stay dates: ${dates.join(", ")}.`,
    `Always quote the cheapest available STANDARD DOUBLE room for 2 adults, 1 night.`,
    `Search the web (the hotel site, Booking.com, Google Hotels).`,
    `For every date report the room type name, whether breakfast is included ("room_only" or "breakfast"),`,
    `whether the rate is refundable, the exact page URL you read the price on,`,
    `and a confidence between 0 and 1 for how sure you are the price is real and for that date.`,
    `Only report a price you actually saw on a public page. Never guess or interpolate.`,
    `Return strict JSON only:`,
    `{"currency":"EUR","rates":[{"date":"YYYY-MM-DD","price":123,"currency":"EUR","room_type":"Standard Double",`,
    `"board":"breakfast","refundable":true,"source_url":"https://…","confidence":0.9}]}.`,
    `Use null for price when you could not find it.`,
  ].filter(Boolean).join(" ");

  let lastError: string | null = null;
  // The scheduled sweep runs on the cheap model with a small search context;
  // the manual button keeps the stronger model. Only one model is tried per
  // question — a second full web search for the same nights doubled the bill
  // for very little extra coverage.
  const models = tier === "cheap" ? ["gpt-4o-mini"] : ["gpt-4o"];
  const searchContext: "low" | "medium" = tier === "cheap" ? "low" : "medium";
  // Everything the caller needs to bill this question to the spend log.
  const usage = { model: null as string | null, inputTokens: 0, outputTokens: 0, searchContext };
  for (const model of models) {
    try {
      const attempt = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        // A single hung web-search question must never stall the sweep.
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          model,
          tools: [{ type: "web_search_preview", search_context_size: searchContext }],
          max_output_tokens: tier === "cheap" ? 4000 : 6000,
          input: prompt,
        }),
      });

      if (!attempt.ok) {
        const detail = (await attempt.text()).slice(0, 200);
        // Key, credit and rate-limit problems are not per-competitor failures:
        // every following question would fail the same way and spend nothing
        // but time, so the whole sweep stops and parks itself.
        if ([401, 402, 403, 429].includes(attempt.status)) {
          throw new ScanBlocked(`OpenAI ${attempt.status}: ${detail}`, attempt.status);
        }
        lastError = `${model}: ${attempt.status} ${detail}`;
        console.error("competitor-rate-scan", lastError);
        continue;
      }
      const payload = await attempt.json();
      usage.model = model;
      usage.inputTokens = Number(payload?.usage?.input_tokens ?? 0);
      usage.outputTokens = Number(payload?.usage?.output_tokens ?? 0);
      const text: string = payload.output_text
        ?? (payload.output ?? [])
          .flatMap((o: { content?: { text?: string }[] }) => o.content ?? [])
          .map((p: { text?: string }) => p.text ?? "")
          .join("");
      const parsed = extractJson(text ?? "") as { currency?: string; rates?: ScannedRate[] } | null;
      if (!parsed) { lastError = `${model}: no readable answer`; continue; }
      return {
        rates: Array.isArray(parsed.rates) ? parsed.rates : [],
        currency: parsed.currency ?? null,
        error: null,
        model,
      };
    } catch (e) {
      if (e instanceof ScanBlocked) throw e;
      lastError = `${model}: ${e instanceof Error ? e.message : String(e)}`;
      console.error("competitor-rate-scan", lastError);
    }
  }
  return { rates: [], currency: null, error: lastError ?? "no answer", model: null };
}

function normaliseBoard(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s.includes("breakfast") && !s.includes("no breakfast") && !s.includes("without")) return "breakfast";
  if (s.includes("half")) return "half_board";
  if (s.includes("all")) return "all_inclusive";
  return "room_only";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let leaseHeld = false;

  try {
    const body = await req.json().catch(() => ({}));
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const isCron = body.scheduled === true || token === serviceKey;

    let hotelIds: string[] = [];

    if (!isCron) {
      if (!token) return json({ error: "Not signed in" }, 401);
      const { data: userRes } = await admin.auth.getUser(token);
      const user = userRes?.user;
      if (!user) return json({ error: "Not signed in" }, 401);

      const { data: allowedUser } = await admin.rpc("is_revenue_user", { _uid: user.id });
      if (!allowedUser) return json({ error: "Revenue access is required" }, 403);

      const hotelId = String(body.hotelId ?? "");
      if (!hotelId) return json({ error: "hotelId is required" }, 400);
      const { data: canAccess } = await admin.rpc("user_can_access_hotel", { _uid: user.id, _hotel_id: hotelId });
      if (canAccess === false) return json({ error: "No access to this hotel" }, 403);
      hotelIds = [hotelId];
    } else if (body.hotelId) {
      hotelIds = [String(body.hotelId)];
    } else {
      // Scheduled sweep: one run at a time across the whole project.
      const { data: claimed } = await admin.rpc("claim_competitor_scan_lease", {
        _id: LEASE_ID, _minutes: 25,
      });
      if (!claimed) return json({ ok: true, skipped: "another sweep is running or the sweep is paused" });
      leaseHeld = true;

      const { data: all } = await admin
        .from("competitor_properties").select("hotel_id").eq("active", true);
      hotelIds = [...new Set(((all ?? []) as { hotel_id: string }[]).map((r) => r.hotel_id))];
    }

    // Horizon: the manual button keeps whatever the panel asks for. The
    // scheduled sweep looks 14 nights ahead most weeks and stretches to 60
    // every second week — far-out competitor rates barely move, so paying for
    // them weekly is waste.
    const weekOfYear = Math.floor(Date.now() / (7 * 86_400_000));
    const cronDays = weekOfYear % 2 === 0 ? CRON_FULL_DAYS : CRON_NEAR_DAYS;
    const days = Math.min(Math.max(Number(body.days ?? (isCron ? cronDays : 60)), 1), 90);
    const tier: "cheap" | "rich" = isCron ? "cheap" : "rich";
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not configured for this project." }, 500);

    const start = new Date();
    const startIso = start.toISOString().slice(0, 10);
    const endIso = isoAdd(start, days);
    const allDates = Array.from({ length: days }, (_, i) => isoAdd(start, i));

    let captured = 0;
    const results: Array<{ competitor: string; prices: number; observations?: number; error: string | null }> = [];

    // The whole sweep is far slower than the 150s request idle limit, so the
    // HTTP call only starts the work; results land in the tables the panel
    // reads. Nothing is awaited by the browser.
    const scanAll = async () => {
    for (const hotelId of hotelIds) {

      const { data: competitorRows } = await admin
        .from("competitor_properties")
        .select("id, name, source_url, organization_slug, last_scan_at")
        .eq("hotel_id", hotelId)
        .eq("active", true);

      // Freshness skip: a competitor already scanned in the last few days costs
      // money to re-ask and tells us nothing new.
      const freshCutoff = new Date(Date.now() - CRON_FRESH_HOURS * 3_600_000).toISOString();
      const competitors = ((competitorRows ?? []) as Array<{
        id: string; name: string; source_url: string | null; organization_slug: string; last_scan_at: string | null;
      }>).filter((c) => !isCron || !c.last_scan_at || c.last_scan_at < freshCutoff);

      if (!competitors?.length) continue;

      for (const c of competitors) {
        let stored = 0;
        let error: string | null = null;
        let usedModel: string | null = null;
        const filled = new Set<string>();

        const { data: runRow } = await admin.from("competitor_scan_runs").insert({
          hotel_id: hotelId,
          organization_slug: c.organization_slug,
          competitor_id: c.id,
          window_from: startIso,
          window_to: endIso,
          dates_requested: allDates.length,
          status: "running",
        }).select("id").maybeSingle();
        const runId = (runRow as { id?: string } | null)?.id ?? null;

        /**
         * Store one answer as raw observations. Nothing is written straight to
         * the chart table: every scrape is logged, and the agreed price plus a
         * confidence score is derived from all recent observations afterwards
         * (see reconcile_competitor_rates), so a single hallucinated or stale
         * quote can no longer move the market average on its own.
         */
        const persist = async (
          chunk: { rates: ScannedRate[]; currency: string | null; model?: string | null },
        ) => {
          const rows = chunk.rates
            .filter((r) => r && typeof r.date === "string" && r.price != null && Number.isFinite(Number(r.price)))
            .filter((r) => r.date >= startIso && r.date <= endIso)
            .filter((r) => (r.confidence == null ? true : Number(r.confidence) >= 0.3))
            .map((r) => ({
              competitor_id: c.id,
              hotel_id: hotelId,
              organization_slug: c.organization_slug,
              stay_date: r.date,
              rate: Number(r.price),
              currency: (r.currency ?? chunk.currency ?? "EUR").toString().slice(0, 6),
              room_type: r.room_type ? String(r.room_type).slice(0, 120) : null,
              occupancy: 2,
              board: normaliseBoard(r.board),
              refundable: typeof r.refundable === "boolean" ? r.refundable : null,
              source_page_url: r.source_url ? String(r.source_url).slice(0, 500) : (c.source_url ?? null),
              raw_confidence: r.confidence == null ? null : Math.max(0, Math.min(1, Number(r.confidence))),
              model: chunk.model ?? null,
              run_id: runId,
              observed_at: new Date().toISOString(),
            }));

          if (!rows.length) return 0;
          const { error: insErr } = await admin
            .from("competitor_rate_observations")
            .insert(rows);
          if (insErr) {
            error = insErr.message;
            console.error("competitor-rate-scan observations", insErr.message);
            return 0;
          }
          for (const r of rows) filled.add(r.stay_date);
          return rows.length;
        };


        /**
         * One window. A retry costs a second paid web search, so the scheduled
         * sweep only retries when the answer was unreadable — an honest "no
         * public price" is accepted and picked up by the next run.
         */
        const askWindow = async (window: string[]) => {
          let chunk = await askDates(apiKey, c, window, false, tier);
          const unreadable = Boolean(chunk.error);
          if (unreadable || (!isCron && !chunk.rates.length)) {
            chunk = await askDates(apiKey, c, window, true, tier);
          }
          usedModel = chunk.model ?? usedModel;
          if (chunk.error) { error = chunk.error; return; }
          const n = await persist(chunk);
          stored += n;
          captured += n;
        };

        // One pass of wide date windows. The old "fill the blanks" third pass
        // is gone: it tripled the number of paid web searches for nights the
        // next scheduled run covers anyway.
        for (let offset = 0; offset < days; offset += CHUNK_DAYS) {
          await askWindow(allDates.slice(offset, offset + CHUNK_DAYS));
        }

        // Reconcile: cross-check this scrape against the observations of the
        // last few days, drop the ones that disagree with the group and write
        // one agreed, confidence-scored price per night into the chart table.
        let reconciled = 0;
        if (stored > 0) {
          const { data: rec, error: recErr } = await admin.rpc("reconcile_competitor_rates", {
            _competitor_id: c.id, _from: startIso, _to: endIso, _window_hours: 96,
          });
          if (recErr) {
            error = recErr.message;
            console.error("competitor-rate-scan reconcile", recErr.message);
          } else {
            reconciled = Number(rec ?? 0);
          }
        }

        const status = reconciled > 0 ? "ok" : (error ? "failed" : "no_prices_found");

        if (runId) {
          await admin.from("competitor_scan_runs").update({
            prices_found: reconciled,
            status,
            error: reconciled > 0 ? null : error,
            model: usedModel,
            finished_at: new Date().toISOString(),
          }).eq("id", runId);
        }

        await admin.from("competitor_properties").update({
          last_scan_at: new Date().toISOString(),
          last_scan_status: status,
          last_scan_error: reconciled > 0 ? null : error,
          last_scan_prices: reconciled,
        }).eq("id", c.id);

        results.push({
          competitor: c.name,
          prices: reconciled,
          observations: stored,
          error: reconciled > 0 ? null : error,
        });

      }
    }
    };

    const work = scanAll()
      .catch(async (e) => {
        if (e instanceof ScanBlocked) {
          // Park the sweep rather than burn the key on questions that cannot work.
          const minutes = e.status === 429 ? 60 : 12 * 60;
          await admin.rpc("pause_competitor_scan", {
            _id: LEASE_ID, _minutes: minutes, _reason: e.message.slice(0, 300),
          }).catch(() => {});
          leaseHeld = false;
          console.error("competitor-rate-scan blocked", e.message);
          return;
        }
        console.error("competitor-rate-scan error", e);
      })
      .finally(async () => {
        console.log("competitor-rate-scan finished", { captured, hotels: hotelIds.length, results });
        if (leaseHeld) {
          leaseHeld = false;
          await admin.rpc("release_competitor_scan_lease", { _id: LEASE_ID }).catch(() => {});
        }
      });

    const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
    if (rt) rt.waitUntil(work); else await work;

    return json({ ok: true, started: true, hotels: hotelIds.length });
  } catch (e) {
    console.error("competitor-rate-scan error", e);
    if (leaseHeld) {
      await admin.rpc("release_competitor_scan_lease", { _id: LEASE_ID }).catch(() => {});
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }

});
