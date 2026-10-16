/**
 * Publication-time budget gate for Ottofiori Engine V2.
 *
 * Keep the status set and the window rule selection in sync with
 * public.enforce_automation_daily_movement_budget (SQL trigger).
 * Each queued decision is one price change per STAY DATE, never 13 separate
 * markdowns (one for each room-type/occupancy cell).
 */
export const MARKDOWN_BUDGET_STATUSES = [
  "queued", "accepted", "confirmed", "published", "partial",
] as const;

export interface MarkdownBudgetDecision {
  id: string;
  stay_date: string;
  direction: string;
  status: string;
  movement: number | string | null;
  days_out: number;
}

export interface MarkdownBudgetWindow {
  min_days_out?: number | null;
  max_days_out?: number | null;
  max_daily_decrease?: number | null;
}

const active = new Set<string>(MARKDOWN_BUDGET_STATUSES);

export function checkOttofioriMarkdownBudget(args: {
  decisionId: string;
  stayDate: string;
  decisions: MarkdownBudgetDecision[];
  windows: MarkdownBudgetWindow[];
  defaultCap: number;
  maxMarkdowns: number;
}): { allowed: boolean; reason: string | null } {
  const current = args.decisions.find((d) =>
    d.id === args.decisionId && d.stay_date === args.stayDate);
  if (!current || current.status !== "queued" || current.direction !== "decrease") {
    return { allowed: false, reason: "The latest date decision is missing, held, or no longer a queued decrease." };
  }
  const days = Number(current.days_out);
  const window = args.windows
    .filter((w) => days >= Number(w.min_days_out ?? 0) &&
      (w.max_days_out == null || days <= Number(w.max_days_out)))
    .sort((a, b) => Number(b.min_days_out ?? 0) - Number(a.min_days_out ?? 0))[0];
  const cap = Number(window?.max_daily_decrease ?? args.defaultCap);
  const maxMarkdowns = Number(args.maxMarkdowns);
  const rows = args.decisions.filter((d) =>
    d.stay_date === args.stayDate && d.direction === "decrease" && active.has(d.status));
  const spent = rows.reduce((sum, d) => sum + Math.abs(Number(d.movement)), 0);
  if (!Number.isFinite(cap) || !Number.isFinite(maxMarkdowns) ||
      !Number.isFinite(spent) || rows.some((d) => !Number.isFinite(Number(d.movement)))) {
    return { allowed: false, reason: "Could not verify the daily markdown allowance safely." };
  }
  // Fail closed for a zero-decrease window (the DB trigger alone currently
  // treats cap=0 as disabled; the Engine V2 contract treats it as no discount).
  if (cap <= 0 || spent > cap || (maxMarkdowns > 0 && rows.length > maxMarkdowns)) {
    return {
      allowed: false,
      reason: `Daily markdown limit: €${spent} including this attempt / €${cap} allowed; ${rows.length} decreases / ${maxMarkdowns} allowed. No price for this date was submitted.`,
    };
  }
  return { allowed: true, reason: null };
}
