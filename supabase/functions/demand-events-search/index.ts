// Finds demand-driving events for a city and month. It only RETURNS candidates:
// nothing is written to the database and nothing reaches pricing until a
// revenue manager approves the rows in the app.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Missing auth" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) return json({ ok: false, error: "OPENAI_API_KEY is not configured" }, 200);

    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userRes } = await userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    if (!userRes?.user) return json({ ok: false, error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: profile } = await admin
      .from("profiles").select("role, organization_slug").eq("id", userRes.user.id).maybeSingle();
    if (!profile || !["admin", "top_management", "top_management_manager"].includes(String(profile.role))) {
      return json({ ok: false, error: "Only administrators and top management can search for events." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const city = String(body.city ?? "Budapest").slice(0, 80);
    const country = String(body.country ?? "Hungary").slice(0, 80);
    const month = /^\d{4}-\d{2}$/.test(String(body.month ?? ""))
      ? String(body.month)
      : new Date().toISOString().slice(0, 7);

    const monthStart = `${month}-01`;
    const end = new Date(`${monthStart}T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    const monthEnd = end.toISOString().slice(0, 10);

    const aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a hotel-market analyst. Return only real, well-known events that drive hotel demand in the requested city: major concerts, festivals, sports events, trade fairs and conferences, public holidays and school breaks. Never invent an event. If you are unsure an event happens on those dates, lower its confidence or leave it out. Mark events that take place on the same dates every year as recurring.",
          },
          {
            role: "user",
            content:
              `List demand-driving events in ${city}, ${country} between ${monthStart} and ${monthEnd}. For each: date (YYYY-MM-DD), end_date when multi-day, title, category, venue, expected_impact (low/medium/high), whether it recurs annually, and a confidence between 0 and 1.`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "list_events",
            description: "Return the events found",
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
                      category: {
                        type: "string",
                        enum: ["concert", "festival", "sports", "conference", "fair", "holiday", "other"],
                      },
                      venue: { type: "string" },
                      expected_impact: { type: "string", enum: ["low", "medium", "high"] },
                      recurs_annually: { type: "boolean" },
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
      const text = await aiResp.text();
      console.error("openai error", aiResp.status, text.slice(0, 500));
      if (aiResp.status === 429) return json({ ok: false, error: "The event search is rate limited, try again in a minute." }, 200);
      if (aiResp.status === 401) return json({ ok: false, error: "The OpenAI key was rejected. Check the key in project settings." }, 200);
      return json({ ok: false, error: `Event search failed (${aiResp.status}).` }, 200);
    }

    const ai = await aiResp.json();
    const args = ai.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let events: any[] = [];
    try { events = JSON.parse(args ?? "{}").events ?? []; } catch { events = []; }

    const candidates = events
      .filter((e) => e?.date && e?.title && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date)))
      .map((e) => ({
        event_date: String(e.date),
        end_date: /^\d{4}-\d{2}-\d{2}$/.test(String(e.end_date ?? "")) ? String(e.end_date) : null,
        title: String(e.title).slice(0, 200),
        category: String(e.category ?? "other"),
        venue: e.venue ? String(e.venue).slice(0, 160) : null,
        expected_impact: ["low", "medium", "high"].includes(String(e.expected_impact))
          ? String(e.expected_impact) : "medium",
        recurs_annually: !!e.recurs_annually,
        url: e.url ? String(e.url).slice(0, 400) : null,
        confidence: Number.isFinite(Number(e.confidence)) ? Number(e.confidence) : null,
        city,
        country,
      }));

    // Cache the raw suggestions so repeated searches are cheap to audit.
    for (const c of candidates) {
      await admin.from("market_events").upsert({
        city: city.toLowerCase(),
        event_date: c.event_date,
        end_date: c.end_date,
        title: c.title,
        category: c.category,
        venue: c.venue,
        expected_impact: c.expected_impact,
        url: c.url,
        source: "ai_suggested",
        confidence: c.confidence,
      }, { onConflict: "city,event_date,title" });
    }

    return json({ ok: true, month, city, country, candidates });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: (e as Error)?.message ?? "Unexpected error" }, 200);
  }
});
