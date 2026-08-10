import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, Loader2, RefreshCw, ArrowUp, ArrowDown } from "lucide-react";
import { moneyBase, useRevenueCurrency } from "@/lib/revenueCurrency";
import { useRateAudit } from "@/hooks/useRateAudit";
import type { RateAuditRow } from "@/lib/rateAudit";

function dayHeading(iso: string): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC", day: "numeric", month: "short",
  });
}

interface Batch {
  id: string;
  at: string;
  by: string;
  sent: boolean;
  rows: RateAuditRow[];
}

/**
 * "What did we do to prices?" — one plain sentence per action a person took,
 * grouped under Today / Yesterday / date, with the detail one click away.
 */
export default function RateActivityPanel({ hotelId, embedded }: { hotelId?: string | null; embedded?: boolean }) {
  useRevenueCurrency();
  const [includeSystem, setIncludeSystem] = useState(false);
  const { rows, names, loading, systemCount, reload } = useRateAudit(hotelId, 400, includeSystem);
  const [expanded, setExpanded] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, Batch>();
    for (const r of rows) {
      const id = r.payload?.batch_id ?? r.id;
      const existing = map.get(id);
      if (existing) { existing.rows.push(r); continue; }
      map.set(id, {
        id,
        at: r.performed_at,
        by: (r.performed_by && names.get(r.performed_by)) || "Someone",
        sent: r.source === "push",
        rows: [r],
      });
    }
    const batches = Array.from(map.values()).slice(0, 80);
    const byDay: Array<{ heading: string; items: Batch[] }> = [];
    for (const b of batches) {
      const h = dayHeading(b.at);
      const last = byDay[byDay.length - 1];
      if (last && last.heading === h) last.items.push(b);
      else byDay.push({ heading: h, items: [b] });
    }
    return byDay;
  }, [rows, names]);

  const Wrapper = embedded ? "div" : Card;
  const Head = embedded ? "div" : CardHeader;
  const Body = embedded ? "div" : CardContent;

  return (
    <Wrapper>
      <Head className={embedded ? "space-y-1 pb-3" : "pb-3"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!embedded && (
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Price activity
            </CardTitle>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7 ml-auto" aria-label="Reload activity" onClick={() => void reload()}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Everything people changed, newest first. Tap a line to see the exact dates and room types.
        </p>
      </Head>
      <Body className="space-y-4">
        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : "No price changes yet. Anything you change in the calendar shows up here."}
          </p>
        )}

        {groups.map((g) => (
          <div key={g.heading} className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.heading}</p>
            {g.items.map((b) => {
              const deltas = b.rows.map((r) => r.delta_eur).filter((d): d is number => d != null);
              const avg = deltas.length ? deltas.reduce((a, c) => a + c, 0) / deltas.length : 0;
              const up = avg > 0;
              const dates = Array.from(new Set(b.rows.map((r) => r.stay_date).filter(Boolean))).sort() as string[];
              const span = dates.length === 0 ? "" :
                dates.length === 1 ? shortDate(dates[0]) : `${shortDate(dates[0])}–${shortDate(dates[dates.length - 1])}`;
              const single = b.rows.length === 1 ? b.rows[0] : null;
              const verb = avg === 0 ? "changed" : up ? "raised" : "lowered";
              const open = expanded === b.id;
              return (
                <div key={b.id} className="rounded-lg border">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/40"
                    onClick={() => setExpanded(open ? null : b.id)}
                  >
                    <span className="tabular-nums text-muted-foreground w-11 shrink-0">{clock(b.at)}</span>
                    {avg !== 0 && (up
                      ? <ArrowUp className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      : <ArrowDown className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />)}
                    <span className="min-w-0 flex-1 truncate">
                      <strong className="font-medium">{b.by}</strong> {verb}{" "}
                      {single
                        ? `${single.payload?.room_type_name ?? "a room type"}, ${span}`
                        : `${b.rows.length} prices for ${span}`}
                      {single
                        ? <span className="text-muted-foreground"> · {moneyBase(single.old_rate_eur)} → {moneyBase(single.new_rate_eur)}</span>
                        : deltas.length > 0 && (
                            <span className="text-muted-foreground">
                              {" "}· avg {up ? "+" : "−"}{moneyBase(Math.abs(Math.round(avg)))}
                            </span>
                          )}
                    </span>
                    <Badge variant={b.sent ? "default" : "secondary"} className="shrink-0 font-normal">
                      {b.sent ? "Sent to Previo" : "Draft"}
                    </Badge>
                  </button>
                  {open && (
                    <div className="max-h-56 overflow-y-auto border-t px-3 py-2 space-y-1 text-[11px]">
                      {b.rows.map((r) => (
                        <div key={r.id} className="flex justify-between gap-2 tabular-nums">
                          <span className="truncate">
                            {r.stay_date ? shortDate(r.stay_date) : "—"} · {r.payload?.room_type_name ?? "—"}
                            {r.payload?.occupancy != null ? ` · ${r.payload.occupancy} guests` : ""}
                          </span>
                          <span className="whitespace-nowrap">
                            {moneyBase(r.old_rate_eur)} → <strong>{moneyBase(r.new_rate_eur)}</strong>
                            {r.payload?.percent != null && (
                              <span className={r.payload.percent >= 0 ? "text-emerald-600 dark:text-emerald-400 ml-1" : "text-sky-600 dark:text-sky-400 ml-1"}>
                                {r.payload.percent > 0 ? "+" : ""}{r.payload.percent}%
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {(systemCount > 0 || includeSystem) && (
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline underline-offset-2"
            onClick={() => setIncludeSystem((v) => !v)}
          >
            {includeSystem ? "Hide system entries" : "Show system entries"}
          </button>
        )}
      </Body>
    </Wrapper>
  );
}
