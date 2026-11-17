/**
 * Pure planning helpers for the NAV sync engine: query windows that respect
 * the 35-day NAV limit, incremental cursors with overlap, late-reporting
 * backfill and failure backoff. No I/O here, so it is fully unit-testable.
 */
import type { NavErrorCategory } from "./navResponse.ts";

/** NAV allows at most 35 days between from/to; stay well inside it. */
export const SAFE_WINDOW_DAYS = 30;

export interface DateWindow { from: string; to: string }

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Inclusive YYYY-MM-DD windows where (to - from) <= windowDays - 1. */
export function splitDateRange(from: string, to: string, windowDays = SAFE_WINDOW_DAYS + 1): DateWindow[] {
  if (from > to) return [];
  const windows: DateWindow[] = [];
  let start = from;
  while (start <= to) {
    const candidateEnd = addDaysIso(start, windowDays - 1);
    const end = candidateEnd < to ? candidateEnd : to;
    windows.push({ from: start, to: end });
    start = addDaysIso(end, 1);
  }
  return windows;
}

/** UTC timestamp windows (NAV insDate), each at most windowDays long. */
export function splitTimestampRange(fromIso: string, toIso: string, windowDays = SAFE_WINDOW_DAYS): DateWindow[] {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return [];
  const span = windowDays * 86_400_000;
  const windows: DateWindow[] = [];
  for (let start = from; start <= to; start += span) {
    const end = Math.min(to, start + span - 1000);
    windows.push({ from: new Date(start).toISOString(), to: new Date(end).toISOString() });
    if (end >= to) break;
  }
  return windows;
}

export interface IncrementalPlanInput {
  /** insDate cursor of the last fully successful incremental sync. */
  cursor: string | null;
  now: Date;
  /** Re-read this many minutes before the cursor to tolerate clock skew. */
  overlapMinutes?: number;
  /** Look-back when there is no cursor yet. */
  initialLookbackDays?: number;
}

export function planIncrementalWindows(input: IncrementalPlanInput): DateWindow[] {
  const overlap = (input.overlapMinutes ?? 60) * 60_000;
  const nowMs = input.now.getTime();
  const fromMs = input.cursor && Number.isFinite(Date.parse(input.cursor))
    ? Date.parse(input.cursor) - overlap
    : nowMs - (input.initialLookbackDays ?? 3) * 86_400_000;
  return splitTimestampRange(new Date(Math.min(fromMs, nowMs)).toISOString(), new Date(nowMs).toISOString());
}

/** Issue-date windows for the late-reporting reconciliation pass. */
export function planBackfillWindows(now: Date, backfillDays: number): DateWindow[] {
  const to = isoDate(now);
  const from = addDaysIso(to, -Math.max(1, backfillDays));
  return splitDateRange(from, to);
}

/** Remaining historical windows (resumable through initialThrough). */
export function planInitialWindows(syncFrom: string, initialThrough: string | null, now: Date): DateWindow[] {
  const start = initialThrough ? addDaysIso(initialThrough, 1) : syncFrom;
  return splitDateRange(start, isoDate(now));
}

/** Delay before the next automatic attempt after consecutive failures. */
export function nextRetryDelayMs(consecutiveFailures: number, category: NavErrorCategory): number {
  const n = Math.max(1, consecutiveFailures);
  if (category === "auth" || category === "config") return 24 * 3_600_000; // needs an admin fix
  if (category === "maintenance") return Math.min(4 * 3_600_000, 15 * 60_000 * n);
  return Math.min(6 * 3_600_000, 5 * 60_000 * 2 ** (n - 1));
}

/** True when the scheduled incremental sync is due for a connection. */
export function isSyncDue(input: {
  enabled: boolean;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  intervalMinutes: number;
  now: Date;
}): boolean {
  if (!input.enabled) return false;
  const now = input.now.getTime();
  if (input.nextRetryAt && Date.parse(input.nextRetryAt) > now) return false;
  if (!input.lastAttemptAt) return true;
  return now - Date.parse(input.lastAttemptAt) >= input.intervalMinutes * 60_000;
}
