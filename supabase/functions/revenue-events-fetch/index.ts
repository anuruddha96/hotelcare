import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Missing auth" }, 401);
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ ok: false, error: "LOVABLE_API_KEY not configured" }, 500);

    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userRes } = await userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    if (!userRes?.user) return json({ ok: false, error: "Unauthorized" }, 401);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", userRes.user.id).single();
    if (!profile || !["admin", "top_management"].includes(profile.role)) return json({ ok: false, error: "Forbidden" }, 403);

    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: "You are a Budapest hotel-market analyst. Return real, well-known upcoming events that drive hotel demand: major concerts, festivals, conferences, sports, public holidays, school breaks. Only include events you are confident actually happen. Do not invent." },
          { role: "user", content: `List demand-driving events in Budapest, Hungary between ${today} and ${horizon}. Include: concerts at MVM Dome / Papp László Aréna / Puskás Aréna, Sziget Festival, Budapest Wine Festival, F1 Hungarian GP at Hungaroring, major conferences at Hungexpo, Hungarian public holidays, school breaks. For each, give date (and end_date for multi-day), title, category, venue, expected_impact (low/medium/high), confidence (0-1).` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "list_events",
            description: "Return events list",
            parameters: {
              type: "object",
              properties: {
                events: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      date: { type: "string", description: "YYYY-MM-DD" },
                      end_date: { type: "string" },
                      title: { type: "string" },
                      category: { type: "string", enum: ["concert", "festival", "sport", "conference", "holiday", "other"] },
                      venue: { type: "string" },
                      expected_impact: { type: "string", enum: ["low", "medium", "high"] },
                      url: { type: "string" },
                      confidence: { type: "number" },
                    },
                    required: ["date", "title", "category", "expected_impact"],
                  },
                },
              },
              required: ["events"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "list_events" } },
      }),
    });
    if (!aiResp.ok) {
      const t = await aiResp.text();
      if (aiResp.status === 429) return json({ ok: false, error: "AI rate limit, try again in a minute." }, 200);
      if (aiResp.status === 402) return json({ ok: false, error: "Lovable AI credits exhausted. Add credits in Settings → Workspace → Usage." }, 200);
      console.error("AI error", aiResp.status, t);
      return json({ ok: false, error: `AI error ${aiResp.status}` }, 200);
    }
    const ai = await aiResp.json();
    const args = ai.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let events: any[] = [];
    try { events = JSON.parse(args ?? "{}").events ?? []; } catch { events = []; }

    let added = 0;
    for (const e of events) {
      if (!e?.date || !e?.title) continue;
      const { error } = await supabase.from("market_events").upsert({
        city: "budapest",
        event_date: e.date,
        end_date: e.end_date || null,
        title: String(e.title).slice(0, 200),
        category: e.category || "other",
        venue: e.venue || null,
        expected_impact: e.expected_impact || "medium",
        url: e.url || null,
        source: "ai_suggested",
        confidence: e.confidence ?? null,
      }, { onConflict: "city,event_date,title" });
      if (!error) added++;
    }
    return json({ ok: true, added, total: events.length });
  } catch (e: any) {
    console.error(e);
    return json({ ok: false, error: e?.message ?? String(e) }, 200);
  }
});
