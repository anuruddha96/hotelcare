export interface RevenueEventBandInput {
  title: string;
  impact: string;
  category?: string | null;
  venue?: string | null;
  url?: string | null;
  notes?: string | null;
  start?: string;
  end?: string;
  source?: string | null;
  confidence?: number | null;
}

export interface RevenueEventBand<T extends RevenueEventBandInput = RevenueEventBandInput> {
  key: string;
  event: T;
  startDate: string;
  endDate: string;
  startIndex: number;
  endIndex: number;
  lane: number;
  score: number;
}

/** Number of visible date columns covered by one continuous event pill. */
export function revenueEventBandColumnSpan(
  band: Pick<RevenueEventBand, "startIndex" | "endIndex">,
): number {
  return Math.max(1, band.endIndex - band.startIndex + 1);
}

export interface RevenueSingleDayEventSlot {
  topLane: number;
  heightLanes: number;
}

/**
 * Share the vertical lanes that are not occupied by multi-day pills between
 * single-day events on one date. Empty contiguous gaps are used in full, and
 * single-day cards split a gap evenly when several of them share it.
 *
 * This keeps long events as stable one-lane horizontal bars while allowing
 * short events to become taller and show more useful detail.
 */
export function allocateRevenueSingleDayEventSlots(
  laneCount: number,
  occupiedLanes: readonly number[],
  itemCount: number,
): RevenueSingleDayEventSlot[] {
  const lanes = Math.max(0, Math.floor(laneCount));
  const wanted = Math.max(0, Math.floor(itemCount));
  if (lanes === 0 || wanted === 0) return [];

  const occupied = new Set(
    occupiedLanes
      .map((lane) => Math.floor(lane))
      .filter((lane) => lane >= 0 && lane < lanes),
  );

  const segments: Array<{ start: number; length: number; count: number }> = [];
  let start = -1;
  for (let lane = 0; lane <= lanes; lane += 1) {
    const free = lane < lanes && !occupied.has(lane);
    if (free && start < 0) start = lane;
    if ((!free || lane === lanes) && start >= 0) {
      segments.push({ start, length: lane - start, count: 0 });
      start = -1;
    }
  }

  const totalFree = segments.reduce((sum, segment) => sum + segment.length, 0);
  const count = Math.min(wanted, totalFree);
  if (count === 0) return [];

  // First spread one event into the largest available gaps so isolated empty
  // areas do not remain wasted when there are fewer events than gaps.
  const bySize = [...segments].sort((a, b) => b.length - a.length || a.start - b.start);
  let remaining = count;
  for (const segment of bySize) {
    if (remaining <= 0) break;
    segment.count = 1;
    remaining -= 1;
  }

  // Then balance extra events into the gap that would still give the largest
  // per-event height after adding one more card.
  while (remaining > 0) {
    const target = segments
      .filter((segment) => segment.count > 0 && segment.count < segment.length)
      .sort((a, b) =>
        (b.length / (b.count + 1)) - (a.length / (a.count + 1))
        || a.start - b.start
      )[0];
    if (!target) break;
    target.count += 1;
    remaining -= 1;
  }

  const slots: RevenueSingleDayEventSlot[] = [];
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    if (segment.count <= 0) continue;
    const height = segment.length / segment.count;
    for (let i = 0; i < segment.count; i += 1) {
      slots.push({
        topLane: segment.start + i * height,
        heightLanes: height,
      });
    }
  }

  return slots.slice(0, count);
}

const IMPACT_WEIGHT: Record<string, number> = {
  high: 300,
  medium: 200,
  low: 100,
};

const CATEGORY_WEIGHT: Record<string, number> = {
  conference: 35,
  sport: 32,
  sports: 32,
  concert: 30,
  festival: 28,
  fair: 26,
  holiday: 24,
  other: 10,
};

const GENERIC_TITLE_TOKENS = new Set([
  "concert", "concerts", "event", "events", "performance", "performances",
  "festival", "fest", "international", "cultural", "show", "shows",
  "vs", "versus", "and", "the", "at", "in", "of",
]);

function isoDate(value?: string | null): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value ?? "");
  return match?.[1] ?? null;
}

function normalizedText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "s")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    // "ünnep" means festival; legacy event imports also contain the corrupted
    // "dcnnep" spelling. Treat both as the same harmless descriptor.
    .replace(/\b(?:unnep|dcnnep)\b/g, " festival ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stable, order-insensitive event identity used by both the grid and manual
 * duplicate checks. Generic marketing words are removed, while the meaningful
 * names remain. A few well-known calendar labels get explicit aliases so
 * translated/localised variants do not consume separate pricing lanes.
 */
export function revenueEventTitleKey(value: unknown): string {
  const base = normalizedText(value);
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
    .filter((token) => !GENERIC_TITLE_TOKENS.has(token));

  return [...new Set(tokens)].sort().join(" ");
}

function tokenSet(value: unknown): Set<string> {
  return new Set(revenueEventTitleKey(value).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function bigrams(value: string): Map<string, number> {
  const compact = value.replace(/\s+/g, " ").trim();
  const out = new Map<string, number>();
  if (compact.length < 2) {
    if (compact) out.set(compact, 1);
    return out;
  }
  for (let i = 0; i < compact.length - 1; i += 1) {
    const gram = compact.slice(i, i + 2);
    out.set(gram, (out.get(gram) ?? 0) + 1);
  }
  return out;
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aa = bigrams(a);
  const bb = bigrams(b);
  let overlap = 0;
  let aCount = 0;
  let bCount = 0;
  for (const count of aa.values()) aCount += count;
  for (const count of bb.values()) bCount += count;
  for (const [gram, count] of aa) overlap += Math.min(count, bb.get(gram) ?? 0);
  return (2 * overlap) / Math.max(1, aCount + bCount);
}

export function revenueEventTitleSimilarity(a: unknown, b: unknown): number {
  const aBase = normalizedText(a);
  const bBase = normalizedText(b);
  if (!aBase || !bBase) return 0;
  if (revenueEventTitleKey(a) === revenueEventTitleKey(b)) return 1;
  return Math.max(
    jaccard(tokenSet(a), tokenSet(b)),
    dice(aBase, bBase),
  );
}

function sourceKey(value?: string | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${path.toLowerCase()}`;
  } catch {
    return raw.toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function venueSimilarity(a?: string | null, b?: string | null): number {
  const aa = normalizedText(a);
  const bb = normalizedText(b);
  if (!aa || !bb) return 0;
  if (aa === bb || aa.includes(bb) || bb.includes(aa)) return 1;
  return Math.max(jaccard(new Set(aa.split(" ")), new Set(bb.split(" "))), dice(aa, bb));
}

function eventRange(event: RevenueEventBandInput): { start: string; end: string } | null {
  const start = isoDate(event.start);
  if (!start) return null;
  const end = isoDate(event.end) ?? start;
  return start <= end ? { start, end } : { start: end, end: start };
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

/**
 * Conservative semantic duplicate matcher.
 *
 * It never treats a shared directory/source URL alone as proof of a duplicate:
 * multiple real events can legitimately come from the same venue/calendar
 * page. Names must still match closely, and the date ranges must overlap.
 */
export function sameRevenueEvent(
  a: RevenueEventBandInput,
  b: RevenueEventBandInput,
): boolean {
  const aRange = eventRange(a);
  const bRange = eventRange(b);
  if (!aRange || !bRange) return false;
  const overlaps = aRange.start <= bRange.end && bRange.start <= aRange.end;
  if (!overlaps) return false;

  const aKey = revenueEventTitleKey(a.title);
  const bKey = revenueEventTitleKey(b.title);
  if (!aKey || !bKey) return false;

  const titleSimilarity = revenueEventTitleSimilarity(a.title, b.title);
  const sameSource = !!sourceKey(a.url) && sourceKey(a.url) === sourceKey(b.url);
  const venueMatch = venueSimilarity(a.venue, b.venue);
  const exactRange = aRange.start === bRange.start && aRange.end === bRange.end;
  if (aKey === bKey) {
    if (exactRange || specialIdentity(aKey)) return true;
    if (sameSource || venueMatch >= 0.45) return true;
    if (exactRange && ["holiday", "sports", "sport"].includes(String(a.category ?? "").toLowerCase())) return true;
  }

  if (titleSimilarity >= 0.84 && (sameSource || venueMatch >= 0.45)) return true;

  // Same specific page + same date/venue can safely tolerate OCR/encoding
  // damage, but the title still has to retain a meaningful resemblance. This
  // prevents a generic monthly listing from collapsing unrelated concerts.
  if (exactRange && sameSource && venueMatch >= 0.55 && titleSimilarity >= 0.42) return true;

  if (exactRange && venueMatch >= 0.78 && titleSimilarity >= 0.68) return true;

  return false;
}

export function scoreRevenueEvent(event: RevenueEventBandInput): number {
  const impact = IMPACT_WEIGHT[String(event.impact || "").toLowerCase()] ?? 0;
  const category = CATEGORY_WEIGHT[String(event.category || "other").toLowerCase()] ?? 10;
  const evidence = (event.venue ? 4 : 0) + (event.url ? 3 : 0) + (event.notes ? 1 : 0);
  return impact + category + evidence;
}

function displayQuality(event: RevenueEventBandInput): number {
  const source = String(event.source ?? "").toLowerCase();
  const sourceBonus = source === "manual" ? 40 : source === "verified_official" ? 35 : source === "ai_auto" ? 4 : 0;
  const confidence = Number.isFinite(Number(event.confidence)) ? Number(event.confidence) * 8 : 0;
  const garbledPenalty = /[a-z]\d|\d[a-z]/i.test(event.title) ? 18 : 0;
  const lengthPenalty = Math.max(0, event.title.length - 60) * 0.05;
  return scoreRevenueEvent(event) + sourceBonus + confidence - garbledPenalty - lengthPenalty;
}

/**
 * Build at most `maxLanes` continuous event bars over the visible date
 * columns. Semantic duplicates are collapsed before lane allocation so a typo,
 * translated label or second discovery source never steals a lane from another
 * real demand driver.
 */
export function buildRevenueEventBands<T extends RevenueEventBandInput>(
  dates: readonly string[],
  eventsByDate?: ReadonlyMap<string, readonly T[]>,
  maxLanes = 5,
): RevenueEventBand<T>[] {
  if (dates.length === 0 || !eventsByDate || maxLanes <= 0) return [];

  const firstVisible = dates[0];
  const lastVisible = dates[dates.length - 1];
  const candidates: Array<Omit<RevenueEventBand<T>, "lane">> = [];

  for (const [bucketDate, events] of eventsByDate) {
    for (const event of events) {
      const rawStart = isoDate(event.start) ?? isoDate(bucketDate) ?? bucketDate;
      const rawEnd = isoDate(event.end) ?? rawStart;
      const startDate = rawStart <= rawEnd ? rawStart : rawEnd;
      const endDate = rawStart <= rawEnd ? rawEnd : rawStart;
      if (endDate < firstVisible || startDate > lastVisible) continue;

      let startIndex = -1;
      let endIndex = -1;
      for (let i = 0; i < dates.length; i += 1) {
        if (dates[i] < startDate || dates[i] > endDate) continue;
        if (startIndex < 0) startIndex = i;
        endIndex = i;
      }
      if (startIndex < 0 || endIndex < startIndex) continue;

      const candidate: Omit<RevenueEventBand<T>, "lane"> = {
        key: `${revenueEventTitleKey(event.title) || normalizedText(event.title)}|${startDate}|${endDate}`,
        event,
        startDate,
        endDate,
        startIndex,
        endIndex,
        score: scoreRevenueEvent(event),
      };

      const duplicateIndex = candidates.findIndex((existing) =>
        sameRevenueEvent(
          { ...existing.event, start: existing.startDate, end: existing.endDate },
          { ...event, start: startDate, end: endDate },
        )
      );

      if (duplicateIndex < 0) {
        candidates.push(candidate);
        continue;
      }

      const existing = candidates[duplicateIndex];
      const mergedStart = existing.startDate < startDate ? existing.startDate : startDate;
      const mergedEnd = existing.endDate > endDate ? existing.endDate : endDate;
      const mergedStartIndex = Math.min(existing.startIndex, startIndex);
      const mergedEndIndex = Math.max(existing.endIndex, endIndex);
      const winner = displayQuality(candidate.event) > displayQuality(existing.event) ? candidate : existing;

      candidates[duplicateIndex] = {
        ...winner,
        key: `${revenueEventTitleKey(winner.event.title) || normalizedText(winner.event.title)}|${mergedStart}|${mergedEnd}`,
        startDate: mergedStart,
        endDate: mergedEnd,
        startIndex: mergedStartIndex,
        endIndex: mergedEndIndex,
        score: Math.max(existing.score, candidate.score),
      };
    }
  }

  const ranked = [...candidates].sort((a, b) =>
    b.score - a.score ||
    a.startIndex - b.startIndex ||
    (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex) ||
    a.event.title.localeCompare(b.event.title),
  );

  // Keep only the strongest events that fit without exceeding the visible
  // lane budget on any date. A multi-day event is kept as one whole interval.
  const occupancy = new Array<number>(dates.length).fill(0);
  const accepted: Array<Omit<RevenueEventBand<T>, "lane">> = [];
  for (const candidate of ranked) {
    let fits = true;
    for (let i = candidate.startIndex; i <= candidate.endIndex; i += 1) {
      if (occupancy[i] >= maxLanes) {
        fits = false;
        break;
      }
    }
    if (!fits) continue;
    accepted.push(candidate);
    for (let i = candidate.startIndex; i <= candidate.endIndex; i += 1) occupancy[i] += 1;
  }

  // Colour the accepted intervals into stable horizontal lanes. Because the
  // acceptance pass caps maximum overlap, a free lane is always available.
  const byStart = accepted.sort((a, b) =>
    a.startIndex - b.startIndex ||
    b.score - a.score ||
    b.endIndex - a.endIndex ||
    a.event.title.localeCompare(b.event.title),
  );
  const laneEnd = new Array<number>(maxLanes).fill(-1);
  const laidOut: RevenueEventBand<T>[] = [];

  for (const candidate of byStart) {
    let lane = laneEnd.findIndex((end) => end < candidate.startIndex);
    if (lane < 0) lane = 0; // defensive fallback; overlap cap should prevent this.
    laneEnd[lane] = candidate.endIndex;
    laidOut.push({ ...candidate, lane });
  }

  return laidOut.sort((a, b) => a.lane - b.lane || a.startIndex - b.startIndex || b.score - a.score);
}
