// Translates PMS room-type names (often Czech/Hungarian, straight from
// Previo) into every language the app supports, using the hotel's own OpenAI
// key. Results are cached on room_types.name_translations so the grid never
// pays for a translation twice.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const LANGS = ["en", "hu", "es", "vi", "mn", "az", "tl", "uk", "ru"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const hotelId = typeof body.hotelId === "string" ? body.hotelId : null;
    const force = body.force === true;
    if (!hotelId) {
      return new Response(JSON.stringify({ error: "hotelId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: types, error } = await supabase
      .from("room_types")
      .select("id, name, name_translations")
      .eq("hotel_id", hotelId);
    if (error) throw error;

    const pending = (types ?? []).filter((t: any) => {
      if (force) return true;
      const tr = t.name_translations ?? {};
      return LANGS.some((l) => !tr[l]);
    });
    if (pending.length === 0) {
      return new Response(JSON.stringify({ ok: true, translated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = [
      "You translate hotel room-type names for a hotel operations app.",
      `Translate each name into these language codes: ${LANGS.join(", ")}.`,
      "Keep them short (max 5 words), natural for hotel staff, no quotes.",
      "Respond ONLY with JSON: { \"results\": [ { \"name\": <original>, \"translations\": { \"en\": \"…\", … } } ] }",
      "",
      "Names:",
      ...pending.map((t: any) => `- ${t.name}`),
    ].join("\n");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error(`OpenAI request failed [${res.status}]: ${detail}`);
      return new Response(JSON.stringify({ error: "Translation failed", status: res.status, details: detail }), {
        status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await res.json();
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content ?? "{}");
    const results: Array<{ name: string; translations: Record<string, string> }> = parsed.results ?? [];

    let updated = 0;
    for (const t of pending as any[]) {
      const match = results.find((r) => r.name?.trim() === t.name?.trim());
      if (!match) continue;
      const merged = { ...(t.name_translations ?? {}), ...match.translations };
      const { error: upErr } = await supabase
        .from("room_types")
        .update({ name_translations: merged })
        .eq("id", t.id);
      if (upErr) { console.error("update failed", upErr); continue; }
      updated += 1;
    }

    return new Response(JSON.stringify({ ok: true, translated: updated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
