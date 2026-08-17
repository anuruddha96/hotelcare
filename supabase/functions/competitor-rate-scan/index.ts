// Competitor rate watch — reads publicly published nightly rates.
//
// Uses the hotel's own OpenAI key with web search: for each competitor in the
// set the model looks up the publicly advertised price per night for the next
// N dates and returns it as JSON. Nothing is invented — a date it cannot find
// is returned as null and simply not stored.

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
  const cleaned = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* try to find a block */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* give up */ }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ error: "Not signed in" }, 401);
    const { data: userRes } = await admin.auth.getUser(token);
    const user = userRes?.user;
    if (!user) return json({ error: "Not signed in" }, 401);

    const { data: allowedUser } = await admin.rpc("is_revenue_user", { _uid: user.id });
    if (!allowedUser) return json({ error: "Revenue access is required" }, 403);

    const body = await req.json().catch(() => ({}));
    const hotelId = String(body.hotelId ?? "");
    const days = Math.min(Math.max(Number(body.days ?? 30), 1), 60);
    if (!hotelId) return json({ error: "hotelId is required" }, 400);

    const { data: canAccess } = await admin.rpc("user_can_access_hotel", { _uid: user.id, _hotel_id: hotelId });
    if (canAccess === false) return json({ error: "No access to this hotel" }, 403);

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not configured for this project." }, 500);

    const { data: competitors } = await admin
      .from("competitor_properties")
      .select("id, name, source_url, organization_slug")
      .eq("hotel_id", hotelId)
      .eq("active", true);

    if (!competitors?.length) return json({ ok: true, captured: 0, message: "No competitors configured" });

    const start = new Date();
    const startIso = start.toISOString().slice(0, 10);
    const end = new Date(start.getTime() + days * 86_400_000).toISOString().slice(0, 10);

    let captured = 0;

    for (const c of competitors) {
      const prompt = [
        `Find the publicly advertised nightly room price for the hotel "${c.name}"`,
        c.source_url ? `(official page: ${c.source_url})` : "",
        `for each stay date from ${startIso} to ${end}, for a standard double room, 2 adults, 1 night.`,
        `Search the web. Only report a price you actually saw on a public page.`,
        `Return strict JSON: {"currency":"EUR","rates":[{"date":"YYYY-MM-DD","price":123}]}.`,
        `Use null for price when you could not find it. Do not guess or interpolate.`,
      ].filter(Boolean).join(" ");

      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4.1",
          tools: [{ type: "web_search_preview", search_context_size: "medium" }],
          max_output_tokens: 8000,
          input: prompt,
        }),
      });

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 400);
        console.error(`competitor-rate-scan: OpenAI ${res.status} ${detail}`);
        continue;
      }

      const payload = await res.json();
      const text: string = payload.output_text
        ?? (payload.output ?? [])
          .flatMap((o: { content?: { text?: string }[] }) => o.content ?? [])
          .map((p: { text?: string }) => p.text ?? "")
          .join("");

      const parsed = extractJson(text ?? "") as { currency?: string; rates?: ScannedRate[] } | null;
      const rates = Array.isArray(parsed?.rates) ? parsed!.rates : [];
      const rows = rates
        .filter((r) => r && typeof r.date === "string" && r.price != null && Number.isFinite(Number(r.price)))
        .filter((r) => r.date >= startIso && r.date <= end)
        .map((r) => ({
          competitor_id: c.id,
          hotel_id: hotelId,
          organization_slug: c.organization_slug,
          stay_date: r.date,
          rate: Number(r.price),
          currency: (r.currency ?? parsed?.currency ?? "EUR").toString().slice(0, 6),
          source: c.source_url ?? "web search",
          captured_at: new Date().toISOString(),
        }));

      if (rows.length) {
        const { error } = await admin
          .from("competitor_rates")
          .upsert(rows, { onConflict: "competitor_id,stay_date" });
        if (error) console.error("competitor-rate-scan upsert", error.message);
        else captured += rows.length;
      }
    }

    return json({ ok: true, captured });
  } catch (e) {
    console.error("competitor-rate-scan error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
