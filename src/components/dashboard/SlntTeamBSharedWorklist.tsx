import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, DoorClosed, DoorOpen, RefreshCw, Sparkles, Users, Waves } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest } from '@/lib/budapestTime';
import { AssignedRoomCard } from './AssignedRoomCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SlntTeamBRoomPreview, type SlntTeamBPreviewItem } from './SlntTeamBRoomPreview';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { summarizeTeamBProgress } from '@/lib/slntSimplifiedHousekeeping';
import { SLNT_TEAM_B_DISPLAY_ORDER, slntTeamBDisplayGroup, type SlntTeamBDisplayGroup } from '@/lib/slntTeamBQueue';

type Item = SlntTeamBPreviewItem;

type Props = { managerView?: boolean };
type Timing = { id: string; started_at: string | null; completed_at: string | null };
const MINUTE = 60_000;
function elapsed(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const minutes = Math.max(0, Math.round((new Date(end || Date.now()).getTime() - new Date(start).getTime()) / MINUTE));
  return minutes < 60 ? minutes + ' min' : Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
}


export function SlntTeamBSharedWorklist({ managerView = false }: Props) {
  const { user } = useAuth();
  const { language } = useTranslation();
  const hu = language === 'hu';
  const [items, setItems] = useState<Item[]>([]);
  const [activeAssignment, setActiveAssignment] = useState<any>(null);
  const [filter, setFilter] = useState<'all' | SlntTeamBDisplayGroup>('all');
  const [timings, setTimings] = useState<Record<string, Timing>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const date = todayBudapest();

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await (supabase as any)
      .rpc('slnt_team_b_pool_v6', { p_service_date: date });
    if (loadError) { setError(loadError.message); setItems([]); }
    else {
      const next = (data || []) as Item[];
      setError(null); setItems(next);
      const ids = next.flatMap(item => item.assignment_id ? [item.assignment_id] : []);
      if (ids.length) {
        // Timing is optional presentation data and respects normal assignment RLS.
        const { data: times } = await supabase.from('room_assignments')
          .select('id,started_at,completed_at').in('id', ids);
        if (times) setTimings(Object.fromEntries((times as Timing[]).map(t => [t.id, t])));
      } else setTimings({});
    }
    setLoading(false);
  }, [date]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    const onChange = () => { void refresh(); };
    window.addEventListener('hk-assignments-changed', onChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('hk-assignments-changed', onChange);
    };
  }, [refresh]);

  // Only meaningful actions count as activity. A tab left open and polling
  // every 30 seconds must NOT keep an absent cleaner falsely marked active.
  useEffect(() => {
    if (!user?.id || managerView) return;
    let lastSent = 0;
    const touch = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastSent < 5 * MINUTE) return;
      lastSent = Date.now();
      void (supabase as any).rpc('slnt_team_b_touch_activity_v5')
        .then(({ error: failure }: { error: { message: string } | null }) => {
          if (failure) lastSent = 0; // Safe on old deployments without the optional RPC.
        }).catch(() => { lastSent = 0; });
    };
    touch();
    const onVisible = () => { if (!document.hidden) touch(); };
    window.addEventListener('pointerdown', touch, { passive: true });
    window.addEventListener('keydown', touch);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [managerView, user?.id]);

  const loadAssignment = async (id: string) => {
    const { data, error: loadError } = await supabase.from('room_assignments').select(`
      *, rooms (
        id, room_number, room_name, hotel, status, floor_number, bed_type,
        bed_configuration, notes, pms_metadata, guest_nights_stayed,
        towel_change_required, linen_change_required, is_checkout_room,
        checkout_time, guest_count
      )
    `).eq('id', id).maybeSingle();
    if (loadError) throw loadError;
    if (!data) throw new Error(hu ? 'A feladat nem található.' : 'Assignment not found.');
    setActiveAssignment(data);
  };

  const openExisting = async (id: string) => {
    try { await loadAssignment(id); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Cannot open room.'); }
  };

  const claim = async (item: Item) => {
    if (busy || managerView) return;
    setBusy(item.room_id);
    try {
      const { data, error: claimError } = await (supabase as any).rpc('slnt_team_b_start_room_v4', {
        p_room_id: item.room_id, p_service_date: date,
      });
      if (claimError) throw claimError;
      await loadAssignment(String(data));
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
      await refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : (hu ? 'Nem sikerült a feladat átvétele.' : 'Could not claim this room.'));
      await refresh();
    } finally { setBusy(null); }
  };

  const { pendingApproval: pending, approved: done } = useMemo(() => summarizeTeamBProgress(items), [items]);
  const groups = useMemo(() => {
    const next: Record<SlntTeamBDisplayGroup, Item[]> = {
      towel: [], rtc: [], due: [], optional: [], waiting: [],
    };
    for (const item of items) next[slntTeamBDisplayGroup(item, date)].push(item);
    return next;
  }, [items, date]);
  const remaining = items.filter(item => item.assignment_status !== 'completed').length;
  const inProgress = items.filter(item => item.assignment_status === 'in_progress').length;
  const sectionNames: Record<SlntTeamBDisplayGroup, string> = {
    rtc: hu ? 'Takarításra kész kijelentkezők — elsőbbség' : 'Ready checkouts · first priority',
    towel: hu ? 'Törölköző- és ágyneműcsere' : 'Towel & linen changes',
    due: hu ? 'Mai napi feladatok és kérések' : 'Due daily rooms & requests',
    optional: hu ? 'További napi szobák' : 'Other daily rooms',
    waiting: hu ? 'Kijelentkezésre / RTC-re vár' : 'Waiting for checkout / RTC',
  };

  const renderRooms = (roomList: Item[]) => roomList.map(item => {
    const time = item.assignment_id ? timings[item.assignment_id] : undefined;
    return <SlntTeamBRoomPreview key={item.room_id} item={item} date={date}
      hu={hu} userId={user?.id} busy={!!busy} managerView={managerView}
      startedAt={time?.started_at} duration={time ? elapsed(time.started_at, time.completed_at) : null}
      onStart={() => void claim(item)}
      onOpen={() => { if (item.assignment_id) void openExisting(item.assignment_id); }}
    />;
  });

  return (
    <div className="space-y-5 pb-6" data-training="slnt-team-b-shared-worklist">
      <div className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
              <Users className="h-5 w-5 text-sky-500" />
              {hu ? 'B csapat · mai szobák' : 'Team B · My Tasks'}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {hu ? 'Közös szobalista · aki először elkezdi, azé a szoba.'
                : 'Shared rooms · first cleaner to start takes the room.'}
            </p>
          </div>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}
            data-training="slnt-team-b-refresh">
            <RefreshCw className="mr-1.5 h-4 w-4" />
            {hu ? 'Frissítés' : 'Refresh'}
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([
            { value: items.length, caption: hu ? 'Összes szoba' : 'Total rooms', style: 'bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-200' },
            { value: inProgress, caption: hu ? 'Folyamatban' : 'In progress', style: 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200' },
            { value: pending, caption: hu ? 'Jóváhagyásra vár' : 'Pending approval', style: 'bg-violet-50 text-violet-800 dark:bg-violet-950/30 dark:text-violet-200' },
            { value: done, caption: hu ? 'Jóváhagyva' : 'Approved', style: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200' },
          ]).map(card => (
            <div key={card.caption} className={'rounded-xl border p-3 ' + card.style}>
              <p className="text-2xl font-extrabold tabular-nums">{card.value}</p>
              <p className="text-xs font-semibold">{card.caption}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {remaining} {hu ? 'szoba még nincs kész. Az elkészült munkát vezető hagyja jóvá a Previo-frissítés előtt.'
            : 'rooms not yet completed. Managers approve finished rooms before Previo sync.'}
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={hu ? 'Szobaszűrők' : 'Room filters'}>
        {([
          ['all', hu ? 'Mind' : 'All', items.length],
          ['rtc', hu ? 'Kész kijelentkező' : 'Ready checkout', groups.rtc.length],
          ['towel', hu ? 'T/C' : 'Towels / linen', groups.towel.length],
          ['due', hu ? 'Napi' : 'Daily', groups.due.length],
          ['optional', hu ? 'Opcionális' : 'Optional', groups.optional.length],
          ['waiting', hu ? 'Várakozik' : 'Waiting', groups.waiting.length],
        ] as const).map(([key, title, count]) => (
          <Button key={key} type="button" size="sm" className="shrink-0 rounded-full"
            variant={filter === key ? 'default' : 'outline'}
            aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {title} <span className="ml-1 tabular-nums opacity-80">{count}</span>
          </Button>
        ))}
      </div>

      {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm">{error}</div>}
      {loading && items.length === 0 && !error && <p className="text-sm">{hu ? 'Szobák betöltése…' : 'Loading rooms…'}</p>}
      {!error && SLNT_TEAM_B_DISPLAY_ORDER.filter(group => filter === 'all' || filter === group).map(group => {
        const rooms = groups[group];
        if (!rooms.length && filter === 'all') return null;
        return (
          <section key={group} className="space-y-3" data-training={'slnt-team-b-' + group}>
            <div className="flex items-center gap-2 border-b pb-2">
              {group === 'waiting' ? <DoorClosed className="h-4 w-4 text-orange-600" /> :
                group === 'rtc' ? <DoorOpen className="h-4 w-4 text-sky-600" /> :
                group === 'towel' ? <Waves className="h-4 w-4 text-violet-600" /> :
                <Sparkles className="h-4 w-4 text-emerald-600" />}
              <h3 className="font-bold">{sectionNames[group]}</h3>
              <Badge variant="secondary">{rooms.length}</Badge>
            </div>
            {group === 'waiting' && <p className="text-xs text-muted-foreground">
              {hu ? 'A vendég még bent van / RTC-re vár. Ezek a szobák csak kijelentkezés után indíthatók.'
                : 'Guest checkout or RTC not yet confirmed. These rooms remain locked.'}
            </p>}
            {rooms.length ? <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{renderRooms(rooms)}</div>
              : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                {hu ? 'Ebben a kategóriában nincs szoba.' : 'No rooms in this category.'}
              </p>}
          </section>
        );
      })}
      {!loading && !error && items.length === 0 && <p className="rounded-lg border p-5 text-center text-sm">
        {hu ? 'Ma nincs takarítandó szoba.' : 'No rooms need cleaning today.'}
      </p>}
      {!managerView && (
        <Dialog open={!!activeAssignment} onOpenChange={open => {
          if (!open) { setActiveAssignment(null); void refresh(); }
        }}>
          <DialogContent className="max-h-[95dvh] w-[98vw] max-w-3xl overflow-y-auto p-3 sm:p-5"
            data-training="slnt-team-b-active-assignment">
            <DialogHeader>
              <DialogTitle>{hu ? 'Szoba takarítása' : 'Clean room'}</DialogTitle>
            </DialogHeader>
            {activeAssignment && (
              <AssignedRoomCard assignment={activeAssignment} onStatusUpdate={(assignmentId, status) => {
                void refresh();
                if (status === 'completed' || status === 'cancelled') {
                  window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
                  setActiveAssignment(null);
                } else {
                  void loadAssignment(assignmentId);
                }
              }} />
            )}
          </DialogContent>
        </Dialog>
      )}
      {managerView && pending > 0 && <div className="flex items-center gap-2 text-sm">
        <CheckCircle2 className="h-4 w-4" />
        {hu ? 'A jóváhagyásokat a „Függő jóváhagyások” lapon kezelheted.' : 'Review these rooms in Pending Approvals.'}
      </div>}
    </div>
  );
}
