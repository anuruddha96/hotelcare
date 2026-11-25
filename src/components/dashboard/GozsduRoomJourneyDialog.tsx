import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

type JourneyRow = { at: string; title: string; detail: string; source: string };
type Props = {
  open: boolean; onOpenChange: (open: boolean) => void; roomId: string | null;
  roomName: string; selectedDate: string; currentBucket: string;
};
const stampLabel = (stamp: string) => {
  const value = Date.parse(stamp);
  return Number.isFinite(value)
    ? new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/Budapest', dateStyle: 'medium', timeStyle: 'short' })
    : stamp;
};
const textValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '—';
  return String(value);
};

/** Read-only dated booking and housekeeping evidence; no PMS or assignment writes. */
export function GozsduRoomJourneyDialog({ open, onOpenChange, roomId, roomName, selectedDate, currentBucket }: Props) {
  const [items, setItems] = useState<JourneyRow[]>([]);
  const [issue, setIssue] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !roomId) return;
    let cancelled = false;
    setLoading(true);
    setIssue(null);
    const start = new Date(Date.parse(`${selectedDate}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
    const nextDay = new Date(Date.parse(`${selectedDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const load = async () => {
      try {
        const [history, overview, transitions] = await Promise.all([
          (supabase as any).from('housekeeping_room_snapshots')
            .select('business_date,room_status,is_checkout_room,assignment_status,assignment_type,status_history,captured_at,finalized_at')
            .eq('room_id', roomId).gte('business_date', start).lte('business_date', selectedDate)
            .order('business_date', { ascending: false }).limit(9),
          (supabase as any).from('daily_overview_snapshots')
            .select('business_date,room_label,arrival_date,departure_date,status,housekeeping_dep,captured_at')
            .eq('hotel_id', 'gozsdu-court').eq('source', 'previo').eq('room_label', roomName)
            .gte('business_date', start).lte('business_date', nextDay)
            .order('business_date', { ascending: false }).limit(10),
          (supabase as any).from('gozsdu_room_state_events')
            .select('business_date,recorded_at,before_state,after_state,source')
            .eq('room_id', roomId).gte('business_date', start).lte('business_date', selectedDate)
            .order('recorded_at', { ascending: false }).limit(80),
        ]);
        if (history.error || overview.error) throw new Error(history.error?.message || overview.error?.message);
        const result: JourneyRow[] = [];
        for (const row of (overview.data || []) as any[]) {
          result.push({
            at: row.captured_at || `${row.business_date}T00:00:00Z`,
            title: row.status === 'departing' ? 'Scheduled departure' : 'Previo occupied-night record',
            detail: `PMS business date ${row.business_date} · stay ${row.arrival_date || '—'} → ${row.departure_date || '—'}`,
            source: 'Previo snapshot',
          });
        }
        for (const row of (history.data || []) as any[]) {
          result.push({
            at: row.captured_at || `${row.business_date}T00:00:00Z`,
            title: `Housekeeping: ${textValue(row.room_status)}`,
            detail: `Business date ${row.business_date} · ${row.is_checkout_room ? 'checkout plan' : 'non-checkout'} · task ${textValue(row.assignment_status)}`,
            source: 'Housekeeping snapshot',
          });
          const events = Array.isArray(row.status_history) ? row.status_history : [];
          for (const event of events.slice(-15) as any[]) {
            if (!event || !event.at) continue;
            result.push({
              at: event.at, title: 'Housekeeping activity',
              detail: `Task ${textValue(event.assignment_status)} · ready to clean: ${textValue(event.ready_to_clean)} · approved: ${textValue(event.approved)}`,
              source: 'Activity history',
            });
          }
        }
        if (!transitions.error) for (const event of (transitions.data || []) as any[]) {
          const before = event.before_state || {};
          const after = event.after_state || {};
          const fields = ['reservationId', 'arrivalToday', 'scheduledDepartureToday', 'checkedOutToday', 'isNoShow', 'pmsOccupancyStatus'];
          const changes = fields.filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
            .map(field => `${field}: ${textValue(before[field])} → ${textValue(after[field])}`);
          if (!changes.length) continue;
          result.push({ at: event.recorded_at, title: 'PMS room status changed',
            detail: changes.join(' · '), source: textValue(event.source) });
        }
        result.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
        if (!cancelled) setItems(result.slice(0, 70));
      } catch (error) {
        if (!cancelled) { setItems([]); setIssue(error instanceof Error ? error.message : 'Unable to load room history'); }
      } finally { if (!cancelled) setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [open, roomId, roomName, selectedDate]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>Room journey · {roomName}</DialogTitle></DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline">{currentBucket.replaceAll('_', ' ')}</Badge>
          <span className="text-muted-foreground">Business date: {selectedDate}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Read-only PMS evidence and housekeeping activity. A missing reservation is not a no-show.
          Changes recorded before the room-state audit was enabled may not be available.
        </p>
        {loading ? <p className="text-sm">Loading room journey…</p>
          : issue ? <p role="alert" className="text-sm text-amber-700">{issue}</p>
          : items.length === 0 ? <p className="text-sm text-muted-foreground">No dated history available.</p>
          : <ol className="space-y-3 border-l border-border pl-4">
            {items.map((item, index) => <li key={index} className="relative space-y-1 text-xs">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary" />
              <p className="font-semibold">{item.title}</p>
              <p className="text-muted-foreground">{item.detail}</p>
              <p className="text-muted-foreground">{stampLabel(item.at)} · {item.source}</p>
            </li>)}
          </ol>}
      </DialogContent>
    </Dialog>
  );
}
