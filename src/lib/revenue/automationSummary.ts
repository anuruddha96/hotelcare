/**
 * Turns an automation run record into plain language a hotel manager can read.
 * The engine speaks in "cells", "pickups" and "queued actions" — none of that
 * belongs in the notification UI, so every phrase used by the pricing activity
 * bell is derived here in one place.
 */

export interface AutomationRunLike {
  hotel_name?: string;
  run_source?: string;
  actions_count?: number;
  pushed_count?: number;
  failed_count?: number;
  pickups_count?: number;
  summary?: string | null;
  changes?: Array<{ old_price?: number | null; new_price?: number | null }>;
}

export interface RunReason {
  label: string;
  explain: string;
}

export type RunTone = "attention" | "done" | "working" | "quiet";

const REASON_RULES: Array<{ match: RegExp; reason: RunReason }> = [
  {
    match: /markdown/i,
    reason: {
      label: "Selling-window markdown",
      explain:
        "Dates that are close in and still have rooms left were lowered so they keep selling.",
    },
  },
  {
    match: /ladder repair|ladder/i,
    reason: {
      label: "Guest-price ladder repair",
      explain:
        "Prices for 1, 2 and 3 guests were put back in the right order with the gaps you configured.",
    },
  },
  {
    match: /top-?up|floor/i,
    reason: {
      label: "Far-out floor top-up",
      explain:
        "Far-future dates that had fallen to your floor price were topped back up.",
    },
  },
  {
    match: /booking window|lifted/i,
    reason: {
      label: "New booking surcharge",
      explain: "Fresh bookings came in, so those dates were raised.",
    },
  },
  {
    match: /strong|strength|long[- ]lead/i,
    reason: {
      label: "Long-lead strength",
      explain: "Dates far out with healthy demand were priced stronger.",
    },
  },
  {
    match: /held|skipped/i,
    reason: {
      label: "Some dates held",
      explain:
        "A few dates were left unchanged — usually sold out, too close in, or already at a limit.",
    },
  },
];

export function runReasons(run: AutomationRunLike): RunReason[] {
  const text = run.summary ?? "";
  const found: RunReason[] = [];
  for (const rule of REASON_RULES) {
    if (rule.match.test(text) && !found.some((r) => r.label === rule.reason.label)) {
      found.push(rule.reason);
    }
  }
  return found;
}

function direction(run: AutomationRunLike): "lowered" | "raised" | "repaired" | "updated" {
  const text = run.summary ?? "";
  if (/ladder/i.test(text) && !/markdown/i.test(text)) return "repaired";
  const rows = run.changes ?? [];
  if (rows.length > 0) {
    let up = 0;
    let down = 0;
    for (const row of rows) {
      const from = Number(row.old_price ?? 0);
      const to = Number(row.new_price ?? 0);
      if (to > from) up += 1;
      else if (to < from) down += 1;
    }
    if (up > 0 && down === 0) return "raised";
    if (down > 0 && up === 0) return "lowered";
    if (up > 0 || down > 0) return "updated";
  }
  if (/markdown|lowered/i.test(text)) return "lowered";
  if (/lifted|surcharge|top-?up|strength/i.test(text)) return "raised";
  return "updated";
}

const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;

export function runHeadline(run: AutomationRunLike): string {
  const who = run.run_source === "automatic" ? "Automatic pricing" : "A manual run";
  const count = run.actions_count ?? 0;
  if (count === 0) {
    return `${who} reviewed your calendar and left prices as they are`;
  }
  const verb = direction(run);
  if (verb === "repaired") return `${who} repaired ${plural(count, "price")}`;
  return `${who} ${verb} ${plural(count, "price")}`;
}

export function runStatus(run: AutomationRunLike): { text: string; tone: RunTone } {
  const failed = run.failed_count ?? 0;
  const sent = run.pushed_count ?? 0;
  const total = run.actions_count ?? 0;
  if (failed > 0) {
    return { text: `${plural(failed, "price")} need your attention`, tone: "attention" };
  }
  if (total === 0) return { text: "Nothing needed changing", tone: "quiet" };
  if (sent >= total) return { text: "All prices are live in your channel manager", tone: "done" };
  if (sent > 0) {
    return { text: `${sent.toLocaleString()} of ${total.toLocaleString()} already live — the rest are on their way`, tone: "working" };
  }
  return { text: "Queued and being sent to your channel manager now", tone: "working" };
}

/** One-line preview used in the bell list. */
export function runPreview(run: AutomationRunLike): string {
  const failed = run.failed_count ?? 0;
  if (failed > 0) return `${plural(failed, "price")} need attention`;
  const status = runStatus(run);
  const count = run.actions_count ?? 0;
  if (count === 0) return "Reviewed — no changes needed";
  const verb = direction(run);
  const action = verb === "repaired" ? `${plural(count, "price")} repaired` : `${plural(count, "price")} ${verb}`;
  return `${action} · ${status.text}`;
}

/** Only the numbers that mean something to a manager, zeros dropped. */
export function runStats(run: AutomationRunLike): Array<{ label: string; value: number; danger?: boolean }> {
  const stats: Array<{ label: string; value: number; danger?: boolean }> = [];
  if ((run.pickups_count ?? 0) > 0) stats.push({ label: "New bookings seen", value: run.pickups_count ?? 0 });
  stats.push({ label: "Prices changed", value: run.actions_count ?? 0 });
  if ((run.pushed_count ?? 0) > 0) stats.push({ label: "Live in channel manager", value: run.pushed_count ?? 0 });
  if ((run.failed_count ?? 0) > 0) stats.push({ label: "Need attention", value: run.failed_count ?? 0, danger: true });
  return stats;
}
