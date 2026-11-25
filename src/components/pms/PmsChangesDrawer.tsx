import { useLocaleFormat } from '@/lib/i18n/localeFormat';
import { useTranslation } from '@/hooks/useTranslation';
import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, Info, LogOut, RefreshCw, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";

export interface PmsChangeEvent {
  id: string;
  hotel_id: string;
  room_id: string | null;
  room_label: string | null;
  event_type: string;
  source: string;
  before: any;
  after: any;
  is_conflict: boolean;
  conflicts_with_assignment_id: string | null;
  detected_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolution: string | null;
  category?: "safe" | "risky" | "noop" | null;
  change_kind?: string | null;
  auto_applied?: boolean | null;
  notes?: string | null;
}

const TYPE_META: Record<string, { icon: any; label: string }> = {
  checkout_confirmed: { icon: LogOut, label: t('pms.pmsChanges.checkoutConfirmed') },
  checkout_cleared:   { icon: Info,    label: t('pms.pmsChanges.checkoutCleared') },
  status_changed:     { icon: RefreshCw, label: t('pms.pmsChanges.roomStatusChanged') },
  occupancy_changed:  { icon: Users,   label: t('pms.pmsChanges.guestCountChanged') },
  room_newly_occupied:{ icon: UserCheck, label: t('pms.pmsChanges.newlyOccupied') },
};

interface Props {
  hotelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PmsChangesDrawer({ hotelId, open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const locale = useLocaleFormat();
  const [events, setEvents] = useState<PmsChangeEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!hotelId) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("pms_change_events")
      .select("*")
      .eq("hotel_id", hotelId)
      .order("detected_at", { ascending: false })
      .limit(200);
    setLoading(false);
    if (error) {
      toast.error(`${t('pms.pmsChanges.loadFailed')} ${error.message}`);
      return;
    }
    setEvents((data as any[]) ?? []);
  };

  useEffect(() => { if (open) void load(); }, [open, hotelId]);

  const grouped = useMemo(() => {
    const conflicts = events.filter((e) => e.is_conflict && !e.acknowledged_at);
    const updates = events.filter((e) => !e.is_conflict && !e.acknowledged_at);
    const resolved = events.filter((e) => !!e.acknowledged_at);
    return { conflicts, updates, resolved };
  }, [events]);

  const resolve = async (evt: PmsChangeEvent, resolution: string, releaseHold = true) => {
    const { error: e1 } = await (supabase as any)
      .from("pms_change_events")
      .update({
        acknowledged_at: new Date().toISOString(),
        resolution,
      })
      .eq("id", evt.id);
    if (e1) { toast.error(e1.message); return; }
    if (releaseHold && evt.conflicts_with_assignment_id) {
      await supabase
        .from("room_assignments")
        .update({ pms_hold: false, pms_hold_reason: null, pms_hold_event_id: null, updated_at: new Date().toISOString() } as any)
        .eq("id", evt.conflicts_with_assignment_id);
    }
    toast.success(t('pms.pmsChanges.acknowledged'));
    setEvents((prev) => prev.map((e) => e.id === evt.id ? { ...e, acknowledged_at: new Date().toISOString(), resolution } : e));
  };

  const row = (evt: PmsChangeEvent) => {
    const meta = TYPE_META[evt.event_type] || { icon: Info, label: evt.event_type };
    const Icon = meta.icon;
    return (
      <div key={evt.id} className="rounded-md border p-3 flex flex-col gap-2 bg-background/40">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className={`h-4 w-4 shrink-0 ${evt.is_conflict ? "text-destructive" : "text-muted-foreground"}`} />
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">
                {t('common.room')} {evt.room_label || "?"} · {t(({checkout_confirmed:'pms.pmsChanges.checkoutConfirmed',checkout_cleared:'pms.pmsChanges.checkoutCleared',status_changed:'pms.pmsChanges.roomStatusChanged',occupancy_changed:'pms.pmsChanges.guestCountChanged',room_newly_occupied:'pms.pmsChanges.newlyOccupied'} as Record<string,string>)[evt.event_type] ?? 'labels.other')}
                {evt.change_kind && <span className="text-muted-foreground font-normal"> · {evt.change_kind.replace(/_/g, " ")}</span>}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(evt.detected_at), { locale: locale.dateFnsLocale, addSuffix: true })} · {evt.source}
              </div>
            </div>
          </div>
          {evt.is_conflict && !evt.acknowledged_at && (
            <Badge variant="destructive" className="h-5 text-[10px]">{t('pms.pmsChanges.approval')}</Badge>
          )}
          {evt.category === "safe" && evt.auto_applied && (
            <Badge variant="secondary" className="h-5 text-[10px]">{t('pms.pmsChanges.autoApplied')}</Badge>
          )}
          {evt.category === "safe" && !evt.auto_applied && !evt.acknowledged_at && (
            <Badge variant="outline" className="h-5 text-[10px]">{t('pms.pmsChanges.safe')}</Badge>
          )}
          {evt.acknowledged_at && (
            <Badge variant="outline" className="h-5 text-[10px] gap-1">
              <CheckCircle2 className="h-3 w-3" /> {t(({released:'pms.pmsChanges.released',kept_as_stayover:'pms.pmsChanges.kept',dismissed:'pms.pmsChanges.dismissed'} as Record<string,string>)[evt.resolution || ''] ?? 'pms.pmsChanges.resolvedLower')}
            </Badge>
          )}
        </div>
        {(evt.before || evt.after) && (
          <div className="text-[11px] text-muted-foreground font-mono">
            {JSON.stringify(evt.before)} → {JSON.stringify(evt.after)}
          </div>
        )}
        {!evt.acknowledged_at && (
          <div className="flex flex-wrap gap-1.5">
            {evt.conflicts_with_assignment_id && (
              <>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => resolve(evt, "released")}
                >{t('pms.pmsChanges.release')}</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => resolve(evt, "kept_as_stayover", true)}
                >{t('pms.pmsChanges.keep')}</Button>
              </>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-xs"
              onClick={() => resolve(evt, "dismissed")}
            >{t('common.dismiss')}</Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-2 border-b">
          <SheetTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {t('pms.pmsChanges.title')}
            <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 gap-1" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              <span className="text-xs">{t('pms.pmsChanges.reload')}</span>
            </Button>
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-4">
            {grouped.conflicts.length > 0 && (
              <section>
                <div className="text-xs font-semibold text-destructive uppercase tracking-wide mb-2">
                  {t('pms.pmsChanges.conflicts')} ({grouped.conflicts.length})
                </div>
                <div className="space-y-2">{grouped.conflicts.map(row)}</div>
              </section>
            )}
            {grouped.updates.length > 0 && (
              <section>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  {t('pms.pmsChanges.updates')} ({grouped.updates.length})
                </div>
                <div className="space-y-2">{grouped.updates.map(row)}</div>
              </section>
            )}
            {grouped.resolved.length > 0 && (
              <section>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  {t('pms.pmsChanges.resolved')} ({grouped.resolved.length})
                </div>
                <div className="space-y-2 opacity-70">{grouped.resolved.slice(0, 30).map(row)}</div>
              </section>
            )}
            {!loading && events.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-10">
                {t('pms.pmsChanges.empty')}
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
