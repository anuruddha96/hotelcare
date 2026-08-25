// Suggests a competitive set with the hotel's own OpenAI key.
//
// The model searches the web for real, comparable hotels near the property and
// returns each one with the public page where its nightly rate is published.
// Nothing is invented: a hotel it cannot find a public page for is dropped.

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

// Best model first; the account may not have access to every one of them.
const MODELS = ["gpt-5", "gpt-4.1"];

function extractJson(text: string): unknown {
  const cleaned = (text ?? "").replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* give up */ }
  }
  return null;
}

interface Suggestion { name: string; source_url?: string | null; why?: string | null }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: userRes } = await admin.auth.getUser(token);
    const user = userRes?.user;
    if (!user) return json({ error: "Not signed in" }, 401);

    const { data: allowed } = await admin.rpc("is_revenue_user", { _uid: user.id });
    if (!allowed) return json({ error: "Revenue access is required" }, 403);

    const body = await req.json().catch(() => ({}));
    const hotelId = String(body.hotelId ?? "");
    const count = Math.min(Math.max(Number(body.count ?? 6), 3), 10);
    if (!hotelId) return json({ error: "hotelId is required" }, 400);

    const { data: canAccess } = await admin.rpc("user_can_access_hotel", { _uid: user.id, _hotel_id: hotelId });
    if (canAccess === false) return json({ error: "No access to this hotel" }, 403);

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not configured for this project." }, 500);

    // hotelId may be a UUID (hotels.id) or a slug used in the app routes.
    let hotelName = "";
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hotelId);
    if (isUuid) {
      const { data: hotel } = await admin.from("hotels").select("name").eq("id", hotelId).maybeSingle();
      hotelName = (hotel?.name as string | undefined) ?? "";
    }
    if (!hotelName) {
      const { data: resolved } = await admin.rpc("get_hotel_name_from_id", { _hotel_id: hotelId });
      if (typeof resolved === "string") hotelName = resolved;
    }
    if (!hotelName) return json({ error: `Hotel not found for "${hotelId}"` }, 404);

    const { data: existing } = await admin
      .from("competitor_properties")
      .select("name")
      .eq("hotel_id", hotelId);
    const already = (existing ?? []).map((c) => String(c.name));

    const prompt = [
      `Find ${count} real hotels that directly compete with "${hotelName}".`,
      `Search the web to confirm each hotel exists, is in the same city and district, and sits in a comparable star rating and price bracket.`,
      already.length ? `Do not repeat these, they are already in the set: ${already.join(", ")}.` : "",
      `For each hotel give the public page where its nightly rate for a standard double room is published (its own booking page, or its Booking.com property page).`,
      `Return strict JSON only: {"competitors":[{"name":"...","source_url":"https://...","why":"one short sentence"}]}.`,
      `Only include a hotel when you actually found a working public rate page for it.`,
    ].filter(Boolean).join(" ");

    let suggestions: Suggestion[] = [];
    let lastError = "";

    for (const model of MODELS) {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          tools: [{ type: "web_search_preview", search_context_size: "medium" }],
          max_output_tokens: 6000,
          input: prompt,
        }),
      });

      if (!res.ok) {
        lastError = (await res.text()).slice(0, 400);
        console.error(`competitor-discover: ${model} → ${res.status} ${lastError}`);
        continue;
      }

      const payload = await res.json();
      const text: string = payload.output_text
        ?? (payload.output ?? [])
          .flatMap((o: { content?: { text?: string }[] }) => o.content ?? [])
          .map((p: { text?: string }) => p.text ?? "")
          .join("");

      const parsed = extractJson(text) as { competitors?: Suggestion[] } | null;
      const list = Array.isArray(parsed?.competitors) ? parsed!.competitors : [];
      suggestions = list
        .filter((c) => c && typeof c.name === "string" && c.name.trim())
        .map((c) => ({
          name: c.name.trim().slice(0, 160),
          source_url: typeof c.source_url === "string" && c.source_url.startsWith("http") ? c.source_url : null,
          why: typeof c.why === "string" ? c.why.slice(0, 200) : null,
        }))
        .filter((c) => !already.some((a) => a.toLowerCase() === c.name.toLowerCase()));

      if (suggestions.length) return json({ ok: true, model, suggestions });
      lastError = "The model returned no usable hotels.";
    }

    return json({ error: lastError || "Could not find competitors right now." }, 502);
  } catch (e) {
    console.error("competitor-discover error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
