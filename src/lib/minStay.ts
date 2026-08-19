import { supabase } from "@/integrations/supabase/client";

/**
 * Minimum-stay helpers.
 *
 * Previo stores the minimum stay per arrival date, so a bulk change is just
 * many dates carrying the same number of nights. Sending 180 single-date
 * calls would be painfully slow, so consecutive dates are collapsed into
 * ranges before they travel to the edge function.
 */

const dayMs = 86_400_000;
const parse = (s: string) => new Date(`${s}T00:00:00Z`).getTime();
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export interface MinStayRange { from: string; to: string }

/** Collapse a list of ISO dates into consecutive from/to ranges. */
export function collapseDateRanges(dates: string[]): MinStayRange[] {
  const sorted = Array.from(new Set(dates.filter(Boolean))).sort();
  const out: MinStayRange[] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && parse(d) === parse(last.to) + dayMs) last.to = d;
    else out.push({ from: d, to: d });
  }
  return out;
}

/** Every ISO date between two dates, inclusive. */
export function expandRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = parse(from); t <= parse(to); t += dayMs) out.push(iso(t));
  return out;
}

export interface MinStayResult {
  ok: boolean;
  sent: number;
  failed: number;
  message: string;
}

/**
 * Save a minimum stay for many dates at once and push it to Previo.
 * Throws with a readable message when the change is refused.
 */
export async function pushMinStay(
  hotelId: string,
  dates: string[],
  nights: number,
): Promise<MinStayResult> {
  const clean = Math.max(1, Math.min(30, Math.round(nights)));
  const ranges = collapseDateRanges(dates);
  if (ranges.length === 0) throw new Error("No dates were selected.");

  const { data, error } = await supabase.functions.invoke("previo-push-restrictions", {
    body: {
      hotelId,
      items: ranges.map((r) => ({ date: r.from, to: r.to, minStay: clean })),
    },
  });
  if (error) throw error;
  if (!data?.ok) {
    const detail = data?.results?.find((r: any) => !r.ok)?.message ?? data?.error ?? "Previo did not accept the change.";
    throw new Error(detail);
  }
  const nightsLabel = `${clean} night${clean === 1 ? "" : "s"}`;
  const dayCount = ranges.reduce((s, r) => s + expandRange(r.from, r.to).length, 0);
  return {
    ok: true,
    sent: Number(data?.sent ?? ranges.length),
    failed: Number(data?.failed ?? 0),
    message: `Minimum stay set to ${nightsLabel} on ${dayCount} date${dayCount === 1 ? "" : "s"} in Previo`,
  };
}
