import { useState } from "react";
import { formatWhen, type RateAuditRow } from "@/lib/rateAudit";
import { moneyBase } from "@/lib/revenueCurrency";

/**
 * The story of one price cell in a single readable block:
 *
 *   €111 → €123   +€12 (+11%)
 *   Yesterday 18:12 · Nuwan · Sent to Previo
 *
 * Older changes stay behind a "N more changes" toggle.
 */
export default function RateCellHistory({
  history,
  names,
  draftPrice,
}: {
  history: RateAuditRow[];
  names: Map<string, string>;
  draftPrice?: number | null;
}) {
  const [showAll, setShowAll] = useState(false);
  if (history.length === 0) {
    return draftPrice != null
      ? <p className="text-[11px] text-muted-foreground">Draft {moneyBase(draftPrice)} — not sent yet</p>
      : <p className="text-[11px] text-muted-foreground">No price changes yet.</p>;
  }

  const block = (r: RateAuditRow, key: string) => {
    const who = (r.performed_by && names.get(r.performed_by)) || "Someone";
    const delta = r.delta_eur;
    const pct = r.payload?.percent;
    const up = (delta ?? 0) >= 0;
    const requested = r.payload?.requested_price;
    const actual = r.payload?.actual_previo_price;
    const status = r.payload?.confirmation_status;
    const statusLabel = status === "confirmed"
      ? "Confirmed in Previo"
      : status === "different"
        ? "Different in Previo"
        : r.source === "previo_external"
          ? "Changed in Previo"
          : r.source === "push" ? "Sent — awaiting Previo sync" : "Draft";
    return (
      <div key={key} className="space-y-0.5">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs tabular-nums">
          <span>{moneyBase(r.old_rate_eur)} → <strong>{moneyBase(r.new_rate_eur)}</strong></span>
          {delta != null && delta !== 0 && (
            <span className={up ? "text-emerald-600 dark:text-emerald-400" : "text-sky-600 dark:text-sky-400"}>
              {up ? "+" : "−"}{moneyBase(Math.abs(delta))}
              {pct != null ? ` (${pct > 0 ? "+" : ""}${pct}%)` : ""}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {formatWhen(r.performed_at)} · {who} · {statusLabel}
        </p>
        {requested != null && actual != null && (
          <p className={`text-[11px] ${status === "different" ? "text-destructive" : "text-muted-foreground"}`}>
            Requested {moneyBase(requested)} · landed {moneyBase(actual)}
            {requested !== actual ? ` · difference ${moneyBase(actual - requested)}` : ""}
          </p>
        )}
      </div>
    );
  };

  const rest = history.length - 1;
  return (
    <div className="space-y-1.5">
      {draftPrice != null && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">Draft {moneyBase(draftPrice)} — not sent yet</p>
      )}
      {block(history[0], history[0].id)}
      {showAll && history.slice(1).map((r) => block(r, r.id))}
      {rest > 0 && (
        <button
          type="button"
          className="text-[11px] text-primary underline underline-offset-2"
          onClick={(e) => { e.stopPropagation(); setShowAll((v) => !v); }}
        >
          {showAll ? "Show less" : `${rest} more change${rest === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}
