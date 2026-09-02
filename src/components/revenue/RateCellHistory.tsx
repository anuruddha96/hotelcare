import { useState } from "react";
import { formatWhen } from "@/lib/rateAudit";
import type { RateAuditRow } from "@/lib/rateAudit";
import { groupCellChanges, type LogicalChange } from "@/lib/rateChangeGroups";
import { moneyBase } from "@/lib/revenueCurrency";
import type { AutomationAction } from "@/hooks/usePickupAutomationActions";

function automationDetail(a: AutomationAction): string {
  if (a.reason_detail) {
    return [a.reason_detail, a.reservation_id ? `booking #${a.reservation_id}` : null, a.pickup_at ? `picked up ${formatWhen(a.pickup_at)}` : null].filter(Boolean).join(" · ");
  }
  return [
    a.reservation_id ? `Triggered by booking #${a.reservation_id}` : "Triggered by a new booking",
    a.pickup_at ? `picked up ${formatWhen(a.pickup_at)}` : null,
    a.pickup_sequence && a.pickup_sequence > 1 ? `${a.pickup_sequence}${a.pickup_sequence === 2 ? "nd" : a.pickup_sequence === 3 ? "rd" : "th"} booking in the window` : null,
    a.increase_amount != null ? `rule raised it by ${moneyBase(a.increase_amount)}` : null,
  ].filter(Boolean).join(" · ");
}

function dayBucket(at: string): string {
  const d = new Date(at);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function statusLine(entries: LogicalChange[], draftPrice?: number | null, sendingPrice?: number | null): { text: string; tone: string } {
  const latest = entries[0];
  const live = latest?.next ?? null;
  const now = live != null ? `${moneyBase(live)} now` : "No price recorded yet";
  if (draftPrice != null) return { text: `${now} · ${moneyBase(draftPrice)} waiting to be sent`, tone: "text-amber-600 dark:text-amber-400" };
  if (sendingPrice != null) return { text: `${now} · ${moneyBase(sendingPrice)} sent to Previo — confirming`, tone: "text-primary" };
  if (!latest) return { text: now, tone: "text-muted-foreground" };
  const who = latest.automation ? "automation" : latest.who;
  switch (latest.phase) {
    case "failed": return { text: `${now} · last change ${latest.statusLabel}`, tone: "text-destructive" };
    case "sending": return { text: `${now} · ${who} sent it — confirming in Previo`, tone: "text-primary" };
    case "confirmed": return { text: `${now} · confirmed in Previo · ${who}, ${formatWhen(latest.at)}`, tone: "text-muted-foreground" };
    default: return { text: `${now} · ${who} · ${latest.statusLabel}`, tone: "text-muted-foreground" };
  }
}

export default function RateCellHistory({ history, names, draftPrice, sendingPrice, automation = [], hold = null, expanded = false }: {
  history: RateAuditRow[];
  names: Map<string, string>;
  draftPrice?: number | null;
  sendingPrice?: number | null;
  automation?: AutomationAction[];
  hold?: AutomationAction | null;
  expanded?: boolean;
}) {
  const [showAll, setShowAll] = useState(expanded);
  const entries = groupCellChanges(history, automation, names, { automationDetail });
  const status = statusLine(entries, draftPrice, sendingPrice);

  // Previo is the authoritative live source. A successful read-back that differs
  // from HotelCare's request is synchronization history, not an alarm. The live
  // price is adopted by reconciliation; the next automation run can then repair
  // a bad ladder/floor/ceiling from that real PMS baseline.
  const latestPrevioDifference = [...(history ?? [])]
    .filter((row) => row.source === "previo_different")
    .sort((a, b) => b.performed_at.localeCompare(a.performed_at))[0] ?? null;
  const latestConfirmed = entries.find((entry) => entry.phase === "confirmed") ?? null;
  const differenceAlreadySuperseded = !!latestPrevioDifference && !!latestConfirmed
    && Date.parse(latestConfirmed.at) > Date.parse(latestPrevioDifference.performed_at);
  const authoritativeSyncNote = latestPrevioDifference && !latestPrevioDifference.payload?.resolved_at && !differenceAlreadySuperseded ? (
    <div className="rounded-md border border-sky-200 bg-sky-50/60 px-2.5 py-2 text-[11px] text-slate-700 dark:border-sky-500/20 dark:bg-sky-500/5 dark:text-slate-300">
      <span className="font-medium">Synced from Previo.</span>{" "}
      Previo returned the live rate, so HotelCare is adopting it as the current price. Automation will evaluate this confirmed PMS price on its next run and auto-heal the pricing ladder if required.
    </div>
  ) : null;

  const holdNote = hold && hold.hold_until && Date.parse(hold.hold_until) > Date.now() ? (
    <div className="rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
      <span className="font-medium">Waiting after a cancellation.</span>{" "}{hold.reason_detail ?? "The rule waits before lowering the price in case the room sells again."}{" "}
      Automation can lower this price from <span className="tabular-nums font-medium">{formatWhen(hold.hold_until)}</span>.
    </div>
  ) : null;

  if (entries.length === 0) return <div className="space-y-1"><p className={`text-[11px] ${status.tone}`}>{status.text}</p>{authoritativeSyncNote}{holdNote}<p className="text-[11px] text-muted-foreground">No price changes recorded for this room type and date yet.</p></div>;

  const block = (e: LogicalChange) => {
    const delta = e.old != null && e.next != null ? Math.round((e.next - e.old) * 100) / 100 : null;
    const pct = e.old && e.next != null && e.old !== 0 ? Math.round(((e.next - e.old) / e.old) * 1000) / 10 : null;
    const up = (delta ?? 0) >= 0;
    const failed = e.phase === "failed";
    return <div key={e.id} className="space-y-0.5 border-l-2 pl-2 border-border">
      <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs tabular-nums"><span>{moneyBase(e.old)} → <strong>{moneyBase(e.next)}</strong></span>{delta != null && delta !== 0 && <span className={up ? "text-emerald-600 dark:text-emerald-400" : "text-sky-600 dark:text-sky-400"}>{up ? "+" : "−"}{moneyBase(Math.abs(delta))}{pct != null ? ` (${pct > 0 ? "+" : ""}${pct}%)` : ""}</span>}</div>
      <p className="text-[11px] text-muted-foreground"><span className={e.automation ? "text-purple-600 dark:text-purple-400 font-medium" : "text-sky-600 dark:text-sky-400 font-medium"}>{e.who}</span>{" · "}{formatWhen(e.at)} · <span className={failed ? "text-destructive" : ""}>{e.statusLabel}</span></p>
      {e.detail && <p className="text-[11px] text-muted-foreground">{e.detail}</p>}
      {e.extra && <p className="text-[11px] text-muted-foreground">Requested {moneyBase(e.extra.requested)} · Previo live {moneyBase(e.extra.actual)}{e.extra.requested !== e.extra.actual ? " · adopted as authoritative PMS price" : ""}</p>}
    </div>;
  };

  const limit = expanded ? entries.length : (showAll ? entries.length : 3);
  const shown = entries.slice(0, limit);
  const rest = entries.length - shown.length;
  let lastBucket: string | null = null;

  return <div className="space-y-2">
    <p className={`text-xs font-medium ${status.tone}`}>{status.text}</p>
    {authoritativeSyncNote}{holdNote}
    <div className="space-y-2">{shown.map((e) => { const bucket = dayBucket(e.at); const heading = bucket !== lastBucket ? bucket : null; lastBucket = bucket; return <div key={e.id} className="space-y-1">{heading && <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{heading}</p>}{block(e)}</div>; })}</div>
    {!expanded && rest > 0 && <button type="button" className="text-[11px] text-primary underline underline-offset-2" onClick={(ev) => { ev.stopPropagation(); setShowAll((v) => !v); }}>{showAll ? "Show less" : `${rest} more change${rest === 1 ? "" : "s"}`}</button>}
  </div>;
}
