/**
 * Old-school demand grading.
 *
 * Before any market-data subscription existed, hotels graded demand from three
 * things they already owned: how fast the book was filling versus a comparable
 * day, how much inventory was left this close to arrival, and what the manager
 * knew about the town. This module reproduces exactly that from our own Previo
 * booking data — no external feeds, no subscriptions.
 */

export interface DemandNight {
  stay_date: string;
  created_at_pms: string | null;
}

export interface DemandEvent {
  title: string;
  impact: string | null;
  source: "hotel" | "market";
}

export interface DemandDay {
  date: string;
  dow: string;
  leadDays: number;
  sold: number;
  remaining: number;
  occupancyPct: number;
  pickup7: number;
  paceVariancePct: number | null;
  computed: number;
  eventPoints: number;
  score: number;
  band: DemandBand;
  manual: boolean;
  note: string | null;
  drivers: string[];
  events: DemandEvent[];
}

export type DemandBand = "very_strong" | "strong" | "normal" | "soft" | "weak";

export const DEMAND_WEIGHTS = { pickup: 0.3, pressure: 0.25, pace: 0.3, leadtime: 0.15 };

export const BAND_LABEL: Record<DemandBand, string> = {
  very_strong: "Very strong",
  strong: "Strong",
  normal: "Normal",
  soft: "Soft",
  weak: "Weak",
};

/** Semantic token classes only — never hardcoded palette utilities. */
export const BAND_CLASS: Record<DemandBand, string> = {
  very_strong: "bg-primary text-primary-foreground",
  strong: "bg-primary/20 text-primary",
  normal: "bg-muted text-muted-foreground",
  soft: "bg-accent text-accent-foreground",
  weak: "bg-destructive/15 text-destructive",
};

export function bandOf(score: number): DemandBand {
  if (score >= 85) return "very_strong";
  if (score >= 70) return "strong";
  if (score >= 50) return "normal";
  if (score >= 30) return "soft";
  return "weak";
}

/** Impact wording maps to a bounded points adjustment; events never set a price. */
export function eventPoints(events: DemandEvent[]): number {
  let p = 0;
  for (const e of events) {
    const i = (e.impact ?? "").toLowerCase();
    if (i.includes("very")) p += 15;
    else if (i.includes("negative")) p -= 10;
    else if (i.includes("high")) p += 10;
    else if (i.includes("medium")) p += 6;
    else if (i.includes("low")) p -= 4;
    else p += 3;
  }
  return Math.max(-20, Math.min(20, p));
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayMs = 86_400_000;

function iso(d: Date) { return d.toISOString().slice(0, 10); }
function dowOf(date: string) { return new Date(`${date}T00:00:00Z`).getUTCDay(); }
function diffDays(a: string, b: string) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / dayMs);
}

export interface BuildDemandInput {
  nights: DemandNight[];
  today: string;
  days: number;
  roomsAvailable: number;
  eventsByDate?: Map<string, DemandEvent[]>;
  overridesByDate?: Map<string, { score: number; note: string | null }>;
}

export function buildDemandBoard({
  nights, today, days, roomsAvailable,
  eventsByDate = new Map(), overridesByDate = new Map(),
}: BuildDemandInput): DemandDay[] {
  const byDate = new Map<string, DemandNight[]>();
  for (const n of nights) {
    const list = byDate.get(n.stay_date) ?? [];
    list.push(n);
    byDate.set(n.stay_date, list);
  }

  // The property's own trailing baseline for the same weekday = the "book" of old.
  const weekday = new Map<number, number[]>();
  for (const [d, rows] of byDate) {
    const k = dowOf(d);
    const arr = weekday.get(k) ?? [];
    arr.push(rows.length);
    weekday.set(k, arr);
  }
  const weekdayAvg = new Map<number, number>();
  for (const [k, arr] of weekday) weekdayAvg.set(k, arr.reduce((s, x) => s + x, 0) / arr.length);

  const out: DemandDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = iso(new Date(Date.parse(`${today}T00:00:00Z`) + i * dayMs));
    const rows = byDate.get(date) ?? [];
    const sold = rows.length;
    const remaining = Math.max(0, roomsAvailable - sold);
    const occ = roomsAvailable > 0 ? (sold / roomsAvailable) * 100 : 0;
    const lead = Math.max(0, diffDays(date, today));

    const pickup7 = rows.filter((r) =>
      r.created_at_pms && diffDays(today, r.created_at_pms.slice(0, 10)) < 7).length;
    const baseline = weekdayAvg.get(dowOf(date)) ?? null;
    const paceVar = baseline && baseline > 0 ? ((sold - baseline) / baseline) * 100 : null;

    const pickupComp = Math.min(100, (pickup7 / 7) * 25);
    const pressureComp = Math.min(100, occ + (remaining <= 3 ? 20 : 0));
    const paceComp = paceVar === null ? 50 : Math.max(0, Math.min(100, 50 + paceVar));
    const leadComp = Math.max(0, Math.min(100, 100 - Math.abs(lead - 21) * 2));

    const evts = eventsByDate.get(date) ?? [];
    const evPts = eventPoints(evts);
    const computed = Math.max(0, Math.min(100, Math.round(
      pickupComp * DEMAND_WEIGHTS.pickup + pressureComp * DEMAND_WEIGHTS.pressure +
      paceComp * DEMAND_WEIGHTS.pace + leadComp * DEMAND_WEIGHTS.leadtime + evPts,
    )));

    const ov = overridesByDate.get(date) ?? null;
    const score = ov ? Math.max(0, Math.min(100, ov.score)) : computed;

    const drivers: string[] = [];
    if (ov) drivers.push(`Manager grade ${ov.score}/100 (computed ${computed})`);
    if (pickup7 > 0) drivers.push(`${pickup7} room-night(s) picked up in 7 days`);
    if (paceVar !== null) {
      drivers.push(`pace ${paceVar >= 0 ? "+" : ""}${Math.round(paceVar)}% vs other ${DOW[dowOf(date)]}s`);
    }
    if (remaining <= 3 && sold > 0) drivers.push(`only ${remaining} room(s) left`);
    else drivers.push(`${remaining} rooms left at ${lead} days out`);
    for (const e of evts) drivers.push(`${e.source === "hotel" ? "Property" : "City"} event: ${e.title}`);

    out.push({
      date, dow: DOW[dowOf(date)], leadDays: lead, sold, remaining,
      occupancyPct: Math.round(occ * 10) / 10,
      pickup7, paceVariancePct: paceVar === null ? null : Math.round(paceVar),
      computed, eventPoints: evPts, score, band: bandOf(score),
      manual: !!ov, note: ov?.note ?? null, drivers, events: evts,
    });
  }
  return out;
}
