export type AiObservation = { created_at: string; valid_until: string };

/** A new genuine booking invalidates an AI observation; clock ticks do not. */
export function observeAiPrice(policy: AiObservation | null | undefined, now: Date, lastPickupAt: string | null): boolean {
  if (!policy || !Number.isFinite(Date.parse(policy.created_at)) || !Number.isFinite(Date.parse(policy.valid_until))) return false;
  return Date.parse(policy.created_at) <= now.getTime() && Date.parse(policy.valid_until) > now.getTime()
    && !(lastPickupAt && Date.parse(lastPickupAt) > Date.parse(policy.created_at));
}

export interface AiDate {
  date: string; lead: number; occ: number | null; left: number | null;
  reference: number | null; min_price: number; max_price: number;
  pickup_1h: number; pickup_6h: number; pickup_24h: number; pickup_48h: number; pickup_7d: number;
  quiet_hours: number | null; cancellations_24h: number; down_today: number; up_today: number;
  markdowns_today: number; last_move_at: string | null; captured_at: string | null;
  cells: { obk_id: string; occupancy: number; price: number }[];
  market: { median: number | null; count: number; age_hours: number | null };
  engine_reason: string | null; high_event?: boolean;
  manager_hold_until?: string | null;
}

/** Bound the request, preserve every urgent date, then prioritize weak months. */
export function selectAiDates(dates: AiDate[], now: Date, limit = 56): AiDate[] {
  const eligible = dates.filter(d => d.lead >= 0 && d.lead <= 120 && d.left != null && d.left > 0
    && d.occ != null && d.reference != null && d.reference > 0 && d.cells.length === 13
    && d.captured_at != null && now.getTime() - Date.parse(d.captured_at) < 30 * 60_000);
  const score = (d: AiDate) => d.lead <= 3 ? -1000 + d.lead
    : (d.date.slice(5, 7) === '11' || d.date.slice(5, 7) === '01' ? 0 : 300)
      + Number(d.occ) * 2 + d.lead / 10;
  return eligible.sort((a,b) => score(a) - score(b) || a.date.localeCompare(b.date)).slice(0, limit);
}

/** Reject malformed/unrequested dates before the independent database gate. */
export function validateAiMoves(raw: unknown, dates: AiDate[]): { date: string; delta: number; reason: string; confidence: number }[] {
  if (!Array.isArray(raw)) throw new Error('AI response has no decisions array');
  if (raw.length !== dates.length) throw new Error('AI did not evaluate every supplied date');
  const allowed = new Map(dates.map(d=>[d.date,d]));
  const seen = new Set<string>();
  return raw.map(row => {
    const d = allowed.get(row?.date);
    if (!d || seen.has(row.date) || !Number.isInteger(row.delta)
      || Math.abs(row.delta) > (d.lead <= 3 ? 12 : 6)
      || typeof row.reason !== 'string' || row.reason.trim().length < 20
      || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) {
      throw new Error('AI returned an invalid, duplicate, or unrequested price decision');
    }
    seen.add(row.date);
    return { date: row.date, delta: row.delta, reason: row.reason.slice(0, 800), confidence: row.confidence };
  });
}

export function estimateSupervisorCost(model: string, input: number, output: number): number {
  const prices = model === 'gpt-6-astra' ? [10,50] : model === 'gpt-5.6-sol' ? [4,20]
    : model === 'gpt-5.5' ? [5,30] : model === 'gpt-5.4' ? [2.5,15]
    : model === 'gpt-5.2' ? [1.75,14] : model === 'gpt-4.1' ? [2,8] : [2,10];
  return (input * prices[0] + output * prices[1]) / 1_000_000;
}

export function availableSupervisorModel(ids: string[]): string {
  return ['gpt-6.1-sol','gpt-5.6-sol','gpt-5.5','gpt-5.4','gpt-5.2','gpt-4.1']
    .find(id=>ids.includes(id)) ?? 'gpt-4.1';
}

/** An event is context; persistently empty inventory can earn a small AI test. */
export function softEventTest(date: AiDate, delta: number): boolean {
  return delta < 0 && delta >= -2 && date.occ != null && date.occ < 70
    && Number(date.left) >= 5 && date.pickup_6h === 0
    && (Number(date.quiet_hours) >= 24 || date.occ === 0);
}
