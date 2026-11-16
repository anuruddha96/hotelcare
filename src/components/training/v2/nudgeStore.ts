// Training v2 — contextual nudge snoozes.
//
// A nudge is a soft, one-line "there is a guide for this screen" hint. It is
// not training progress, so it is deliberately kept on the device
// (localStorage, per user) instead of the database: no migration, no RLS, and
// a housekeeper's phone or a manager's desktop each get the hint at most once.
// Progress itself (started / completed guides) still lives in Supabase and
// stops the nudge everywhere once a guide is done.

const storageKey = (userId: string) => `hc.training.nudges.${userId}`;

type SnoozeMap = Record<string, string>; // curriculum slug → ISO "snoozed until"

function read(userId: string): SnoozeMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as SnoozeMap) : {};
  } catch {
    return {};
  }
}

function write(userId: string, map: SnoozeMap) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(map));
  } catch {
    /* storage full or blocked — the nudge simply shows again next time */
  }
}

export function isNudgeSnoozed(userId: string, slug: string, now: number = Date.now()): boolean {
  const until = read(userId)[slug];
  if (!until) return false;
  const ts = new Date(until).getTime();
  return Number.isFinite(ts) && ts > now;
}

export function snoozeNudge(userId: string, slug: string, days: number, now: number = Date.now()) {
  const map = read(userId);
  map[slug] = new Date(now + days * 24 * 3600 * 1000).toISOString();
  write(userId, map);
}

/** Days a nudge stays quiet after each possible outcome. */
export const NUDGE_SNOOZE_DAYS = {
  /** Shown but ignored (auto-hidden): try again next week. */
  ignored: 7,
  /** "Not now": a clear answer — stay quiet for a month. */
  declined: 30,
  /** "Show me": the guide itself now tracks progress; never nudge again. */
  accepted: 3650,
} as const;
