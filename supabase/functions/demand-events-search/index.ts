// Finds demand-driving events for a city and month.
//
// Accuracy rules that matter here:
//  • The model MUST search the web — dates recalled from memory were wrong
//    (Sziget 2026 came back as 11–17 Aug instead of 11–15 Aug), so every
//    candidate has to carry the source page it was read from.
//  • Temperature 0 and a fixed prompt, so searching the same month twice
//    returns the same list.
//  • Anything already saved for this organisation is filtered out server-side,
//    so a duplicate can never be offered (or added) a second time.
//
// It only RETURNS candidates: nothing reaches pricing until a revenue manager
// approves the rows in the app.

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

/** Comparison key for duplicate detection: accents, case and noise removed. */
function normTitle(t: string): string {
  return String(t)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(20\d\d)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The model occasionally emits control characters inside names — strip them. */
function clean(v: unknown, max: number): string {
  return String(v ?? "")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const isDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));


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

    // What this organisation already has, so duplicates are never offered.
    const { data: existing } = await admin
      .from("demand_events")
      .select("title, event_date, end_date, recurs_annually")
      .eq("organization_slug", String(profile.organization_slug ?? ""))
      .limit(2000);

    const known = (existing ?? []) as Array<{ title: string; event_date: string; end_date: string | null; recurs_annually: boolean }>;

    /** Same event when the titles match and the date ranges touch (or it recurs in the same month/day). */
    const isKnown = (title: string, from: string, to: string | null) => {
      const key = normTitle(title);
      const a1 = from, a2 = to ?? from;
      return known.some((k) => {
        if (normTitle(k.title) !== key) return false;
        if (k.recurs_annually) return k.event_date.slice(5, 7) === from.slice(5, 7);
        const b1 = k.event_date, b2 = k.end_date ?? k.event_date;
        return a1 <= b2 && b1 <= a2; // overlapping ranges = the same event
      });
    };

    const instructions = [
      "You are a hotel-market analyst building an events calendar that drives room pricing.",
      "You MUST use the web search tool for every request and read the official event page, the venue's programme page, the city tourism board, or a reputable local listing before reporting an event.",
      "Report the exact published dates. Never estimate, never round a festival to a full week, and never rely on memory.",
      "Include the full range of demand drivers: arena and club concerts, festivals, sport fixtures and races, congresses, trade fairs and exhibitions, public holidays, school holidays, and smaller published local events that still fill hotels.",
      "Every event must include the source URL you read the dates from. If you cannot find a source, leave the event out.",
      "Only include events that take place, at least partly, inside the requested month and city.",
    ].join(" ");

    const prompt =
      `List demand-driving events in ${city}, ${country} that occur between ${monthStart} and ${monthEnd}. ` +
      `For each event give: date (YYYY-MM-DD first day), end_date (YYYY-MM-DD, only for multi-day events), title, ` +
      `category (concert, festival, sports, conference, fair, holiday, other), venue, expected_impact on hotel demand ` +
      `(low, medium, high), whether it takes place on the same dates every year, the source_url you verified the dates on, ` +
      `and a confidence between 0 and 1. Be thorough: include small and mid-size published events too.`;

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        events: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              date: { type: "string" },
              end_date: { type: ["string", "null"] },
              title: { type: "string" },
              category: { type: "string", enum: ["concert", "festival", "sports", "conference", "fair", "holiday", "other"] },
              venue: { type: ["string", "null"] },
              expected_impact: { type: "string", enum: ["low", "medium", "high"] },
              recurs_annually: { type: "boolean" },
              source_url: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["date", "end_date", "title", "category", "venue", "expected_impact", "recurs_annually", "source_url", "confidence"],
          },
        },
      },
      required: ["events"],
    };

    const aiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1",
        temperature: 0,
        instructions,
        input: prompt,
        tools: [{ type: "web_search_preview", search_context_size: "high" }],
        tool_choice: "auto",
        text: {
          format: { type: "json_schema", name: "events", strict: true, schema },
        },
      }),
    });

    if (!aiResp.ok) {
      const text = await aiResp.text();
      console.error("openai error", aiResp.status, text.slice(0, 800));
      if (aiResp.status === 429) return json({ ok: false, error: "The event search is rate limited, try again in a minute." }, 200);
      if (aiResp.status === 401) return json({ ok: false, error: "The OpenAI key was rejected. Check the key in project settings." }, 200);
      return json({ ok: false, error: `Event search failed (${aiResp.status}).` }, 200);
    }

    const ai = await aiResp.json();
    // Responses API: prefer output_text, fall back to walking the output items.
    let raw: string = ai.output_text ?? "";
    if (!raw && Array.isArray(ai.output)) {
      for (const item of ai.output) {
        for (const part of item?.content ?? []) {
          if (typeof part?.text === "string") raw += part.text;
        }
      }
    }
    let events: any[] = [];
    try { events = JSON.parse(raw || "{}").events ?? []; } catch { events = []; }

    const seen = new Set<string>();
    const all = events
      .filter((e) => e?.title && isDate(e?.date) && typeof e?.source_url === "string" && /^https?:\/\//.test(e.source_url))
      .map((e) => {
        const event_date = String(e.date);
        const end_date = isDate(e.end_date) && String(e.end_date) >= event_date ? String(e.end_date) : null;
        return {
          event_date,
          end_date,
          title: String(e.title).slice(0, 200),
          category: String(e.category ?? "other"),
          venue: e.venue ? String(e.venue).slice(0, 160) : null,
          expected_impact: ["low", "medium", "high"].includes(String(e.expected_impact)) ? String(e.expected_impact) : "medium",
          recurs_annually: !!e.recurs_annually,
          url: String(e.source_url).slice(0, 500),
          confidence: Number.isFinite(Number(e.confidence)) ? Number(e.confidence) : null,
          city,
          country,
        };
      })
      // Drop repeats inside the AI's own answer.
      .filter((c) => {
        const key = `${normTitle(c.title)}|${c.event_date}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.event_date.localeCompare(b.event_date));

    const duplicates = all.filter((c) => isKnown(c.title, c.event_date, c.end_date));
    const candidates = all.filter((c) => !isKnown(c.title, c.event_date, c.end_date));

    // Cache the raw suggestions so repeated searches are cheap to audit.
    for (const c of all) {
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

    return json({
      ok: true,
      month,
      city,
      country,
      candidates,
      duplicates: duplicates.map((d) => ({ title: d.title, event_date: d.event_date })),
    });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: (e as Error)?.message ?? "Unexpected error" }, 200);
  }
});
