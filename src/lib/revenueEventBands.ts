export interface RevenueEventBandInput {
  title: string;
  impact: string;
  category?: string | null;
  venue?: string | null;
  url?: string | null;
  notes?: string | null;
  start?: string;
  end?: string;
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

function isoDate(value?: string | null): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value ?? "");
  return match?.[1] ?? null;
}

export function scoreRevenueEvent(event: RevenueEventBandInput): number {
  const impact = IMPACT_WEIGHT[String(event.impact || "").toLowerCase()] ?? 0;
  const category = CATEGORY_WEIGHT[String(event.category || "other").toLowerCase()] ?? 10;
  const evidence = (event.venue ? 4 : 0) + (event.url ? 3 : 0) + (event.notes ? 1 : 0);
  return impact + category + evidence;
}

/**
 * Build at most `maxLanes` continuous event bars over the visible date columns.
 *
 * Events are deduplicated because the revenue feed intentionally repeats a
 * multi-day event in every stay-date bucket. Stronger demand drivers are
 * accepted first, and an event is either shown for its whole visible duration
 * or not shown at all. This prevents the old "same event repeated in every
 * date cell" effect while guaranteeing no date has more than five visible
 * event bars.
 */
export function buildRevenueEventBands<T extends RevenueEventBandInput>(
  dates: readonly string[],
  eventsByDate?: ReadonlyMap<string, readonly T[]>,
  maxLanes = 5,
): RevenueEventBand<T>[] {
  if (dates.length === 0 || !eventsByDate || maxLanes <= 0) return [];

  const firstVisible = dates[0];
  const lastVisible = dates[dates.length - 1];
  const candidates = new Map<string, Omit<RevenueEventBand<T>, "lane">>();

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

      const key = [
        event.title.trim().toLowerCase(),
        startDate,
        endDate,
        String(event.venue ?? "").trim().toLowerCase(),
      ].join("|");
      const score = scoreRevenueEvent(event);
      const existing = candidates.get(key);
      if (!existing || score > existing.score) {
        candidates.set(key, {
          key,
          event,
          startDate,
          endDate,
          startIndex,
          endIndex,
          score,
        });
      }
    }
  }

  const ranked = Array.from(candidates.values()).sort((a, b) =>
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
