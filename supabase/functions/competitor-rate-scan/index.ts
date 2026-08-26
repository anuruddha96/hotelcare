// Competitor rate watch — reads publicly published nightly rates.
//
// Uses the hotel's own OpenAI key with web search. Each competitor is asked in
// small date chunks (a single 30–60 day question used to time out or come back
// truncated, which is why the panel showed "0 prices" for everyone). Every
// competitor records the outcome of its last scan so the UI can explain a
// failure instead of silently showing nothing.

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

interface ScannedRate { date: string; price: number | null; currency?: string | null }

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

const CHUNK_DAYS = 10;

function isoAdd(base: Date, days: number) {
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** One web-search question covering a short date range for one competitor. */
async function askChunk(
  apiKey: string,
  competitor: { name: string; source_url: string | null },
  from: string,
  to: string,
): Promise<{ rates: ScannedRate[]; currency: string | null; error: string | null }> {
  const prompt = [
    `Find the publicly advertised nightly room price for the hotel "${competitor.name}" in Budapest`,
    competitor.source_url ? `(official page: ${competitor.source_url})` : "",
    `for each stay date from ${from} to ${to}, standard double room, 2 adults, 1 night.`,
    `Search the web (the hotel site, Booking.com, Google Hotels).`,
    `Only report a price you actually saw on a public page.`,
    `Return strict JSON only: {"currency":"EUR","rates":[{"date":"YYYY-MM-DD","price":123}]}.`,
    `Use null for price when you could not find it. Never guess or interpolate.`,
  ].filter(Boolean).join(" ");

  let lastError: string | null = null;
  for (const model of ["gpt-4o", "gpt-4.1"]) {
    try {
      const attempt = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          tools: [{ type: "web_search_preview", search_context_size: "medium" }],
          max_output_tokens: 4000,
          input: prompt,
        }),
      });
      if (!attempt.ok) {
        lastError = `${model}: ${attempt.status} ${(await attempt.text()).slice(0, 200)}`;
        console.error("competitor-rate-scan", lastError);
        continue;
      }
      const payload = await attempt.json();
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
      };
    } catch (e) {
      lastError = `${model}: ${e instanceof Error ? e.message : String(e)}`;
      console.error("competitor-rate-scan", lastError);
    }
  }
  return { rates: [], currency: null, error: lastError ?? "no answer" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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
      // Scheduled sweep: every hotel that has at least one active competitor.
      const { data: all } = await admin
        .from("competitor_properties").select("hotel_id").eq("active", true);
      hotelIds = [...new Set(((all ?? []) as { hotel_id: string }[]).map((r) => r.hotel_id))];
    }

    const days = Math.min(Math.max(Number(body.days ?? 30), 1), 60);
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not configured for this project." }, 500);

    const start = new Date();
    const startIso = start.toISOString().slice(0, 10);
    const endIso = isoAdd(start, days);

    let captured = 0;
    const results: Array<{ competitor: string; prices: number; error: string | null }> = [];

    for (const hotelId of hotelIds) {
      const { data: competitors } = await admin
        .from("competitor_properties")
        .select("id, name, source_url, organization_slug")
        .eq("hotel_id", hotelId)
        .eq("active", true);

      if (!competitors?.length) continue;

      for (const c of competitors) {
        let stored = 0;
        let error: string | null = null;

        for (let offset = 0; offset < days; offset += CHUNK_DAYS) {
          const from = isoAdd(start, offset);
          const to = isoAdd(start, Math.min(offset + CHUNK_DAYS - 1, days));
          const chunk = await askChunk(apiKey, c, from, to);
          if (chunk.error) { error = chunk.error; continue; }

          const rows = chunk.rates
            .filter((r) => r && typeof r.date === "string" && r.price != null && Number.isFinite(Number(r.price)))
            .filter((r) => r.date >= startIso && r.date <= endIso)
            .map((r) => ({
              competitor_id: c.id,
              hotel_id: hotelId,
              organization_slug: c.organization_slug,
              stay_date: r.date,
              rate: Number(r.price),
              currency: (r.currency ?? chunk.currency ?? "EUR").toString().slice(0, 6),
              source: c.source_url ?? "web search",
              captured_at: new Date().toISOString(),
            }));

          if (rows.length) {
            const { error: upErr } = await admin
              .from("competitor_rates")
              .upsert(rows, { onConflict: "competitor_id,stay_date" });
            if (upErr) { error = upErr.message; console.error("competitor-rate-scan upsert", upErr.message); }
            else { stored += rows.length; captured += rows.length; }
          }
        }

        await admin.from("competitor_properties").update({
          last_scan_at: new Date().toISOString(),
          last_scan_status: stored > 0 ? "ok" : (error ? "failed" : "no_prices_found"),
          last_scan_error: stored > 0 ? null : error,
          last_scan_prices: stored,
        }).eq("id", c.id);

        results.push({ competitor: c.name, prices: stored, error: stored > 0 ? null : error });
      }
    }

    return json({ ok: true, captured, hotels: hotelIds.length, results });
  } catch (e) {
    console.error("competitor-rate-scan error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
