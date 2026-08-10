import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, Loader2, RefreshCw, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { moneyBase, useRevenueCurrency } from "@/lib/revenueCurrency";
import { useRateAudit } from "@/hooks/useRateAudit";
import type { RateAuditRow } from "@/lib/rateAudit";

const SOURCE_LABEL: Record<string, string> = {
  "day-tool": "Day tool",
  "cell-edit": "Single price",
  demand: "Demand grading",
  push: "Sent to Previo",
  autopilot: "Autopilot",
};

const FILTERS = [
  { value: "all", label: "Everything" },
  { value: "drafted", label: "Drafted" },
  { value: "push", label: "Sent to Previo" },
] as const;

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface Batch {
  id: string;
  at: string;
  by: string;
  source: string;
  action: string;
  rows: RateAuditRow[];
}

/**
 * "What did we do to prices?" — every draft, day-tool run and Previo push,
 * grouped into the batch the user actually performed.
 */
export default function RateActivityPanel({ hotelId, embedded }: { hotelId?: string | null; embedded?: boolean }) {
  useRevenueCurrency();
  const [includeSystem, setIncludeSystem] = useState(false);
  const { rows, names, loading, systemCount, reload } = useRateAudit(hotelId, 400, includeSystem);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const batches = useMemo<Batch[]>(() => {
    const map = new Map<string, Batch>();
    for (const r of rows) {
      if (filter === "push" && r.source !== "push") continue;
      if (filter === "drafted" && r.source === "push") continue;
      const id = r.payload?.batch_id ?? r.id;
      const existing = map.get(id);
      if (existing) { existing.rows.push(r); continue; }
      map.set(id, {
        id,
        at: r.performed_at,
        by: (r.performed_by && names.get(r.performed_by)) || "Someone",
        source: r.source ?? "manual",
        action: r.action,
        rows: [r],
      });
    }
    return Array.from(map.values()).slice(0, 60);
  }, [rows, names, filter]);


  const Wrapper = embedded ? "div" : Card;
  const Head = embedded ? "div" : CardHeader;
  const Body = embedded ? "div" : CardContent;

  return (
    <Wrapper>
      <Head className={embedded ? "space-y-2 pb-3" : "pb-3"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!embedded && (
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Price activity
            </CardTitle>
          )}
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border overflow-hidden">
              {FILTERS.map((f) => (
                <Button
                  key={f.value}
                  size="sm"
                  variant={filter === f.value ? "default" : "ghost"}
                  className="h-7 rounded-none px-2 text-[11px]"
                  onClick={() => setFilter(f.value)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Reload activity" onClick={() => void reload()}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Every price you drafted or sent to Previo, newest first — who did it, when, and by how much.
        </p>
        {(systemCount > 0 || includeSystem) && (
          <button
            type="button"
            className="text-[11px] text-primary underline underline-offset-2"
            onClick={() => setIncludeSystem((v) => !v)}
          >
            {includeSystem
              ? "Hide automatic system entries"
              : `Also show ${systemCount.toLocaleString()} automatic system entries`}
          </button>
        )}
      </Head>
      <Body className="space-y-2">

        {batches.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : "No price changes recorded yet. Changes you make in the calendar show up here."}
          </p>
        )}
        {batches.map((b) => {
          const ups = b.rows.filter((r) => (r.delta_eur ?? 0) > 0).length;
          const downs = b.rows.filter((r) => (r.delta_eur ?? 0) < 0).length;
          const dates = Array.from(new Set(b.rows.map((r) => r.stay_date).filter(Boolean))).sort() as string[];
          const open = expanded === b.id;
          return (
            <div key={b.id} className="rounded-lg border">
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/40"
                onClick={() => setExpanded(open ? null : b.id)}
              >
                <Badge variant={b.source === "push" ? "default" : "secondary"} className="font-normal">
                  {SOURCE_LABEL[b.source] ?? b.source}
                </Badge>
                <span className="font-medium">
                  {b.rows.length} price{b.rows.length === 1 ? "" : "s"}
                </span>
                {ups > 0 && (
                  <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                    <ArrowUpRight className="h-3 w-3" />{ups}
                  </span>
                )}
                {downs > 0 && (
                  <span className="flex items-center gap-0.5 text-destructive">
                    <ArrowDownRight className="h-3 w-3" />{downs}
                  </span>
                )}
                <span className="text-muted-foreground truncate">
                  {dates.length === 1 ? dates[0] : `${dates[0]} → ${dates[dates.length - 1]}`}
                </span>
                <span className="ml-auto text-muted-foreground whitespace-nowrap">{b.by} · {when(b.at)}</span>
              </button>
              {open && (
                <div className="max-h-56 overflow-y-auto border-t px-3 py-2 space-y-1 text-[11px]">
                  {b.rows.map((r) => (
                    <div key={r.id} className="flex justify-between gap-2 tabular-nums">
                      <span className="truncate">
                        {r.stay_date} · {r.payload?.room_type_name} · {r.payload?.occupancy}g
                      </span>
                      <span className="whitespace-nowrap">
                        {moneyBase(r.old_rate_eur)} → <strong>{moneyBase(r.new_rate_eur)}</strong>
                        {r.payload?.percent !== null && r.payload?.percent !== undefined && (
                          <span className={r.payload.percent >= 0 ? "text-emerald-600 dark:text-emerald-400 ml-1" : "text-destructive ml-1"}>
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
      </Body>
    </Wrapper>

  );
}
