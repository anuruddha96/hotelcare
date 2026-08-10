import { useState } from "react";
import { formatWhen, type RateAuditRow } from "@/lib/rateAudit";
import { moneyBase } from "@/lib/revenueCurrency";

const SOURCE_TAIL: Record<string, string> = {
  push: "sent to Previo",
  "day-tool": "day tool",
  "cell-edit": "single price",
  demand: "demand grading",
  autopilot: "autopilot",
};

/**
 * One compact line telling the story of a price cell:
 * "Yesterday 18:12 · Nuwan · €111 → €123 (+€12, +11%) · sent to Previo".
 * Older changes stay hidden behind a "N more changes" toggle.
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
      ? <p className="text-[11px] text-muted-foreground">draft — not sent yet</p>
      : <p className="text-[11px] text-muted-foreground">No price changes recorded yet.</p>;
  }

  const line = (r: RateAuditRow) => {
    const who = (r.performed_by && names.get(r.performed_by)) || "Someone";
    const delta = r.delta_eur;
    const pct = r.payload?.percent;
    const up = (delta ?? 0) >= 0;
    return (
      <div key={r.id} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] tabular-nums">
        <span className="font-medium">{formatWhen(r.performed_at)}</span>
        <span className="text-muted-foreground">· {who} ·</span>
        <span>{moneyBase(r.old_rate_eur)} → <strong>{moneyBase(r.new_rate_eur)}</strong></span>
        {delta != null && (
          <span className={up ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
            ({up ? "+" : ""}{moneyBase(delta)}{pct != null ? `, ${pct > 0 ? "+" : ""}${pct}%` : ""})
          </span>
        )}
        <span className="text-muted-foreground">· {SOURCE_TAIL[r.source ?? ""] ?? r.source ?? "change"}</span>
      </div>
    );
  };

  const rest = history.length - 1;
  return (
    <div className="space-y-1">
      {draftPrice != null && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">draft {moneyBase(draftPrice)} — not sent yet</p>
      )}
      {line(history[0])}
      {showAll && history.slice(1).map(line)}
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
