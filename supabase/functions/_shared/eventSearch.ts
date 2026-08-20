// Shared demand-event search.
//
// Used by the on-demand search (a revenue manager pressing "Find events") and
// by the weekly automatic sweep. Keeping one implementation means both paths
// obey the same accuracy rules: the model must read a real source page, dates
// are never estimated, and anything the organisation already has is filtered
// out before it can be offered or saved twice.

/** Comparison key for duplicate detection: accents, case and noise removed. */
export function normTitle(t: string): string {
  return String(t)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(20\d\d)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The model occasionally emits control characters inside names — strip them. */
export function clean(v: unknown, max: number): string {
  return String(v ?? "")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export const isDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));

export interface EventCandidate {
  event_date: string;
  end_date: string | null;
  title: string;
  category: string;
  venue: string | null;
  expected_impact: string;
  recurs_annually: boolean;
  url: string | null;
  confidence: number | null;
  city: string;
  country: string;
}

export interface SearchResult {
  all: EventCandidate[];
  candidates: EventCandidate[];
  duplicates: EventCandidate[];
  error?: string;
}

const instructions = [
  "You are a hotel-market analyst building an events calendar that drives room pricing.",
  "You MUST use the web search tool for every request and read the official event page, the venue's programme page, the city tourism board, or a reputable local listing before reporting an event.",
  "Report the exact published dates. Never estimate, never round a festival to a full week, and never rely on memory.",
  "Include the full range of demand drivers: arena and club concerts, festivals, sport fixtures and races, congresses, trade fairs and exhibitions, public holidays, school holidays, and smaller published local events that still fill hotels.",
  "Every event must include the source URL you read the dates from. If you cannot find a source, leave the event out.",
  "Only include events that take place, at least partly, inside the requested month and city.",
].join(" ");

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

export function monthBounds(month: string): { monthStart: string; monthEnd: string } {
  const monthStart = `${month}-01`;
  const end = new Date(`${monthStart}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return { monthStart, monthEnd: end.toISOString().slice(0, 10) };
}

/**
 * Searches one city/month and classifies the answer against what the
 * organisation already stores. Nothing is written to demand_events here.
 */
export async function searchEvents(opts: {
  // deno-lint-ignore no-explicit-any
  admin: any;
  openaiKey: string;
  organizationSlug: string;
  city: string;
  country: string;
  month: string;
}): Promise<SearchResult> {
  const { admin, openaiKey, organizationSlug, city, country, month } = opts;
  const { monthStart, monthEnd } = monthBounds(month);

  const { data: existing } = await admin
    .from("demand_events")
    .select("title, event_date, end_date, recurs_annually")
    .eq("organization_slug", organizationSlug)
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
      return a1 <= b2 && b1 <= a2;
    });
  };

  const prompt =
    `List demand-driving events in ${city}, ${country} that occur between ${monthStart} and ${monthEnd}. ` +
    `For each event give: date (YYYY-MM-DD first day), end_date (YYYY-MM-DD, only for multi-day events), title, ` +
    `category (concert, festival, sports, conference, fair, holiday, other), venue, expected_impact on hotel demand ` +
    `(low, medium, high), whether it takes place on the same dates every year, the source_url you verified the dates on, ` +
    `and a confidence between 0 and 1. Be thorough, but return at most 25 of the strongest verified demand drivers. ` +
    `Keep titles and venue names concise and use one direct source URL per event.`;

  // deno-lint-ignore no-explicit-any
  const askOpenAI = async (compactRetry = false): Promise<{ events: any[]; error?: string; retryable?: boolean }> => {
    const payload: Record<string, unknown> = {
      model: "gpt-4.1",
      temperature: 0,
      instructions: compactRetry
        ? `${instructions} This is a retry after the previous answer was too long. Return no more than 15 of the highest-impact verified events. Keep every field concise.`
        : instructions,
      input: compactRetry ? `${prompt} Prioritize high and medium impact events and produce compact JSON.` : prompt,
      text: { format: { type: "json_schema", name: "events", strict: true, schema } },
      max_output_tokens: compactRetry ? 10000 : 16000,
      tools: [{ type: "web_search_preview", search_context_size: compactRetry ? "medium" : "high" }],
      tool_choice: "auto",
    };

    const aiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!aiResp.ok) {
      const text = await aiResp.text();
      console.error("openai error", aiResp.status, text.slice(0, 800));
      if (aiResp.status === 429) return { events: [], error: "The event search is rate limited, try again in a minute." };
      if (aiResp.status === 401) return { events: [], error: "The OpenAI key was rejected. Check the key in project settings." };
      return { events: [], error: `Event search failed (${aiResp.status}).` };
    }

    const ai = await aiResp.json();
    if (ai.status === "incomplete") {
      console.error("event response incomplete", JSON.stringify(ai.incomplete_details ?? {}));
      return { events: [], error: "The event search answer was cut off.", retryable: true };
    }
    let raw: string = ai.output_text ?? "";
    if (!raw && Array.isArray(ai.output)) {
      for (const item of ai.output) {
        for (const part of item?.content ?? []) {
          if (typeof part?.text === "string") raw += part.text;
        }
      }
    }
    try {
      return { events: JSON.parse(raw || "{}").events ?? [] };
    } catch (err) {
      console.error("event json parse failed", String(err), `chars=${raw.length}`, raw.slice(-300));
      return { events: [], error: "The event search returned an unreadable answer.", retryable: true };
    }
  };

  let { events, error: aiError, retryable } = await askOpenAI(false);
  if (!events.length && (retryable || !aiError)) {
    const retry = await askOpenAI(true);
    events = retry.events;
    aiError = retry.error;
  }
  if (!events.length && aiError) return { all: [], candidates: [], duplicates: [], error: aiError };

  const seen = new Set<string>();
  const all: EventCandidate[] = events
    // deno-lint-ignore no-explicit-any
    .filter((e: any) => e?.title && isDate(e?.date))
    // deno-lint-ignore no-explicit-any
    .map((e: any) => {
      const event_date = String(e.date);
      const end_date = isDate(e.end_date) && String(e.end_date) >= event_date ? String(e.end_date) : null;
      const url = typeof e.source_url === "string" && /^https?:\/\//.test(e.source_url) ? String(e.source_url).slice(0, 500) : null;
      return {
        event_date,
        end_date,
        title: clean(e.title, 200),
        category: clean(e.category ?? "other", 40) || "other",
        venue: clean(e.venue, 160) || null,
        expected_impact: ["low", "medium", "high"].includes(String(e.expected_impact)) ? String(e.expected_impact) : "medium",
        recurs_annually: !!e.recurs_annually,
        url,
        confidence: Number.isFinite(Number(e.confidence)) ? Number(e.confidence) : null,
        city,
        country,
      } as EventCandidate;
    })
    .filter((c) => c.title.length > 1 && c.event_date >= monthStart && c.event_date <= monthEnd)
    .filter((c) => {
      const key = `${normTitle(c.title)}|${c.event_date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.event_date.localeCompare(b.event_date));

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

  return {
    all,
    duplicates: all.filter((c) => isKnown(c.title, c.event_date, c.end_date)),
    candidates: all.filter((c) => !isKnown(c.title, c.event_date, c.end_date)),
  };
}
