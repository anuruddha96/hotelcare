import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { runPmsRefresh, type ProposedRoomChange } from "@/lib/pmsRefresh";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight, CheckCircle2, ClipboardList, History, Loader2, LogOut,
  RefreshCw, Search, Users,
} from "lucide-react";

interface Props {
  hotelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;
}

const CATEGORY_META: Record<string, { color: string; icon: any; label: string }> = {
  status:    { color: "bg-amber-500/15 text-amber-700 dark:text-amber-300",     icon: RefreshCw,    label: "Status" },
  occupancy: { color: "bg-blue-500/15 text-blue-700 dark:text-blue-300",         icon: Users,        label: "Occupancy" },
  checkout:  { color: "bg-rose-500/15 text-rose-700 dark:text-rose-300",         icon: LogOut,       label: "Checkout" },
  guest:     { color: "bg-blue-500/15 text-blue-700 dark:text-blue-300",         icon: Users,        label: "Guests" },
  note:      { color: "bg-slate-500/15 text-slate-700 dark:text-slate-300",      icon: ClipboardList,label: "Note" },
  linen:     { color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",icon: RefreshCw,    label: "Linen" },
};

export function PmsRefreshPreviewDialog({ hotelId, open, onOpenChange, onApplied }: Props) {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [proposed, setProposed] = useState<ProposedRoomChange[]>([]);
  const [unmapped, setUnmapped] = useState<Array<{ pms_room_id: string; pms_room_name: string; room_kind_name: string; extracted_number: string }>>([]);
  const [filter, setFilter] = useState("");
  const [showOnlyChanges, setShowOnlyChanges] = useState(true);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [tab, setTab] = useState<"preview" | "history">("preview");

  const dryRun = async () => {
    setLoading(true);
    setProposed([]);
    try {
      const res = await runPmsRefresh(hotelId, { dryRun: true });
      setProposed(res.proposedChanges ?? []);
      setUnmapped(res.unmapped ?? []);
    } catch (e: any) {
      toast.error(`PMS preview failed: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    const { data } = await (supabase as any)
      .from("pms_change_events")
      .select("id, room_label, event_type, source, before, after, is_conflict, detected_at, acknowledged_at, resolution")
      .eq("hotel_id", hotelId)
      .order("detected_at", { ascending: false })
      .limit(200);
    setHistory((data as any[]) ?? []);
    setHistoryLoading(false);
  };

  useEffect(() => {
    if (!open) return;
    void dryRun();
    void loadHistory();
     
  }, [open, hotelId]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return proposed.filter((p) => {
      if (showOnlyChanges && !p.isNewChange) return false;
      if (!q) return true;
      return p.roomLabel.toLowerCase().includes(q);
    });
  }, [proposed, filter, showOnlyChanges]);

  const changeCount = proposed.filter((p) => p.isNewChange).length;

  const apply = async () => {
    setApplying(true);
    try {
      const res = await runPmsRefresh(hotelId, { dryRun: false });
      toast.success(`PMS refresh complete — ${res.updated} updated, ${res.checkouts} checkouts, ${res.notFound} unmapped`);
      onApplied?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`PMS refresh failed: ${e?.message ?? e}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            PMS refresh preview
            {changeCount > 0 && (
              <Badge variant="secondary" className="ml-2">{changeCount} change{changeCount === 1 ? "" : "s"}</Badge>
            )}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Preview every room's proposed change from Previo before writing to the app.
            Rooms departing tomorrow are surfaced ahead of time.
          </p>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 min-h-0 flex flex-col">
          <div className="px-6 pt-3">
            <TabsList>
              <TabsTrigger value="preview" className="gap-1"><ClipboardList className="h-3.5 w-3.5" /> Preview</TabsTrigger>
              <TabsTrigger value="history" className="gap-1"><History className="h-3.5 w-3.5" /> History</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="preview" className="flex-1 min-h-0 flex flex-col mt-2">
            <div className="px-6 py-2 flex items-center gap-2 border-b bg-muted/30">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="pl-7 h-8 text-sm"
                  placeholder="Filter by room…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              <Button
                variant={showOnlyChanges ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => setShowOnlyChanges((v) => !v)}
              >
                {showOnlyChanges ? "Changes only" : "All rooms"}
              </Button>
              <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs ml-auto"
                onClick={() => void dryRun()} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Re-check
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-3 space-y-2">
              {unmapped.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                  <div className="font-semibold text-amber-900 dark:text-amber-200 mb-1">
                    {unmapped.length} Previo room{unmapped.length === 1 ? "" : "s"} not yet linked to a HotelCare room
                  </div>
                  <div className="text-amber-900/80 dark:text-amber-200/80 mb-2">
                    These rooms exist in Previo but couldn't be auto-matched by number. Ask an admin to map
                    them in <strong>Admin → PMS Configuration → Room Mappings</strong> (use the Previo IDs below).
                  </div>
                  <div className="space-y-0.5 font-mono text-[11px]">
                    {unmapped.slice(0, 12).map((u) => (
                      <div key={u.pms_room_id} className="flex gap-2">
                        <span className="text-muted-foreground">#{u.pms_room_id}</span>
                        <span className="font-semibold">{u.pms_room_name}</span>
                        <span className="text-muted-foreground truncate">{u.room_kind_name}</span>
                      </div>
                    ))}
                    {unmapped.length > 12 && (
                      <div className="text-muted-foreground">…and {unmapped.length - 12} more</div>
                    )}
                  </div>
                </div>
              )}
              {loading && (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Computing diff from Previo…
                </div>
              )}
              {!loading && filtered.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-10">
                  {proposed.length === 0
                    ? "No rooms returned from Previo."
                    : "No changes to apply. Your app already matches the PMS."}
                </div>
              )}
              {!loading && filtered.map((p) => (
                <div key={p.roomKey}
                  className={`rounded-md border p-3 ${p.isNewChange ? "bg-background" : "bg-muted/30 opacity-70"}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="font-semibold text-sm">Room {p.roomLabel}</div>
                    {!p.isNewChange && (
                      <Badge variant="outline" className="h-5 text-[10px] gap-1">
                        <CheckCircle2 className="h-3 w-3" /> No change
                      </Badge>
                    )}
                    {p.raw.row?.IsCheckoutRoom && (
                      <Badge variant="destructive" className="h-5 text-[10px]">Checkout room</Badge>
                    )}
                    {p.raw.row?.DepartureTomorrow && (
                      <Badge className="h-5 text-[10px] bg-amber-500 hover:bg-amber-600">Departs tomorrow</Badge>
                    )}
                    {p.raw.row?.Occupied === "Yes" && !p.raw.row?.Departure && !p.raw.row?.DepartureTomorrow && (
                      <Badge variant="secondary" className="h-5 text-[10px]">Occupied</Badge>
                    )}
                  </div>
                  {p.fields.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      Status: {p.raw.currentStatus ?? "?"} · Guests: {p.raw.currentGuestCount ?? 0}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {p.fields.map((f, i) => {
                        const meta = CATEGORY_META[f.category];
                        const Icon = meta.icon;
                        return (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${meta.color}`}>
                              <Icon className="h-3 w-3" /> {f.field}
                            </span>
                            <span className="font-mono text-muted-foreground truncate">
                              {String(f.before)}
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="font-mono font-medium truncate">
                              {String(f.after)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="history" className="flex-1 min-h-0 mt-2 overflow-y-auto px-6 py-3">
            {historyLoading && (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading history…
              </div>
            )}
            {!historyLoading && history.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-10">
                No previous PMS refresh events recorded for this hotel yet.
              </div>
            )}
            {!historyLoading && history.length > 0 && (
              <div className="space-y-2">
                {history.map((e) => (
                  <div key={e.id} className="rounded-md border p-3 text-xs">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="font-medium text-sm">
                        Room {e.room_label || "?"} · {String(e.event_type).replace(/_/g, " ")}
                      </div>
                      <div className="text-muted-foreground">
                        {formatDistanceToNow(new Date(e.detected_at))} ago
                      </div>
                    </div>
                    {(e.before || e.after) && (
                      <div className="font-mono text-muted-foreground break-all">
                        {JSON.stringify(e.before)} → {JSON.stringify(e.after)}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="h-5 text-[10px]">{e.source}</Badge>
                      {e.is_conflict && !e.acknowledged_at && (
                        <Badge variant="destructive" className="h-5 text-[10px]">Needs approval</Badge>
                      )}
                      {e.acknowledged_at && (
                        <Badge variant="secondary" className="h-5 text-[10px] gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {e.resolution || "resolved"}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="border-t px-6 py-3 flex items-center justify-between gap-2 bg-muted/30">
          <div className="text-xs text-muted-foreground">
            {proposed.length > 0 && (
              <>Total {proposed.length} rooms · {changeCount} pending change{changeCount === 1 ? "" : "s"}</>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={applying || loading || changeCount === 0}>
              {applying && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Apply {changeCount > 0 ? `${changeCount} change${changeCount === 1 ? "" : "s"}` : "changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
