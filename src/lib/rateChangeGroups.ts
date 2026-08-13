// One price move = one story.
//
// A single price change leaves several rows behind: the local draft ("waiting
// to be sent"), the push row ("sent — confirming") and the Previo read-back
// ("confirmed"). Those are lifecycle stages of the SAME change, not three
// changes, and the cell drawer used to list all of them. The same is true of
// drafts: a row Previo refused, or one an abandoned publisher left behind, is
// history — it must never be painted as an active, actionable draft.
//
// Everything that decides "is this still live?" and "is this the same change?"
// lives here so the grid, the drawer and the history panel agree.

import type { RateAuditRow } from "@/lib/rateAudit";
import type { AutomationAction } from "@/hooks/usePickupAutomationActions";

/* ------------------------------------------------------------------ drafts */

export interface DraftLike {
  id?: string;
  created_at?: string | null;
  updated_at?: string | null;
  new_price: number | string;
  status?: string | null;
  confirmation_status?: string | null;
}

/**
 * `unsent`   — genuinely waiting for someone to publish it (dotted underline)
 * `inflight` — already handed to Previo, waiting only for the read-back
 * `terminal` — refused, superseded, confirmed or abandoned: history, not a draft
 */
export type DraftState = "unsent" | "inflight" | "terminal";

/** Statuses that can never be acted on again. */
const TERMINAL_STATUS = new Set(["failed", "refused", "cancelled", "canceled", "superseded", "expired", "confirmed"]);
const TERMINAL_CONFIRMATION = new Set(["confirmed", "different", "superseded", "failed", "refused", "cancelled", "canceled", "expired"]);
/** Confirmation markers written once the publisher has taken the row. */
const IN_FLIGHT_CONFIRMATION = new Set(["sending", "sent", "checking", "pending", "queued"]);

/**
 * A publish that never reported back inside this window is abandoned, not
 * "sending" — Ottofiori had rows sitting at `sending` for hours while the grid
 * still offered them as live drafts.
 */
export const ABANDONED_PUBLISH_MS = 45 * 60 * 1000;

export function classifyDraft(d: DraftLike, now: number = Date.now()): DraftState {
  const status = (d.status ?? "").toLowerCase();
  const conf = (d.confirmation_status ?? "").toLowerCase();

  if (TERMINAL_STATUS.has(status)) return "terminal";
  if (TERMINAL_CONFIRMATION.has(conf)) return "terminal";

  const stamp = Date.parse(String(d.updated_at ?? d.created_at ?? "")) || 0;
  const stale = stamp > 0 && now - stamp > ABANDONED_PUBLISH_MS;

  if (status === "pushed") return stale ? "terminal" : "inflight";

  if (IN_FLIGHT_CONFIRMATION.has(conf)) {
    // The row was claimed for publishing. If nothing happened since, it is a
    // dead attempt — never re-offer it as an unsent price.
    return stale ? "terminal" : "inflight";
  }

  return "unsent";
}

/** Drafts that should drive the dotted "waiting to be sent" overlay. */
export function isActiveDraft(d: DraftLike, now?: number): boolean {
  return classifyDraft(d, now) === "unsent";
}

/* ------------------------------------------------------- logical changes */

/** confirmed beats refused beats sending beats waiting. */
export type ChangePhase = "waiting" | "sending" | "failed" | "confirmed";

const PHASE_RANK: Record<ChangePhase, number> = { waiting: 1, sending: 2, failed: 3, confirmed: 4 };

export interface LogicalChange {
  id: string;
  /** When the most advanced stage of this change happened. */
  at: string;
  old: number | null;
  next: number | null;
  phase: ChangePhase;
  statusLabel: string;
  who: string;
  automation: boolean;
  detail?: string | null;
  extra?: { requested: number | null; actual: number | null; different: boolean } | null;
  /** How many raw rows were folded into this one change. */
  stages: number;
}

interface Stage extends Omit<LogicalChange, "stages"> {
  linkId: string | null;
}

/** Rows the same publish wrote share one of these ids. */
function linkIdOf(r: RateAuditRow): string | null {
  const p = r.payload as (RateAuditRow["payload"] & { draft_id?: string | null }) | null;
  return p?.push_run_id ?? p?.draft_id ?? null;
}

export function isAutomationRow(r: RateAuditRow): boolean {
  return r.source === "previo_automation_confirmed"
    || r.source === "push_automation"
    || r.payload?.origin === "pickup-automation";
}

function auditPhase(r: RateAuditRow): ChangePhase {
  const conf = r.payload?.confirmation_status;
  if (conf === "different") return "failed";
  if (conf === "confirmed" || conf === "external") return "confirmed";
  switch (r.source) {
    case "previo_confirmed":
    case "previo_automation_confirmed":
    case "previo_bulk_confirmed":
    case "previo_external":
      return "confirmed";
    case "previo_different":
      return "failed";
    case "push":
    case "push_automation":
      return "sending";
    default:
      return "waiting";
  }
}

function auditLabel(r: RateAuditRow, phase: ChangePhase): string {
  if (phase === "failed") return r.payload?.confirmation_status === "different" ? "landed on a different price" : "Previo refused it";
  if (phase === "confirmed") return r.source === "previo_external" ? "changed directly in Previo" : "confirmed in Previo";
  if (phase === "sending") return "sent to Previo — confirming";
  return "waiting to be sent";
}

function automationLabel(status: string): { phase: ChangePhase; label: string } {
  switch (status) {
    case "pushed": return { phase: "confirmed", label: "live in Previo" };
    case "confirmed": return { phase: "confirmed", label: "live in Previo" };
    case "queued": return { phase: "sending", label: "sending to Previo" };
    case "suggested": return { phase: "waiting", label: "suggested — waiting for approval" };
    case "failed": return { phase: "failed", label: "Previo refused it" };
    default: return { phase: "waiting", label: status };
  }
}

/** Stages further apart than this are treated as separate decisions. */
export const SAME_CHANGE_WINDOW_MS = 30 * 60 * 1000;

/**
 * Fold audit rows and automation records for ONE cell into distinct logical
 * changes, newest first, each carrying only its most advanced status.
 *
 * Identity is a shared publish id when the rows have one; otherwise the
 * conservative fallback of "same target price, minutes apart", so two genuine
 * edits to the same price hours apart stay separate.
 */
export function groupCellChanges(
  history: RateAuditRow[] | undefined,
  automation: AutomationAction[] | undefined,
  names: Map<string, string>,
  opts: { automationDetail?: (a: AutomationAction) => string | null } = {},
): LogicalChange[] {
  const stages: Stage[] = [];

  for (const r of history ?? []) {
    // A mismatch someone already checked in Previo is closed history.
    if (r.source === "previo_different" && r.payload?.resolved_at) continue;
    const auto = isAutomationRow(r);
    const phase = auditPhase(r);
    stages.push({
      id: r.id,
      at: r.performed_at,
      old: r.old_rate_eur,
      next: r.new_rate_eur,
      phase,
      statusLabel: auditLabel(r, phase),
      who: auto ? "Pickup automation tool" : ((r.performed_by && names.get(r.performed_by)) || "Someone"),
      automation: auto,
      extra: r.payload?.requested_price != null && r.payload?.actual_previo_price != null
        ? {
            requested: r.payload.requested_price,
            actual: r.payload.actual_previo_price,
            different: r.payload?.confirmation_status === "different",
          }
        : null,
      linkId: linkIdOf(r),
    });
  }

  for (const a of automation ?? []) {
    const { phase, label } = automationLabel(a.status);
    stages.push({
      id: `auto-${a.id}`,
      at: a.created_at,
      old: a.old_price,
      next: a.new_price,
      phase,
      statusLabel: label,
      who: "HotelCare Automation",
      automation: true,
      detail: opts.automationDetail?.(a) ?? null,
      extra: null,
      linkId: null,
    });
  }

  stages.sort((a, b) => a.at.localeCompare(b.at));

  interface Group { stages: Stage[]; lastAt: number; linkIds: Set<string>; next: number | null }
  const groups: Group[] = [];

  for (const s of stages) {
    const t = Date.parse(s.at) || 0;
    let target = s.linkId ? groups.find((g) => g.linkIds.has(s.linkId as string)) : undefined;
    if (!target) {
      target = groups.find((g) =>
        g.next !== null && s.next !== null && g.next === s.next && t - g.lastAt <= SAME_CHANGE_WINDOW_MS);
    }
    if (target) {
      target.stages.push(s);
      target.lastAt = Math.max(target.lastAt, t);
      if (s.linkId) target.linkIds.add(s.linkId);
      if (s.next !== null) target.next = s.next;
    } else {
      groups.push({ stages: [s], lastAt: t, linkIds: new Set(s.linkId ? [s.linkId] : []), next: s.next });
    }
  }

  const out: LogicalChange[] = groups.map((g) => {
    // The most advanced stage tells the story; ties go to the newest row.
    const best = [...g.stages].sort((a, b) => {
      const d = PHASE_RANK[b.phase] - PHASE_RANK[a.phase];
      return d !== 0 ? d : b.at.localeCompare(a.at);
    })[0];
    const first = g.stages[0];
    const named = g.stages.find((s) => s.automation || (s.who && s.who !== "Someone"));
    return {
      id: best.id,
      at: best.at,
      old: first.old,
      next: best.next ?? first.next,
      phase: best.phase,
      statusLabel: best.statusLabel,
      who: (named ?? best).who,
      automation: g.stages.some((s) => s.automation),
      detail: g.stages.find((s) => s.detail)?.detail ?? null,
      extra: g.stages.find((s) => s.extra)?.extra ?? null,
      stages: g.stages.length,
    };
  });

  return out.sort((a, b) => b.at.localeCompare(a.at));
}
