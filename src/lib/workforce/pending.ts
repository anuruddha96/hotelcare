/**
 * "Waiting for you to publish": what a planner still has to publish, in the
 * words a manager reads at a glance. Per month: how many employees have not
 * received their schedule at all, how many still see an older version, and
 * by when to publish. Counts people, never person-days, and ignores past days
 * (they reach nobody). Pure, unit-tested.
 */

export interface DraftDay {
  staff_id: string;
  /** YYYY-MM-DD */
  work_date: string;
  /** Who last changed the day (the planner the reminder is for). */
  updated_by: string | null;
}

export interface MonthWork {
  /** YYYY-MM */
  month: string;
  /** Employees who have not received this month at all yet. */
  notReceived: string[];
  /** Employees who already have this month: they still see the older version. */
  changed: string[];
  /** First day with an unpublished change. */
  earliest: string;
}

export interface OtherPlannerWork {
  month: string;
  /** Null when nobody is recorded as the last editor (for example a bulk import). */
  plannerId: string | null;
  staffIds: string[];
}

export interface PendingWork {
  /** The signed-in planner's own unpublished work, oldest month first. */
  mine: MonthWork[];
  /** Other planners' unpublished work, per month and planner. */
  others: OtherPlannerWork[];
}

export function summarizePending(
  drafts: DraftDay[],
  me: string | null,
  today: string,
  received: (staffId: string, month: string) => boolean,
): PendingWork {
  const mine = new Map<string, { people: Set<string>; earliest: string }>();
  const others = new Map<string, OtherPlannerWork & { people: Set<string> }>();
  for (const d of drafts) {
    if (d.work_date < today) continue;
    const month = d.work_date.slice(0, 7);
    if (me && d.updated_by === me) {
      const m = mine.get(month);
      if (m) { m.people.add(d.staff_id); if (d.work_date < m.earliest) m.earliest = d.work_date; }
      else mine.set(month, { people: new Set([d.staff_id]), earliest: d.work_date });
    } else {
      const key = `${month}|${d.updated_by ?? ''}`;
      const o = others.get(key);
      if (o) o.people.add(d.staff_id);
      else others.set(key, { month, plannerId: d.updated_by ?? null, staffIds: [], people: new Set([d.staff_id]) });
    }
  }
  return {
    mine: [...mine].sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => {
      const notReceived: string[] = [];
      const changed: string[] = [];
      for (const id of m.people) (received(id, month) ? changed : notReceived).push(id);
      return { month, notReceived: notReceived.sort(), changed: changed.sort(), earliest: m.earliest };
    }),
    others: [...others.values()]
      .sort((a, b) => a.month.localeCompare(b.month) || String(a.plannerId ?? '').localeCompare(String(b.plannerId ?? '')))
      .map(({ month, plannerId, people }) => ({ month, plannerId, staffIds: [...people].sort() })),
  };
}

/** A month's schedule should reach staff a week before the month starts. */
export const PUBLISH_LEAD_DAYS = 7;

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);

export type PublishTiming =
  /** The month has not started; publish by `deadline`. */
  | { kind: 'ahead'; deadline: string; daysLeft: number }
  /** Past the deadline, but the month has not started yet. */
  | { kind: 'late'; starts: string }
  /** The month has already started. */
  | { kind: 'running' };

export function publishTiming(month: string, today: string): PublishTiming {
  const start = `${month}-01`;
  if (start <= today) return { kind: 'running' };
  const deadline = shift(start, -PUBLISH_LEAD_DAYS);
  if (today <= deadline) return { kind: 'ahead', deadline, daysLeft: daysBetween(today, deadline) };
  return { kind: 'late', starts: start };
}

/** Needs attention now: the deadline is at most two days away, has passed, or the month is running. */
export const isUrgent = (timing: PublishTiming) => timing.kind !== 'ahead' || timing.daysLeft <= 2;

/** "December 2026", "2026. december" … in the reader's language. */
export function monthTitle(month: string, locale: string): string {
  const [y, m] = month.split('-').map(Number);
  const text = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A text with a count, in the right grammatical form: looks up `key.one`,
 * `key.few` or `key.many` (Intl plural rules of the reader's language) and
 * falls back to `key`. `t` returns the key itself when a text is missing.
 */
export function countText(t: (key: string) => string, locale: string, key: string, n: number): string {
  let form = 'other';
  try { form = new Intl.PluralRules(locale).select(n); } catch { /* very old browser: use the general form */ }
  const specific = form === 'other' ? null : t(`${key}.${form}`);
  const text = specific && specific !== `${key}.${form}` ? specific : t(key);
  return text.split('{n}').join(String(n));
}
