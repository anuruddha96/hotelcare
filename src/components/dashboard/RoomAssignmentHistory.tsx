import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { History, RefreshCw, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

type HistoryEvent = {
  id: number;
  room_number: string;
  occurred_at: string;
  event_type: 'assigned' | 'reassigned' | 'unassigned';
  previous_assignee_id: string | null;
  previous_assignee_name: string | null;
  new_assignee_id: string | null;
  new_assignee_name: string | null;
  actor_id: string | null;
  actor_name: string | null;
};
const PAGE_SIZE = 50;
// The migration is deployed separately from generated database typings.
const historyClient = supabase as unknown as SupabaseClient;

export function RoomAssignmentHistory({ hotel, organizationSlug, selectedDate, hu }: {
  hotel: string;
  organizationSlug: string;
  selectedDate: string;
  hu: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState('');
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [date, setDate] = useState(selectedDate);

  const changeOpen = (next: boolean) => {
    if (next) {
      setDate(selectedDate);
      setPage(0);
      setRoom('');
      setEvents([]);
      setFailed(false);
      setLoading(true);
    }
    setOpen(next);
  };
  useEffect(() => {
    if (!open || !date) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setEvents([]);
    setHasMore(false);
    async function load() {
      try {
        const keys = await resolveHotelKeys(hotel);
        if (!keys.length || cancelled) return;
        let query = historyClient.from('room_assignment_history')
          .select('id,room_number,occurred_at,event_type,previous_assignee_id,previous_assignee_name,new_assignee_id,new_assignee_name,actor_id,actor_name')
          .eq('organization_slug', organizationSlug)
          .in('hotel', keys)
          .eq('assignment_date', date);
        if (room.trim()) query = query.eq('room_number', room.trim());
        const { data, error } = await query.order('occurred_at', { ascending: false })
          .order('id', { ascending: false })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        if (error) throw error;
        if (cancelled) return;
        const rows = (data ?? []) as HistoryEvent[];
        setHasMore(rows.length > PAGE_SIZE);
        setEvents(rows.slice(0, PAGE_SIZE));
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [open, hotel, organizationSlug, date, room, page, revision]);

  const copy = hu ? {
    title: 'Szobakiosztási előzmények', description: 'A kiosztás, áthelyezés és visszavonás naplója. Csak a naplózás bevezetése utáni változások láthatók.',
    date: 'Munkanap', room: 'Szobaszám', roomPlaceholder: 'pl. 042', refresh: 'Frissítés', empty: 'Nincs rögzített kiosztási változás a kiválasztott napon.',
    failed: 'Az előzmények nem tölthetők be. Próbálja újra.', loading: 'Betöltés…', none: 'Nincs kiosztva', unknown: 'Ismeretlen felhasználó', system: 'Rendszer / ismeretlen',
    by: 'Módosította', assigned: 'Kiosztva', reassigned: 'Áthelyezve', unassigned: 'Kiosztás visszavonva', previous: 'Előző', next: 'Következő',
  } : {
    title: 'Room assignment history', description: 'Assignment, reassignment and removal activity. Only changes recorded after audit logging was enabled are shown.',
    date: 'Work date', room: 'Room number', roomPlaceholder: 'e.g. 042', refresh: 'Refresh', empty: 'No recorded assignment changes for the selected day.',
    failed: 'Could not load assignment history. Please retry.', loading: 'Loading…', none: 'Unassigned', unknown: 'Unknown user', system: 'System / unknown',
    by: 'Changed by', assigned: 'Assigned', reassigned: 'Reassigned', unassigned: 'Unassigned', previous: 'Previous', next: 'Next',
  };
  const time = new Intl.DateTimeFormat(hu ? 'hu-HU' : 'en-GB', {
    timeZone: 'Europe/Budapest', dateStyle: 'medium', timeStyle: 'medium',
  });
  const assignee = (id: string | null, name: string | null) => name || (id ? copy.unknown : copy.none);
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 touch-manipulation">
          <History className="h-4 w-4" />{copy.title}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 items-end">
          <label className="space-y-1 text-sm">
            <span>{copy.date}</span>
            <Input type="date" value={date} onChange={e => { if (e.target.value) { setDate(e.target.value); setPage(0); } }} />
          </label>
          <label className="space-y-1 text-sm">
            <span>{copy.room}</span>
            <Input value={room} placeholder={copy.roomPlaceholder} onChange={e => { setRoom(e.target.value); setPage(0); }} />
          </label>
        </div>
        <Button variant="outline" size="sm" className="w-fit gap-2" onClick={() => { setPage(0); setRevision(v => v + 1); }} disabled={loading}>
          <RefreshCw className="h-4 w-4" />{copy.refresh}
        </Button>
        {loading ? <p role="status" className="text-sm text-muted-foreground">{copy.loading}</p>
          : failed ? <p role="alert" className="text-sm text-destructive">{copy.failed}</p>
          : events.length === 0 ? <p className="rounded-md border p-4 text-sm text-muted-foreground">{copy.empty}</p>
          : <div className="space-y-2">
            {events.map(event => (
              <div key={event.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <span className="font-semibold">{event.room_number} · {copy[event.event_type]}</span>
                  <time dateTime={event.occurred_at} className="text-xs text-muted-foreground">{time.format(new Date(event.occurred_at))}</time>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{assignee(event.previous_assignee_id, event.previous_assignee_name)}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="font-medium">{assignee(event.new_assignee_id, event.new_assignee_name)}</span>
                </div>
                <p className="text-sm text-muted-foreground">{copy.by}: <span className="text-foreground">{event.actor_name || (event.actor_id ? copy.unknown : copy.system)}</span></p>
              </div>
            ))}
          </div>}
        {!loading && !failed && (page > 0 || hasMore) && <div className="flex justify-between">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{copy.previous}</Button>
          <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => setPage(p => p + 1)}>{copy.next}</Button>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
