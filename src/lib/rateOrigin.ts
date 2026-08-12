// Who last touched a price, in one place.
//
// Three sources can move a rate: someone on the team pushing from Hotel Care,
// the pickup automation tool, or a person editing directly in Previo. The grid
// used to rank them, so a cell the automation once touched stayed purple even
// after a human changed it this morning. Here they are merged and simply
// sorted by time, so the newest change always wins.

import type { RateAuditRow } from "@/lib/rateAudit";
import type { AutomationAction } from "@/hooks/usePickupAutomationActions";

/** blue = your team · purple = automation · amber = Previo · red = did not land */
export type ChangeOrigin = "team" | "automation" | "previo" | "failed";

export interface OriginEvent {
  origin: ChangeOrigin;
  /** ISO timestamp of the change. */
  at: string;
}

export const ORIGIN_DOT_CLASS: Record<ChangeOrigin, string> = {
  team: "bg-primary",
  automation: "bg-purple-500",
  previo: "bg-amber-500",
  failed: "bg-destructive",
};

export const ORIGIN_LABEL: Record<ChangeOrigin, string> = {
  team: "by your team",
  automation: "by the automation tool",
  previo: "in Previo",
  failed: "did not land",
};

export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function fromAuditSource(source: string | null, confirmation?: string): ChangeOrigin | null {
  if (confirmation === "different") return "failed";
  switch (source) {
    case "previo_confirmed": return "team";
    case "previo_automation_confirmed": return "automation";
    case "previo_external": return "previo";
    case "previo_different": return "failed";
    default: return null;
  }
}

/**
 * Every confirmed change on one cell, newest first, limited to `windowMs`.
 * Audit rows and automation records describing the same move are de-duplicated
 * by (origin, minute) so a cell never shows the same event twice.
 */
export function cellOriginEvents(
  history: RateAuditRow[] | undefined,
  automation: AutomationAction[] | undefined,
  now = Date.now(),
  windowMs = RECENT_WINDOW_MS,
): OriginEvent[] {
  const events: OriginEvent[] = [];
  for (const r of history ?? []) {
    const origin = fromAuditSource(r.source, r.payload?.confirmation_status);
    if (origin) events.push({ origin, at: r.performed_at });
  }
  for (const a of automation ?? []) {
    if (a.status === "failed") continue;
    events.push({ origin: "automation", at: a.created_at });
  }
  const seen = new Set<string>();
  return events
    .filter((e) => {
      const t = new Date(e.at).getTime();
      if (!Number.isFinite(t) || now - t > windowMs || t > now + 60_000) return false;
      const key = `${e.origin}|${Math.floor(t / 60_000)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * The distinct origins on a cell or a date, newest first — at most `max` of
 * them, so the grid shows one or two tiny dots and never a row of confetti.
 */
export function distinctOrigins(events: OriginEvent[], max = 2): ChangeOrigin[] {
  const out: ChangeOrigin[] = [];
  for (const e of events) {
    if (!out.includes(e.origin)) out.push(e.origin);
    if (out.length >= max) break;
  }
  return out;
}

/** How many changes each origin made, for the date hover card. */
export function countByOrigin(events: OriginEvent[]): Array<{ origin: ChangeOrigin; count: number }> {
  const counts = new Map<ChangeOrigin, number>();
  for (const e of events) counts.set(e.origin, (counts.get(e.origin) ?? 0) + 1);
  const order: ChangeOrigin[] = ["team", "automation", "previo", "failed"];
  return order.filter((o) => counts.has(o)).map((o) => ({ origin: o, count: counts.get(o) as number }));
}
