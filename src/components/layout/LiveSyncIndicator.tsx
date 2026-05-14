import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Radio, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLiveSync, type TaskName } from "@/contexts/LiveSyncContext";
import { cn } from "@/lib/utils";

const TASK_LABELS: Record<TaskName, string> = {
  pms: "PMS rooms",
  revenue: "Revenue rates",
};

export function LiveSyncIndicator() {
  const { enabled, tasks, refresh } = useLiveSync();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  const taskList = (Object.keys(tasks) as TaskName[]).map((k) => ({ key: k, ...tasks[k] }));
  const anySyncing = taskList.some((t) => t.status === "syncing");
  const anyError = taskList.some((t) => t.status === "error");
  const anyPartial = taskList.some((t) => t.status === "partial");
  const lastAt = taskList
    .map((t) => t.lastAt?.getTime() ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);

  let label: string;
  let dotClass: string;
  let Icon = Radio;
  let pillClass = "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400";
  if (anySyncing) {
    label = "Syncing…";
    Icon = Loader2;
    dotClass = "bg-primary animate-pulse";
    pillClass = "border-primary/30 bg-primary/5 text-primary";
  } else if (anyError) {
    label = "Sync failed";
    Icon = XCircle;
    dotClass = "bg-destructive";
    pillClass = "border-destructive/30 bg-destructive/5 text-destructive";
  } else if (anyPartial) {
    label = "Partial sync";
    Icon = AlertTriangle;
    dotClass = "bg-amber-500";
    pillClass = "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400";
  } else if (lastAt > 0) {
    label = `Live · ${formatDistanceToNow(new Date(lastAt))} ago`;
    Icon = CheckCircle2;
    dotClass = "bg-emerald-500";
  } else {
    label = "Live · ready";
    dotClass = "bg-muted-foreground/50";
    pillClass = "border-border bg-muted/30 text-muted-foreground";
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "hidden md:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-90",
            pillClass,
          )}
        >
          <span className="relative flex h-2 w-2">
            <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-60", anySyncing ? "animate-ping" : "", dotClass)} />
            <span className={cn("relative inline-flex h-2 w-2 rounded-full", dotClass)} />
          </span>
          <Icon className={cn("h-3.5 w-3.5", anySyncing ? "animate-spin" : "")} />
          <span className="whitespace-nowrap">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="px-2 pt-1 pb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">Live data sync</div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 gap-1"
            onClick={() => void refresh()}
            disabled={anySyncing}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", anySyncing ? "animate-spin" : "")} />
            <span className="text-xs">Refresh all</span>
          </Button>
        </div>
        <div className="space-y-1">
          {taskList.map((t) => {
            const isSync = t.status === "syncing";
            const isErr = t.status === "error";
            const isPartial = t.status === "partial";
            const TaskIcon = isSync
              ? Loader2
              : isErr
              ? XCircle
              : isPartial
              ? AlertTriangle
              : t.lastAt
              ? CheckCircle2
              : Radio;
            const colorClass = isSync
              ? "text-primary"
              : isErr
              ? "text-destructive"
              : isPartial
              ? "text-amber-600"
              : t.lastAt
              ? "text-emerald-600"
              : "text-muted-foreground";
            return (
              <div
                key={t.key}
                className="flex items-center justify-between gap-2 rounded-md border bg-background/40 px-2 py-1.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <TaskIcon className={cn("h-3.5 w-3.5 shrink-0", colorClass, isSync ? "animate-spin" : "")} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{TASK_LABELS[t.key]}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {isSync
                        ? "syncing…"
                        : t.lastAt
                        ? `${formatDistanceToNow(t.lastAt)} ago`
                        : "not synced yet"}
                      {isErr && t.message ? ` · ${t.message}` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {t.key === "pms" && t.meta?.checkouts != null && (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {t.meta.checkouts} checkouts
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={() => void refresh(t.key)}
                    disabled={isSync}
                    title="Refresh"
                  >
                    <RefreshCw className={cn("h-3 w-3", isSync ? "animate-spin" : "")} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
