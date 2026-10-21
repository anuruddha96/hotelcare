import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, RefreshCw, Users } from 'lucide-react';
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
import { slntWorkSection, isSlntRtcReady } from '@/lib/slntTeamBQueue';

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

export function SlntTeamBSharedWorklist({ managerView = false }: Props) {
  const { user } = useAuth();
  const { language } = useTranslation();
  const hu = language === 'hu';
  const [items, setItems] = useState<Item[]>([]);
  const [activeAssignment, setActiveAssignment] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const date = todayBudapest();

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await (supabase as any)
      .rpc('slnt_team_b_pool_v4', { p_service_date: date });
    if (loadError) { setError(loadError.message); setItems([]); }
    else { setError(null); setItems((data || []) as Item[]); }
    setLoading(false);
  }, [date]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

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

  const { pendingApproval: pending, approved: done, remaining: open } = useMemo(() => summarizeTeamBProgress(items), [items]);
  const groups = useMemo(() => ({
    rtc: items.filter(item => slntWorkSection(item, date) === 'rtc'),
    towel: items.filter(item => !item.is_checkout_room && !item.is_optional &&
      (item.towel_change_required || item.linen_change_required)),
    due: items.filter(item => !item.is_checkout_room && !item.is_optional &&
      !item.towel_change_required && !item.linen_change_required),
    optional: items.filter(item => item.is_optional),
    waiting: items.filter(item => slntWorkSection(item, date) === 'waiting'),
  }), [items, date]);
  const label = (i: Item) => i.is_optional ? (hu ? 'Opcionális napi takarítás' : 'Optional stayover')
    : i.is_checkout_room ? (hu ? 'Kijelentkezés' : 'Checkout')
    : i.linen_change_required ? (hu ? 'Ágyneműcsere' : 'Linen change')
    : i.towel_change_required ? (hu ? 'Törölközőcsere' : 'Towel change')
    : (hu ? 'Takarítás' : 'Cleaning');

  const renderRooms = (roomList: Item[]) => {
    return roomList.map(item => {
        const mine = item.assigned_to === user?.id;
        const completed = item.assignment_status === 'completed';
        const claimed = !!item.assignment_id;
        const waitingRtc = item.is_checkout_room && !isSlntRtcReady(item, date);
        return (
          <Card key={item.room_id} data-training="slnt-team-b-room" className="overflow-hidden">
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-base">{item.room_name || item.room_number}</p>
                  <p className="text-sm text-muted-foreground">{item.room_number} · {label(item)}
                    {item.guest_count != null ? ` · ${item.guest_count} ${hu ? 'vendég' : 'guests'}` : ''}
                  </p>
                </div>
                {completed ? <Badge variant={item.supervisor_approved ? 'default' : 'secondary'}>
                  {item.supervisor_approved
                    ? (hu ? 'Jóváhagyva' : 'Approved')
                    : (hu ? 'Jóváhagyásra vár' : 'Awaiting approval')}
                </Badge> : claimed ? <Badge variant="secondary">
                  {mine ? (hu ? 'Saját feladat' : 'Your room') : (hu ? 'Más takarító dolgozik' : 'Cleaner working')}
                </Badge> : waitingRtc ? <Badge variant="secondary">{hu ? 'RTC-re vár' : 'Awaiting RTC'}</Badge>
                  : <Badge variant="outline">{hu ? 'Elérhető' : 'Available'}</Badge>}
              </div>
              {item.notes && <p className="rounded-md bg-muted/40 p-2 text-sm">{item.notes}</p>}
              {item.pms_metadata && (
                <div className="text-xs text-muted-foreground">
                  {typeof item.pms_metadata['arrivalDate'] === 'string' ? `${hu ? 'Érkezés' : 'Arrival'}: ${item.pms_metadata['arrivalDate']} · ` : ''}
                  {typeof item.pms_metadata['departureDate'] === 'string' ? `${hu ? 'Távozás' : 'Departure'}: ${item.pms_metadata['departureDate']}` : ''}
                </div>
              )}
              {!managerView && !completed && waitingRtc && (
                <Button size="sm" variant="outline" disabled aria-disabled="true">
                  {hu ? 'RTC-re vár – nem indítható' : 'Awaiting RTC — cannot start'}
                </Button>
              )}
              {!managerView && !completed && !waitingRtc && (!claimed || mine) && (
                <Button size="sm" disabled={!!busy}
                  data-training="slnt-team-b-claim"
                  onClick={() => void (claimed ? openExisting(item.assignment_id!) : claim(item))}>
                  <ClipboardCheck className="mr-2 h-4 w-4" />
                  {mine ? (hu ? 'Feladat megnyitása' : 'Open my room') : (hu ? 'Takarítás indítása' : 'Start cleaning')}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      });
  };

  return (
    <div className="space-y-4" data-training="slnt-team-b-shared-worklist">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5" />
            {hu ? 'B csapat – mai takarítandó egységek' : 'Team B — today’s cleaning'}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {hu ? 'Minden B csapattag ugyanazt a listát látja. A kész munkát vezető hagyja jóvá a Previo-frissítés előtt.'
              : 'All Team B cleaners share this list. A manager approves completed work before Previo is updated.'}
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{hu ? 'Hátralévő' : 'Remaining'}: {open}</Badge>
          <Badge variant="outline">{hu ? 'Jóváhagyásra vár' : 'Awaiting approval'}: {pending}</Badge>
          <Badge variant="outline">{hu ? 'Jóváhagyva' : 'Approved'}: {done}</Badge>
          <Button className="ml-auto" variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}
            data-training="slnt-team-b-refresh">
            <RefreshCw className="mr-1 h-4 w-4" />{hu ? 'Frissítés' : 'Refresh'}
          </Button>
        </CardContent>
      </Card>
      {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-sm">{error}</div>}
      {loading && items.length === 0 && !error && <p className="text-sm">{hu ? 'Szobák betöltése…' : 'Loading rooms…'}</p>}
      {([
        { key: 'rtc' as const, title: hu ? 'Takarításra kész kijelentkezők (RTC)' : 'RTC — ready checkouts',
          help: hu ? 'Ezek a szobák elsőbbséget élveznek.' : 'Clean these rooms first.' },
        { key: 'towel' as const, title: hu ? 'Törölköző- és ágyneműcsere (T/C)' : 'Towel & linen changes (T/C)',
          help: hu ? 'Esedékes feladatok, a többi napi szoba előtt.' : 'Due services before other stayovers.' },
        { key: 'due' as const, title: hu ? 'Esedékes napi takarítás és kérések' : 'Other due stayovers & requests',
          help: hu ? 'Előírt napi takarítás és egyedi kérések.' : 'Scheduled daily cleaning and explicit requests.' },
        { key: 'optional' as const, title: hu ? 'Egyéb napi szobák (opcionális)' : 'Other stayovers (optional)',
          help: hu ? 'Csak szükség esetén; a DND és No Service szobák kizárva.' : 'Start only when appropriate; DND and No Service excluded.' },
        { key: 'waiting' as const, title: hu ? 'Kijelentkezésre / RTC-re vár' : 'Awaiting checkout / RTC',
          help: hu ? 'Takarítás csak RTC állapot után indítható.' : 'Cleaning can start only once the room is RTC-ready.' },
      ]).map(group => (
        <section key={group.key} className="space-y-2" data-training={`slnt-team-b-${group.key}`}>
          <div className="flex flex-wrap items-baseline gap-2 pt-2">
            <h3 className="font-semibold">{group.title}</h3>
            <Badge variant="secondary">{groups[group.key].length}</Badge>
            <p className="text-xs text-muted-foreground">{group.help}</p>
          </div>
          {group.key === 'optional'
            ? <details className="rounded-md border p-3" data-training="slnt-optional-stayovers">
                <summary className="cursor-pointer text-sm font-medium">
                  {hu ? 'Opcionális napi szobák megtekintése' : 'Show optional stayovers'} ({groups.optional.length})
                </summary>
                <div className="space-y-2 pt-3">{renderRooms(groups.optional)}</div>
              </details>
            : groups[group.key].length === 0
              ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                {hu ? 'Jelenleg nincs feladat.' : 'No rooms in this category.'}</p>
              : renderRooms(groups[group.key])}
        </section>
      ))}
      {!loading && !error && items.length === 0 && <p className="rounded-lg border p-5 text-center text-sm">
        {hu ? 'Nincs takarítandó egység mára.' : 'No rooms need cleaning today.'}
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
              // Reuse the exact existing HotelCare room card. Lost & Found,
              // dirty linen, maintenance, notes, timers, photos, DND/no
              // service and the manager-approval completion process remain
              // unchanged; only claiming from the shared pool is new.
              <AssignedRoomCard assignment={activeAssignment} onStatusUpdate={(assignmentId, status) => {
                void refresh();
                // Keep the card open when cleaning starts or changes status.
                // The original completion workflow closes only on completion
                // and sends the room for supervisor approval as before.
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
