import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Clock3, DoorClosed, DoorOpen, RefreshCw, Sparkles, Users, Waves } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { todayBudapest } from '@/lib/budapestTime';
import { AssignedRoomCard } from './AssignedRoomCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { summarizeTeamBProgress } from '@/lib/slntSimplifiedHousekeeping';
import { isSlntRtcReady, SLNT_TEAM_B_DISPLAY_ORDER, slntTeamBDisplayGroup, type SlntTeamBDisplayGroup } from '@/lib/slntTeamBQueue';

type Item = {
  room_id: string;
  room_number: string;
  room_status: string | null;
  room_name: string | null;
  notes: string | null;
  guest_count: number | null;
  is_checkout_room: boolean;
  towel_change_required: boolean;
  linen_change_required: boolean;
  pms_metadata: Record<string, unknown> | null;
  assignment_id: string | null;
  assigned_to: string | null;
  assignment_status: string | null;
  supervisor_approved: boolean;
  is_optional: boolean;
};

type Props = { managerView?: boolean };
type Timing = { id: string; started_at: string | null; completed_at: string | null };
const MINUTE = 60_000;
function elapsed(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const minutes = Math.max(0, Math.round((new Date(end || Date.now()).getTime() - new Date(start).getTime()) / MINUTE));
  return minutes < 60 ? minutes + ' min' : Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
}
function clock(iso: string, hu: boolean) {
  return new Intl.DateTimeFormat(hu ? 'hu-HU' : 'en-GB', {
    timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
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
      .rpc('slnt_team_b_pool_v4', { p_service_date: date });
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
  const label = (i: Item) => i.is_checkout_room ? (hu ? 'Kijelentkező' : 'Checkout clean')
    : i.linen_change_required ? (hu ? 'Ágyneműcsere' : 'Linen change')
    : i.towel_change_required ? (hu ? 'Törölközőcsere' : 'Towel change')
    : i.is_optional ? (hu ? 'Opcionális napi szoba' : 'Optional daily')
    : (hu ? 'Napi takarítás' : 'Daily cleaning');
  const sectionNames: Record<SlntTeamBDisplayGroup, string> = {
    towel: hu ? 'Törölköző- és ágyneműcsere' : 'Towel & linen changes',
    rtc: hu ? 'Takarításra kész kijelentkezők' : 'Ready checkouts',
    due: hu ? 'Mai napi feladatok és kérések' : 'Due daily rooms & requests',
    optional: hu ? 'További napi szobák' : 'Other daily rooms',
    waiting: hu ? 'Kijelentkezésre / RTC-re vár' : 'Waiting for checkout / RTC',
  };

  const renderRooms = (roomList: Item[]) => roomList.map(item => {
    const mine = item.assigned_to === user?.id;
    const completed = item.assignment_status === 'completed';
    const claimed = !!item.assignment_id;
    const working = item.assignment_status === 'in_progress';
    const waitingRtc = item.is_checkout_room && !isSlntRtcReady(item, date);
    const itemGroup = slntTeamBDisplayGroup(item, date);
    const time = item.assignment_id ? timings[item.assignment_id] : undefined;
    const duration = time ? elapsed(time.started_at, time.completed_at) : null;
    const arrival = item.pms_metadata?.arrivalDate;
    const departure = item.pms_metadata?.departureDate;
    const badgeText = completed ? (item.supervisor_approved
      ? (hu ? 'Jóváhagyva' : 'Approved') : (hu ? 'Jóváhagyásra vár' : 'Pending approval'))
      : claimed ? (mine ? (working ? (hu ? 'Folyamatban' : 'In progress') : (hu ? 'Saját szoba' : 'My room'))
        : (hu ? 'Másik takarítónál' : 'Teammate working'))
      : waitingRtc ? (hu ? 'Vendég a szobában' : 'Guest in room')
      : (hu ? 'Elérhető' : 'Available');
    const accent = waitingRtc ? 'border-l-orange-400 bg-orange-50/30 dark:bg-orange-950/10'
      : itemGroup === 'towel' ? 'border-l-violet-400'
      : itemGroup === 'rtc' ? 'border-l-sky-500'
      : itemGroup === 'optional' ? 'border-l-emerald-400' : 'border-l-blue-400';

    return (
      <Card key={item.room_id} data-training="slnt-team-b-room"
        className={'overflow-hidden border-l-4 shadow-sm ' + accent}>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-words text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">
                {item.room_name || item.room_number}
              </p>
              {item.room_name && item.room_name !== item.room_number && (
                <p className="mt-1 text-xs text-muted-foreground">{item.room_number}</p>
              )}
            </div>
            <Badge variant={waitingRtc || claimed ? 'secondary' : 'outline'}
              className="shrink-0 max-w-[45%] whitespace-normal text-center text-xs">
              {badgeText}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary" className="gap-1 py-1 text-xs">
              {item.is_checkout_room ? <DoorOpen className="h-3.5 w-3.5" /> :
                itemGroup === 'towel' ? <Waves className="h-3.5 w-3.5" /> :
                <Sparkles className="h-3.5 w-3.5" />}
              {label(item)}
            </Badge>
            {item.guest_count != null && <span className="text-muted-foreground">
              {item.guest_count} {hu ? 'vendég' : item.guest_count === 1 ? 'guest' : 'guests'}
            </span>}
            <Badge variant="outline" className="text-xs">
              {item.room_status === 'dirty' ? (hu ? 'Takarítandó' : 'Dirty') : item.room_status || (hu ? 'Szoba' : 'Room')}
            </Badge>
          </div>
          {(typeof arrival === 'string' || typeof departure === 'string') && (
            <p className="text-xs text-muted-foreground">
              {typeof arrival === 'string' ? (hu ? 'Érkezés: ' : 'Arrival: ') + arrival : ''}
              {typeof arrival === 'string' && typeof departure === 'string' ? ' · ' : ''}
              {typeof departure === 'string' ? (hu ? 'Távozás: ' : 'Departure: ') + departure : ''}
            </p>
          )}
          {item.notes && !/\[(?:DND|NO_SERVICE)\]/i.test(item.notes) && (
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">{item.notes}</p>
          )}
          {time?.started_at && (
            <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" />
              {hu ? 'Kezdés' : 'Started'} {clock(time.started_at, hu)}
              {duration ? ' · ' + duration : ''}
              {time.completed_at ? (hu ? ' · Befejezve' : ' · Finished') : ''}
            </p>
          )}
          {waitingRtc && !completed && (
            <div role="status" className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-900 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-100">
              <DoorClosed className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{hu ? 'Várakozás a kijelentkezésre. Nem kezdhető el, amíg a PMS nem jelzi az RTC állapotot.'
                : 'Waiting for guest checkout. Cleaning is locked until PMS confirms RTC.'}</span>
            </div>
          )}
          {!managerView && !completed && waitingRtc && (
            <Button className="h-12 w-full text-base" variant="outline" disabled
              data-training="slnt-team-b-waiting-rtc">
              <DoorClosed className="mr-2 h-4 w-4" />
              {hu ? 'Nem kezdhető el · RTC-re vár' : 'Cannot start · awaiting checkout'}
            </Button>
          )}
          {!managerView && !completed && !waitingRtc && claimed && !mine && (
            <div className="rounded-lg bg-muted px-3 py-3 text-center text-sm font-medium text-muted-foreground">
              {hu ? 'Ezt a szobát már másik takarító vette fel.' : 'Another cleaner has started this room.'}
            </div>
          )}
          {!managerView && !completed && !waitingRtc && (!claimed || mine) && (
            <Button className="h-12 w-full text-base font-bold" disabled={!!busy}
              data-training="slnt-team-b-claim"
              onClick={() => void (claimed ? openExisting(item.assignment_id!) : claim(item))}>
              <ClipboardCheck className="mr-2 h-5 w-5" />
              {mine ? (hu ? 'Saját szobám megnyitása' : 'Open my room')
                : (hu ? 'Takarítás indítása' : 'Start cleaning')}
            </Button>
          )}
        </CardContent>
      </Card>
    );
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
          ['towel', hu ? 'T/C' : 'Towels / linen', groups.towel.length],
          ['rtc', hu ? 'Kész' : 'Ready checkout', groups.rtc.length],
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
                group === 'towel' ? <Waves className="h-4 w-4 text-violet-600" /> :
                group === 'rtc' ? <DoorOpen className="h-4 w-4 text-sky-600" /> :
                <Sparkles className="h-4 w-4 text-blue-600" />}
              <h3 className="font-bold">{sectionNames[group]}</h3>
              <Badge variant="secondary">{rooms.length}</Badge>
            </div>
            {group === 'waiting' && <p className="text-xs text-muted-foreground">
              {hu ? 'A vendég még bent van / RTC-re vár. Ezek a szobák csak kijelentkezés után indíthatók.'
                : 'Guest still inside / awaiting RTC. These rooms remain locked until checkout.'}
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
