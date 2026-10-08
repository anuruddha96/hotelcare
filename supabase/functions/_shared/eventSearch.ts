// Shared demand-event search.
//
// Used by the on-demand search (a revenue manager pressing "Find events") and
// by the weekly automatic sweep. Keeping one implementation means both paths
// obey the same accuracy rules: the model must read a real source page, dates
// are never estimated, and anything the shared city/country market already has
// is filtered out before it can be offered or saved twice.

import { logAiUsage } from "./aiBudget.ts";


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

const EVENT_GENERIC_TOKENS = new Set([
  "concert", "concerts", "event", "events", "performance", "performances",
  "festival", "fest", "international", "cultural", "show", "shows",
  "vs", "versus", "and", "the", "at", "in", "of",
]);

function normalizedEventText(value: unknown): string {
  return clean(value, 300)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "s")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b(?:unnep|dcnnep)\b/g, " festival ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function eventIdentityTitle(value: unknown): string {
  const base = normalizedEventText(value);
  if (!base) return "";

  if (/^liszt\b/.test(base) && /\b(?:festival|fest)\b/.test(base)) return "liszt";
  if (/^spar budapest marathon\b/.test(base)) return "budapest marathon spar";
  if (/^all saints day\b/.test(base)) return "all saints day";
  if (/^boxing day\b/.test(base)) return "boxing day";
  if (/^st nicholas day\b/.test(base)) return "nicholas saint day";
  if (/^new year s eve celebrations?\b/.test(base) || /^new years eve celebrations?\b/.test(base)) {
    return "celebrations eve new years";
  }

  const tokens = base
    .split(" ")
    .filter(Boolean)
    .filter((token) => !EVENT_GENERIC_TOKENS.has(token));
  return [...new Set(tokens)].sort().join(" ");
}

function tokenJaccard(a: string, b: string): number {
  const aa = new Set(a.split(" ").filter(Boolean));
  const bb = new Set(b.split(" ").filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection += 1;
  return intersection / (aa.size + bb.size - intersection);
}

function bigramDice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const counts = (value: string) => {
    const out = new Map<string, number>();
    const compact = value.replace(/\s+/g, " ").trim();
    if (compact.length < 2) {
      if (compact) out.set(compact, 1);
      return out;
    }
    for (let i = 0; i < compact.length - 1; i += 1) {
      const gram = compact.slice(i, i + 2);
      out.set(gram, (out.get(gram) ?? 0) + 1);
    }
    return out;
  };
  const aa = counts(a);
  const bb = counts(b);
  let overlap = 0;
  let aCount = 0;
  let bCount = 0;
  for (const count of aa.values()) aCount += count;
  for (const count of bb.values()) bCount += count;
  for (const [gram, count] of aa) overlap += Math.min(count, bb.get(gram) ?? 0);
  return (2 * overlap) / Math.max(1, aCount + bCount);
}

function titleSimilarity(a: unknown, b: unknown): number {
  const aBase = normalizedEventText(a);
  const bBase = normalizedEventText(b);
  if (!aBase || !bBase) return 0;
  const aKey = eventIdentityTitle(a);
  const bKey = eventIdentityTitle(b);
  if (aKey && aKey === bKey) return 1;
  return Math.max(tokenJaccard(aKey, bKey), bigramDice(aBase, bBase));
}

function eventSourceKey(value: unknown): string {
  const normalized = normalizeSourceUrl(value);
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    parsed.hash = "";
    parsed.search = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${path.toLowerCase()}`;
  } catch {
    return normalized.toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function venueSimilarity(a: unknown, b: unknown): number {
  const aa = normalizedEventText(a);
  const bb = normalizedEventText(b);
  if (!aa && !bb) return 1;
  if (!aa || !bb) return 0;
  if (aa === bb || aa.includes(bb) || bb.includes(aa)) return 1;
  return Math.max(tokenJaccard(aa, bb), bigramDice(aa, bb));
}

function specialIdentity(key: string): boolean {
  return [
    "liszt",
    "budapest marathon spar",
    "all saints day",
    "boxing day",
    "nicholas saint day",
    "celebrations eve new years",
  ].includes(key);
}

function sameEventCandidate(
  a: { title: string; event_date: string; end_date: string | null; venue?: string | null; url?: string | null; category?: string | null },
  b: { title: string; event_date: string; end_date: string | null; venue?: string | null; url?: string | null; category?: string | null },
): boolean {
  const aEnd = a.end_date ?? a.event_date;
  const bEnd = b.end_date ?? b.event_date;
  if (!(a.event_date <= bEnd && b.event_date <= aEnd)) return false;

  const aKey = eventIdentityTitle(a.title);
  const bKey = eventIdentityTitle(b.title);
  if (!aKey || !bKey) return false;

  const similarity = titleSimilarity(a.title, b.title);
  const sameSource = !!eventSourceKey(a.url) && eventSourceKey(a.url) === eventSourceKey(b.url);
  const venueMatch = venueSimilarity(a.venue, b.venue);
  const exactRange = a.event_date === b.event_date && aEnd === bEnd;
  const sameCategory = String(a.category ?? "").toLowerCase() === String(b.category ?? "").toLowerCase();

  if (aKey === bKey) {
    if (specialIdentity(aKey)) return true;
    if (sameSource || venueMatch >= 0.45) return true;
    if (exactRange && ["holiday", "sports", "sport"].includes(String(a.category ?? "").toLowerCase())) return true;
  }
  if (similarity >= 0.84 && (sameSource || venueMatch >= 0.45 || sameCategory)) return true;
  if (exactRange && sameSource && venueMatch >= 0.55 && similarity >= 0.42) return true;
  if (exactRange && venueMatch >= 0.78 && similarity >= 0.68) return true;
  return false;
}

const LOW_TRUST_SOURCE_HOSTS = new Set([
  "10times.com",
  "www.10times.com",
  "tripsapien.com",
  "www.tripsapien.com",
  "wikipedia.org",
  "en.wikipedia.org",
  "de.wikipedia.org",
  "festivalfinder.eu",
  "www.festivalfinder.eu",
  "europaticket.com",
  "www.europaticket.com",
  "ticket-budapest.com",
  "www.ticket-budapest.com",
  "carnifest.com",
  "www.carnifest.com",
  "budapestopera-tickets.com",
  "www.budapestopera-tickets.com",
]);

export function isLowTrustEventSource(value: unknown): boolean {
  const normalized = normalizeSourceUrl(value);
  if (!normalized) return true;
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    return LOW_TRUST_SOURCE_HOSTS.has(host);
  } catch {
    return true;
  }
}

/** Only real, navigable web URLs may become demand-event sources. */
export function normalizeSourceUrl(value: unknown): string | null {
  const raw = clean(value, 500);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase();
    if (
      !host.includes(".")
      || host === "localhost"
      || host === "example.com"
      || host.endsWith(".example.com")
      || host.endsWith(".invalid")
      || host.endsWith(".local")
    ) return null;
    parsed.hash = "";
    return parsed.toString().slice(0, 500);
  } catch {
    return null;
  }
}

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
  "Every event must include the exact source URL you actually opened in web search and used to verify its dates. Never invent, reconstruct, shorten, or guess a URL. If you cannot provide that exact source URL, leave the event out.",
  "The final source MUST be an official organiser, official venue, governing body, government/public authority, or official tourism-board page. Aggregators, Wikipedia, generic event directories, travel blogs and ticket resellers may be used only to discover the official page and must never be returned as the final source.",
  "Verify the physical event location. Do not report an event merely because a search result mentions the requested city. Return the actual venue city and country from the source.",
  "An event outside the requested city may be included only when it is in the same country, within roughly 50 km of the requested market, and clearly drives hotel demand in that market (for example Formula 1 at a nearby circuit). Otherwise omit it.",
  "For high-impact events, cross-check the exact dates against the official organizer, venue or governing body. If sources conflict, omit the event rather than guessing.",
  "Only include events that take place, at least partly, inside the requested month and requested hotel market.",
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
          source_type: { type: "string", enum: ["official_organizer", "official_venue", "governing_body", "government", "tourism_board"] },
          venue_city: { type: "string" },
          venue_country: { type: "string" },
          market_relevant: { type: "boolean" },
          distance_from_market_km: { type: ["number", "null"] },
          confidence: { type: "number" },
        },
        required: ["date", "end_date", "title", "category", "venue", "expected_impact", "recurs_annually", "source_url", "source_type", "venue_city", "venue_country", "market_relevant", "distance_from_market_km", "confidence"],
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
 * Searches one city/month and classifies the answer against what the shared
 * market pool already stores. Nothing is written to demand_events here.
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
    .select("title, event_date, end_date, recurs_annually, url, approved, venue, category")
    .ilike("city", city)
    .ilike("country", country)
    .limit(5000);

  const known = (existing ?? []) as Array<{
    title: string;
    event_date: string;
    end_date: string | null;
    recurs_annually: boolean;
    url: string | null;
    approved: boolean;
    venue: string | null;
    category: string | null;
  }>;

  /**
   * Compare a verified candidate with the approved market pool. Sharing one
   * monthly listing URL is never enough by itself: the title, date and venue
   * still need to describe the same real event.
   */
  const isKnown = (candidate: EventCandidate) => known.some((k) => {
    if (!k.approved || !normalizeSourceUrl(k.url)) return false;
    if (k.recurs_annually && k.event_date.slice(5, 7) !== candidate.event_date.slice(5, 7)) return false;
    return sameEventCandidate(
      {
        title: k.title,
        event_date: k.event_date,
        end_date: k.end_date,
        venue: k.venue,
        url: k.url,
        category: k.category,
      },
      candidate,
    );
  });

  const prompt =
    `List demand-driving events in ${city}, ${country} that occur between ${monthStart} and ${monthEnd}. ` +
    `For each event give: date (YYYY-MM-DD first day), end_date (YYYY-MM-DD, only for multi-day events), title, ` +
    `category (concert, festival, sports, conference, fair, holiday, other), venue, expected_impact on hotel demand ` +
    `(low, medium, high), whether it takes place on the same dates every year, the source_url you verified the dates on, ` +
    `source_type (official_organizer, official_venue, governing_body, government, tourism_board), actual venue_city, actual venue_country, ` +
    `whether the event is relevant to the requested hotel market, approximate distance_from_market_km (0 when inside the city), ` +
    `and a confidence between 0 and 1. Be conservative: omit anything whose date, location or official source cannot be verified. ` +
    `Return at most 25 of the strongest verified demand drivers. Keep titles and venue names concise and use one direct official source URL per event.`;

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
      // "high" search context roughly triples the bill for a handful of extra
      // events, so both the first attempt and the retry stay on "medium".
      tools: [{ type: "web_search_preview", search_context_size: compactRetry ? "low" : "medium" }],
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
    await logAiUsage(admin, {
      organizationSlug,
      functionName: "event-search",
      model: String(payload.model ?? ""),
      inputTokens: Number(ai?.usage?.input_tokens ?? 0),
      outputTokens: Number(ai?.usage?.output_tokens ?? 0),
      webSearches: 1,
      searchContext: compactRetry ? "low" : "medium",
    });
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
  // Retry only when the answer was unusable. "No events found" is a real
  // answer, and re-asking it paid for a second web search every time.
  if (!events.length && retryable) {
    const retry = await askOpenAI(true);
    events = retry.events;
    aiError = retry.error;
  }
  if (!events.length && aiError) return { all: [], candidates: [], duplicates: [], error: aiError };

  const seenVerified: EventCandidate[] = [];
  const verified = events
    // deno-lint-ignore no-explicit-any
    .filter((e: any) => e?.title && isDate(e?.date))
    // deno-lint-ignore no-explicit-any
    .map((e: any) => {
      const event_date = String(e.date);
      const end_date = isDate(e.end_date) && String(e.end_date) >= event_date ? String(e.end_date) : null;
      const url = normalizeSourceUrl(e.source_url);
      const sourceType = String(e.source_type ?? "");
      const venueCity = clean(e.venue_city, 120);
      const venueCountry = clean(e.venue_country, 120);
      const distanceKm = Number.isFinite(Number(e.distance_from_market_km)) ? Number(e.distance_from_market_km) : null;
      const sameCity = venueCity.toLowerCase() === city.trim().toLowerCase();
      const sameCountry = venueCountry.toLowerCase() === country.trim().toLowerCase();
      const officialSource = ["official_organizer", "official_venue", "governing_body", "government", "tourism_board"].includes(sourceType);
      const locationAccepted = sameCountry && (
        sameCity
        || (e.market_relevant === true && distanceKm !== null && distanceKm >= 0 && distanceKm <= 50)
      );
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
        _verified_source: officialSource && !isLowTrustEventSource(url),
        _verified_location: locationAccepted,
      } as EventCandidate & { _verified_source: boolean; _verified_location: boolean };
    })
    .filter((c) => c.title.length > 1 && c.event_date >= monthStart && c.event_date <= monthEnd)
    // No official source or verified market location means no live event.
    // This deliberately favors a smaller, trustworthy pricing calendar.
    .filter((candidate) =>
      candidate.url !== null
      && candidate._verified_source === true
      && candidate._verified_location === true
      && (candidate.confidence ?? 0) >= 0.8
    )
    .filter((candidate) => {
      if (seenVerified.some((existing) => sameEventCandidate(existing, candidate))) return false;
      seenVerified.push(candidate);
      return true;
    })
    .sort((a, b) => a.event_date.localeCompare(b.event_date));

  const all: EventCandidate[] = verified.map(({ _verified_source, _verified_location, ...candidate }) => candidate);

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
    duplicates: all.filter((candidate) => isKnown(candidate)),
    candidates: all.filter((candidate) => !isKnown(candidate)),
  };
}
