import { useState } from "react";
import { formatWhen, type RateAuditRow } from "@/lib/rateAudit";
import { moneyBase } from "@/lib/revenueCurrency";
import type { AutomationAction } from "@/hooks/usePickupAutomationActions";

/**
 * The story of one price cell in a single readable block:
 *
 *   €111 → €123   +€12 (+11%)
 *   Yesterday 18:12 · Nuwan · Sent to Previo
 *
 * Moves made by the pickup automation tool are merged in with the booking that
 * triggered them, so a purple dot on the grid always has proof behind it.
 * Older changes stay behind a "N more changes" toggle.
 */

interface Entry {
  id: string;
  at: string;
  old: number | null;
  next: number | null;
  who: string;
  status: string;
  detail?: string | null;
  extra?: { requested: number | null; actual: number | null; different: boolean } | null;
  automation?: boolean;
}

/** An audit row written by the automation engine, not by a person. */
function isAutomationRow(r: RateAuditRow): boolean {
  return r.source === "previo_automation_confirmed" || r.payload?.origin === "pickup-automation";
}

function automationStatus(status: string): string {
  switch (status) {
    case "pushed": return "live in Previo";
    case "queued": return "sending to Previo";
    case "suggested": return "suggested — waiting for approval";
    case "failed": return "Previo refused it";
    default: return status;
  }
}

export default function RateCellHistory({
  history,
  names,
  draftPrice,
  sendingPrice,
  automation = [],
}: {
  history: RateAuditRow[];
  names: Map<string, string>;
  draftPrice?: number | null;
  /** Already sent to Previo, waiting only for its read-back. */
  sendingPrice?: number | null;
  automation?: AutomationAction[];
}) {
  const [showAll, setShowAll] = useState(false);

  const auditEntries: Entry[] = history.map((r) => {
    const auto = isAutomationRow(r);
    const status = r.payload?.confirmation_status;
    const statusLabel = status === "confirmed"
      ? "confirmed in Previo"
      : status === "different"
        ? "landed on a different price"
        : r.source === "previo_external"
          ? "changed directly in Previo"
          : r.source === "push" ? "sent to Previo — confirming" : "waiting to be sent";
    return {
      id: r.id,
      at: r.performed_at,
      old: r.old_rate_eur,
      next: r.new_rate_eur,
      who: auto ? "Pickup automation tool" : ((r.performed_by && names.get(r.performed_by)) || "Someone"),
      status: statusLabel,
      extra: r.payload?.requested_price != null && r.payload?.actual_previo_price != null
        ? { requested: r.payload.requested_price, actual: r.payload.actual_previo_price, different: status === "different" }
        : null,
      automation: auto,
    };
  });

  const automationEntries: Entry[] = automation.map((a) => ({
    id: `auto-${a.id}`,
    at: a.created_at,
    old: a.old_price,
    next: a.new_price,
    who: "Pickup automation tool",
    status: automationStatus(a.status),
    detail: [
      a.reservation_id ? `Triggered by booking #${a.reservation_id}` : "Triggered by a new booking",
      a.pickup_at ? `picked up ${formatWhen(a.pickup_at)}` : null,
      a.pickup_sequence && a.pickup_sequence > 1 ? `${a.pickup_sequence}${a.pickup_sequence === 2 ? "nd" : a.pickup_sequence === 3 ? "rd" : "th"} booking in the window` : null,
      a.increase_amount != null ? `rule raised it by ${moneyBase(a.increase_amount)}` : null,
    ].filter(Boolean).join(" · "),
    automation: true,
  }));

  const entries = [...auditEntries, ...automationEntries]
    .sort((a, b) => b.at.localeCompare(a.at));

  if (entries.length === 0) {
    if (sendingPrice != null) {
      return <p className="text-[11px] text-primary">{moneyBase(sendingPrice)} — sending to Previo now</p>;
    }
    return draftPrice != null
      ? <p className="text-[11px] text-muted-foreground">{moneyBase(draftPrice)} — waiting to be sent</p>
      : <p className="text-[11px] text-muted-foreground">No price changes yet.</p>;
  }

  const block = (e: Entry) => {
    const delta = e.old != null && e.next != null ? Math.round((e.next - e.old) * 100) / 100 : null;
    const pct = e.old && e.next != null && e.old !== 0
      ? Math.round(((e.next - e.old) / e.old) * 1000) / 10
      : null;
    const up = (delta ?? 0) >= 0;
    return (
      <div key={e.id} className="space-y-0.5">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs tabular-nums">
          <span>{moneyBase(e.old)} → <strong>{moneyBase(e.next)}</strong></span>
          {delta != null && delta !== 0 && (
            <span className={up ? "text-emerald-600 dark:text-emerald-400" : "text-sky-600 dark:text-sky-400"}>
              {up ? "+" : "−"}{moneyBase(Math.abs(delta))}
              {pct != null ? ` (${pct > 0 ? "+" : ""}${pct}%)` : ""}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          <span className={e.automation ? "text-purple-600 dark:text-purple-400 font-medium" : ""}>{e.who}</span>
          {" · "}{formatWhen(e.at)} · {e.status}
        </p>
        {e.detail && <p className="text-[11px] text-muted-foreground">{e.detail}</p>}
        {e.extra && (
          <p className={`text-[11px] ${e.extra.different ? "text-destructive" : "text-muted-foreground"}`}>
            Requested {moneyBase(e.extra.requested)} · landed {moneyBase(e.extra.actual)}
            {e.extra.requested !== e.extra.actual ? ` · difference ${moneyBase((e.extra.actual ?? 0) - (e.extra.requested ?? 0))}` : ""}
          </p>
        )}
      </div>
    );
  };

  const shown = entries.slice(0, 3);
  const rest = entries.length - shown.length;
  return (
    <div className="space-y-1.5">
      {sendingPrice != null && draftPrice == null && (
        <p className="text-[11px] text-primary">{moneyBase(sendingPrice)} — sending to Previo now, already applied here</p>
      )}
      {draftPrice != null && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">{moneyBase(draftPrice)} — waiting to be sent</p>
      )}
      {shown.map((e) => block(e))}
      {showAll && entries.slice(3).map((e) => block(e))}
      {rest > 0 && (
        <button
          type="button"
          className="text-[11px] text-primary underline underline-offset-2"
          onClick={(ev) => { ev.stopPropagation(); setShowAll((v) => !v); }}
        >
          {showAll ? "Show less" : `${rest} more change${rest === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}
