/**
 * Turns an automation run record into plain language a hotel manager can read.
 * The engine speaks in "cells", "pickups" and "queued actions" — none of that
 * belongs in the notification UI, so every phrase used by the revenue activity
 * bell is derived here in one place.
 */

export interface AutomationRunLike {
  hotel_name?: string;
  notification_type?: string;
  run_source?: string;
  source?: 'ai' | 'automation' | 'manual';
  actions_count?: number;
  pushed_count?: number;
  failed_count?: number;
  pickups_count?: number;
  summary?: string | null;
  changes?: Array<{
    date?: string | null;
    delta?: number | null;
    reference_before?: number | null;
    reference_target?: number | null;
    status?: string | null;
    push_requested_count?: number | null;
    push_accepted_count?: number | null;
    push_failed_count?: number | null;
    old_price?: number | null;
    new_price?: number | null;
    old_min_stay?: number | null;
    new_min_stay?: number | null;
    change_type?: string | null;
  }>;
  run?: {
    mode: string;
    status: string;
    dates_evaluated: number;
    dates_increased: number;
    dates_decreased: number;
    dates_held: number;
    cells_queued: number;
    cells_published?: number;
    cells_verified?: number;
    cells_failed?: number;
  } | null;
}

export interface RunReason {
  label: string;
  explain: string;
}

export type RunTone = "attention" | "done" | "working" | "quiet";

const isMinStay = (run: AutomationRunLike) => run.notification_type === "min_stay_automation";
const isAiReferenceRun = (run: AutomationRunLike) =>
  (run.changes ?? []).some((row) => row.date != null && row.reference_before != null && row.reference_target != null);

function aiPushOutcome(run: AutomationRunLike) {
  const rows = run.changes ?? [];
  return {
    total: rows.length,
    acceptedDates: rows.filter((row) => row.status === 'accepted' || row.status === 'confirmed').length,
    acceptedCells: rows.reduce((sum, row) => sum + (row.push_accepted_count ?? 0), 0),
    failedDates: rows.filter((row) => row.status === 'failed').length,
    failedCells: rows.reduce((sum, row) => sum + (row.push_failed_count ?? 0), 0),
  };
}

const REASON_RULES: Array<{ match: RegExp; reason: RunReason }> = [
  {
    match: /minimum stay|1 night|minlos/i,
    reason: {
      label: "Minimum stay updated",
      explain:
        "Stay-length restrictions were adjusted from lead time, occupancy, pickup and event demand so the hotel stays sellable without giving up justified compression.",
    },
  },
  {
    match: /markdown|sell[- ]out/i,
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
    match: /held|skipped|unchanged|no change/i,
    reason: {
      label: "Some dates unchanged",
      explain:
        "These dates were checked, but no change was made because a revenue rule or safety limit applied. Automation is still running.",
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
      const from = Number(row.old_price ?? row.reference_before ?? 0);
      const to = Number(row.new_price ?? row.reference_target ?? 0);
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
  if (isMinStay(run)) {
    const count = run.actions_count ?? 0;
    if ((run.failed_count ?? 0) > 0 && count === 0) return "Minimum-stay automation needs attention";
    if (count === 0) return "Minimum-stay automation reviewed the calendar";
    return `Minimum-stay automation updated ${plural(count, "stay date")}`;
  }

  if (isAiReferenceRun(run)) {
    return `AI supervisor ${direction(run)} ${plural((run.changes ?? []).length, 'stay date')}`;
  }
  const who = run.run_source === "automatic" ? "Automatic pricing" : "A manual run";
  if (run.run) {
    if (run.run.status === "failed") return `${who} stopped with an error`;
    if (run.run.status === "timed_out") return `${who} reached its time limit`;
    if (run.run.mode === "shadow") return `${who} reviewed the calendar without publishing`;
    const changed = run.run.dates_increased + run.run.dates_decreased;
    return changed === 0
      ? `${who} reviewed the calendar and left prices unchanged`
      : `${who} changed ${plural(changed, "stay date")}`;
  }
  const count = run.actions_count ?? 0;
  if (count === 0) return `${who} reviewed your calendar and left prices as they are`;
  const verb = direction(run);
  if (verb === "repaired") return `${who} repaired ${plural(count, "price")}`;
  return `${who} ${verb} ${plural(count, "price")}`;
}

export function runStatus(run: AutomationRunLike): { text: string; tone: RunTone } {
  if (isAiReferenceRun(run)) {
    const { total, acceptedDates, acceptedCells, failedDates, failedCells } = aiPushOutcome(run);
    if (failedDates > 0) {
      return { text: `${failedDates} date(s) have publishing failures (${failedCells} price cells). Check the rate push history.`, tone: 'attention' };
    }
    if (acceptedDates === total && total > 0) {
      return { text: `All ${acceptedDates} stay dates accepted by Previo (${acceptedCells} room/guest prices). Readback not yet confirmed here.`, tone: 'working' };
    }
    if (acceptedDates > 0) {
      return { text: `${acceptedDates} of ${total} dates accepted by Previo; remaining updates are still processing.`, tone: 'working' };
    }
    return { text: 'Publishing not confirmed yet — this notification captured the updates as queued.', tone: 'working' };
  }
  if (isMinStay(run)) {
    const failed = run.failed_count ?? 0;
    const applied = run.pushed_count ?? run.actions_count ?? 0;
    if (failed > 0) {
      return {
        text: `${applied.toLocaleString()} minimum-stay update${applied === 1 ? "" : "s"} live in Previo · ${failed.toLocaleString()} failed`,
        tone: "attention",
      };
    }
    if (applied > 0) return { text: `All ${applied.toLocaleString()} minimum-stay update${applied === 1 ? " is" : "s are"} live in Previo`, tone: "done" };
    return { text: "No minimum-stay changes were needed", tone: "quiet" };
  }

  if (run.run) {
    if (run.run.status === "failed" || run.run.status === "timed_out") {
      return { text: run.summary ?? "The run needs attention", tone: "attention" };
    }
    if (run.run.mode === "shadow") return { text: "Review only — nothing was sent to Previo", tone: "quiet" };
    if (run.run.cells_queued > 0) {
      const failed = run.run.cells_failed ?? 0;
      const verified = run.run.cells_verified ?? 0;
      const accepted = run.run.cells_published ?? 0;
      if (failed > 0) return { text: `${accepted.toLocaleString()} accepted · ${verified.toLocaleString()} confirmed · ${failed.toLocaleString()} failed`, tone: "attention" };
      if (verified >= run.run.cells_queued) return { text: `All ${verified.toLocaleString()} price cells confirmed in Previo`, tone: "done" };
      if (accepted > 0) return { text: `${accepted.toLocaleString()} accepted by Previo · ${verified.toLocaleString()} confirmed`, tone: "working" };
      return { text: `${run.run.cells_queued.toLocaleString()} price cells queued for Previo`, tone: "working" };
    }
    return { text: "No prices needed to be sent", tone: "done" };
  }
  const failed = run.failed_count ?? 0;
  const sent = run.pushed_count ?? 0;
  const total = run.actions_count ?? 0;
  if (failed > 0) return { text: `${plural(failed, "price")} need your attention`, tone: "attention" };
  if (total === 0) return { text: "Nothing needed changing", tone: "quiet" };
  if (sent >= total) return { text: "All prices are live in your channel manager", tone: "done" };
  if (sent > 0) return { text: `${sent.toLocaleString()} of ${total.toLocaleString()} already live — the rest are on their way`, tone: "working" };
  return { text: "Queued and being sent to your channel manager now", tone: "working" };
}

/** One-line preview used in the bell list. */
export function runPreview(run: AutomationRunLike): string {
  if (isAiReferenceRun(run)) {
    const { total, acceptedDates, acceptedCells, failedDates } = aiPushOutcome(run);
    if (failedDates > 0) return `${total} dates reviewed · ${failedDates} publishing failures`;
    if (acceptedDates === total) return `${total} dates updated · ${acceptedCells} prices accepted by Previo`;
    return `${total} dates updated · ${acceptedDates} accepted so far`;
  }
  if (isMinStay(run)) {
    const failed = run.failed_count ?? 0;
    const applied = run.pushed_count ?? run.actions_count ?? 0;
    if (failed > 0) return `${applied.toLocaleString()} MLOS updates live · ${failed.toLocaleString()} need attention`;
    if (applied > 0) return `${applied.toLocaleString()} minimum-stay update${applied === 1 ? "" : "s"} live in Previo`;
    return "Reviewed — no minimum-stay change needed";
  }

  if (run.run) {
    if (run.run.status === "failed") return `Failed · ${run.run.dates_evaluated.toLocaleString()} dates checked`;
    if (run.run.status === "timed_out") return `Timed out · ${run.run.dates_evaluated.toLocaleString()} dates checked`;
    const changed = run.run.dates_increased + run.run.dates_decreased;
    if (run.run.mode === "shadow") return `Review only · ${changed.toLocaleString()} dates identified · ${run.run.dates_held.toLocaleString()} unchanged`;
    const verified = run.run.cells_verified ?? 0;
    const accepted = run.run.cells_published ?? 0;
    const failed = run.run.cells_failed ?? 0;
    if (failed > 0) return `Failed: ${failed.toLocaleString()} prices not accepted · ${changed.toLocaleString()} dates`;
    if (verified >= run.run.cells_queued && verified > 0) return `${changed.toLocaleString()} dates · ${verified.toLocaleString()} prices confirmed in Previo`;
    if (accepted > 0) return `${changed.toLocaleString()} dates · ${accepted.toLocaleString()} prices sent to Previo`;
    return `${changed.toLocaleString()} dates · ${run.run.cells_queued.toLocaleString()} prices sending to Previo…`;
  }
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
  if (isAiReferenceRun(run)) {
    const { total, acceptedDates, acceptedCells, failedDates } = aiPushOutcome(run);
    stats.push({ label: 'Stay dates repriced', value: total });
    if (acceptedDates > 0) stats.push({ label: 'Dates accepted', value: acceptedDates });
    if (acceptedCells > 0) stats.push({ label: 'Prices accepted by Previo', value: acceptedCells });
    if (failedDates > 0) stats.push({ label: 'Dates with failures', value: failedDates, danger: true });
    return stats;
  }
  if (isMinStay(run)) {
    stats.push({ label: "Stay dates updated", value: run.actions_count ?? 0 });
    if ((run.pushed_count ?? 0) > 0) stats.push({ label: "Live in Previo", value: run.pushed_count ?? 0 });
    if ((run.failed_count ?? 0) > 0) stats.push({ label: "Need attention", value: run.failed_count ?? 0, danger: true });
    return stats;
  }
  if ((run.pickups_count ?? 0) > 0) stats.push({ label: "New bookings seen", value: run.pickups_count ?? 0 });
  stats.push({ label: "Prices changed", value: run.actions_count ?? 0 });
  if ((run.pushed_count ?? 0) > 0) stats.push({ label: "Live in channel manager", value: run.pushed_count ?? 0 });
  if ((run.failed_count ?? 0) > 0) stats.push({ label: "Need attention", value: run.failed_count ?? 0, danger: true });
  return stats;
}
