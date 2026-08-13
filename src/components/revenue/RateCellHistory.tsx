import { useState } from "react";
import { formatWhen } from "@/lib/rateAudit";
import type { RateAuditRow } from "@/lib/rateAudit";
import { groupCellChanges, type LogicalChange } from "@/lib/rateChangeGroups";
import { moneyBase } from "@/lib/revenueCurrency";
import type { AutomationAction } from "@/hooks/usePickupAutomationActions";

/**
 * The story of one price cell in a single readable block:
 *
 *   €111 → €123   +€12 (+11%)
 *   Yesterday 18:12 · Nuwan · confirmed in Previo
 *
 * One publish writes a draft row, a push row and a Previo read-back row — they
 * are stages of the SAME change, so they are folded into one entry showing only
 * the furthest state it reached. Moves made by the pickup automation tool are
 * merged in with the booking that triggered them. Older changes stay behind a
 * "N more changes" toggle, counted as distinct changes rather than raw rows.
 */

function automationDetail(a: AutomationAction): string {
  return [
    a.reservation_id ? `Triggered by booking #${a.reservation_id}` : "Triggered by a new booking",
    a.pickup_at ? `picked up ${formatWhen(a.pickup_at)}` : null,
    a.pickup_sequence && a.pickup_sequence > 1
      ? `${a.pickup_sequence}${a.pickup_sequence === 2 ? "nd" : a.pickup_sequence === 3 ? "rd" : "th"} booking in the window`
      : null,
    a.increase_amount != null ? `rule raised it by ${moneyBase(a.increase_amount)}` : null,
  ].filter(Boolean).join(" · ");
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
  /** Genuinely unsent, still actionable. Refused/abandoned rows must not land here. */
  draftPrice?: number | null;
  /** Already sent to Previo, waiting only for its read-back. */
  sendingPrice?: number | null;
  automation?: AutomationAction[];
}) {
  const [showAll, setShowAll] = useState(false);

  const entries = groupCellChanges(history, automation, names, { automationDetail });

  if (entries.length === 0) {
    if (sendingPrice != null) {
      return <p className="text-[11px] text-primary">{moneyBase(sendingPrice)} — sending to Previo now</p>;
    }
    return draftPrice != null
      ? <p className="text-[11px] text-muted-foreground">{moneyBase(draftPrice)} — waiting to be sent</p>
      : <p className="text-[11px] text-muted-foreground">No price changes yet.</p>;
  }

  const block = (e: LogicalChange) => {
    const delta = e.old != null && e.next != null ? Math.round((e.next - e.old) * 100) / 100 : null;
    const pct = e.old && e.next != null && e.old !== 0
      ? Math.round(((e.next - e.old) / e.old) * 1000) / 10
      : null;
    const up = (delta ?? 0) >= 0;
    const failed = e.phase === "failed";
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
          {" · "}{formatWhen(e.at)} · <span className={failed ? "text-destructive" : ""}>{e.statusLabel}</span>
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
