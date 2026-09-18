import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BedDouble, ChevronDown, EyeOff, Hotel, Loader2, MapPin, AlertTriangle } from 'lucide-react';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { assigneeLabel } from '@/lib/staffNames';
import { parseRoomFlags } from '@/lib/room-service-flags';
import { historicalDndState, isBudapestBusinessDate, selectSavedSnapshot, type HistoricalDndState } from '@/lib/historicalDndStatus';
import { useTranslation } from '@/hooks/useTranslation';

type RoomSnapshot = {
  business_date: string; hotel: string; room_id: string; room_number: string;
  floor_number: number | null; venue_id: string | null; room_size_sqm: number | null;
  bed_type: string | null; bed_configuration: string | null; room_status: string | null;
  is_checkout_room: boolean | null; is_dnd: boolean | null; had_dnd: boolean | null;
  dnd_attempt_count: number | null; towel_change_required: boolean | null;
  linen_change_required: boolean | null; had_towel_change: boolean | null;
  had_linen_change: boolean | null; had_room_cleaning_request: boolean | null;
  had_extra_towels_request: boolean | null; had_ready_to_clean: boolean | null;
  had_no_service: boolean | null; had_no_show: boolean | null;
  room_notes: string | null; pms_metadata: any; guest_nights_stayed: number | null;
  assignment_id: string | null; assigned_to: string | null; assignment_type: string | null;
  assignment_status: string | null; assignment_started_at: string | null;
  assignment_completed_at: string | null; supervisor_approved: boolean | null;
  ready_to_clean: boolean | null; assignment_notes: string | null;
  source: string | null; captured_at: string | null; updated_at: string | null;
  status_history: Array<Record<string, any>> | null;
};
type DatedAssignment = {
  id: string; room_id: string; assignment_date: string; status: string;
  is_dnd: boolean | null; dnd_attempt_count: number | null;
  supervisor_approved: boolean | null; supervisor_approved_at: string | null;
  assignment_type: string; started_at: string | null; completed_at: string | null;
  service_result: string | null;
};
type DndEvidence = { id: string; assignment_id: string | null; marked_at: string; attempt_number: number | null };
type Task = { id: string; task_name: string; task_type: string; assigned_to: string; status: string };
type Props = { selectedDate: string; hotelName: string; staffMap: Record<string, string>; refreshKey?: number };
type VerifiedRoom = {
  snapshot: RoomSnapshot; assignment: DatedAssignment | null; evidence: DndEvidence[];
  dnd: HistoricalDndState; checkout: boolean; approved: boolean;
};

const COLORS: Record<string, string> = {
  approved: 'bg-emerald-200 text-emerald-900 border-emerald-500 dark:bg-emerald-900/50 dark:text-emerald-200',
  dirty: 'bg-amber-200 text-amber-900 border-amber-500 dark:bg-amber-900/50 dark:text-amber-200',
  in_progress: 'bg-sky-200 text-sky-900 border-sky-500 dark:bg-sky-900/50 dark:text-sky-200',
  pending: 'bg-violet-200 text-violet-900 border-violet-500 dark:bg-violet-900/50 dark:text-violet-200',
  out_of_order: 'bg-red-200 text-red-900 border-red-500 dark:bg-red-900/50 dark:text-red-200',
};
const isCheckout = (row: RoomSnapshot) => row.pms_metadata?.manual_daily !== true &&
  (row.is_checkout_room === true || row.pms_metadata?.scheduledDepartureToday === true || row.assignment_type === 'checkout_cleaning');
const isNoShow = (row: RoomSnapshot) => {
  const m = row.pms_metadata || {};
  const status = String(m.reservationStatus ?? m.reservation_status ?? m.pmsStatus ?? m.pms_status
    ?? m.bookingStatus ?? m.booking_status ?? m.status ?? m.reservation?.status ?? '').trim().toLowerCase();
  return row.had_no_show === true || m.isNoShow === true || m.noShow === true || m.no_show === true
    || ['no_show', 'no-show', 'noshow', 'no show'].includes(status)
    || (row.room_notes || '').toLowerCase().includes('no show');
};
const sizeLabel = (sqm: number | null) => !sqm ? null : sqm <= 18 ? 'S' : sqm <= 30 ? 'M' : sqm <= 40 ? 'L' : 'XL';
const bedLabel = (config: string | null) => {
  if (!config) return null;
  if (config.includes('Double')) return 'DB';
  if (config.includes('Twin') && config.includes('Sep')) return 'TW-S';
  if (config.includes('Twin')) return 'TW';
  if (config.includes('Single')) return 'SGL';
  if (config.includes('Baby')) return '👶BB';
  if (config.includes('Sofa')) return 'SOFA';
  if (config.includes('Extra') || config.includes('Cot')) return '+COT';
  return config.slice(0, 3).toUpperCase();
};
const localTime = (timestamp: string | null | undefined): string => {
  if (!timestamp) return 'Not recorded';
  const value = new Date(timestamp);
  if (!Number.isFinite(value.getTime())) return 'Invalid timestamp';
  return `${new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Budapest', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value)} (Budapest)`;
};

/** Memories-only historical board. Selects the requested business date and never performs writes. */
export function MemoriesHistoricalRoomOverview({ selectedDate, hotelName, staffMap, refreshKey }: Props) {
  const { t } = useTranslation();
  const [snapshots, setSnapshots] = useState<RoomSnapshot[]>([]);
  const [assignments, setAssignments] = useState<DatedAssignment[]>([]);
  const [evidence, setEvidence] = useState<DndEvidence[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [evidenceWarning, setEvidenceWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(true);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      setEvidenceWarning(null);
      try {
        const keys = await resolveHotelKeys(hotelName);
        const hotelKeys = keys.length ? keys : [hotelName];
        const [historyRes, tasksRes] = await Promise.all([
          (supabase as any).from('housekeeping_room_snapshots')
            .select('business_date,hotel,room_id,room_number,floor_number,venue_id,room_size_sqm,bed_type,bed_configuration,room_status,is_checkout_room,is_dnd,had_dnd,dnd_attempt_count,towel_change_required,linen_change_required,had_towel_change,had_linen_change,had_room_cleaning_request,had_extra_towels_request,had_ready_to_clean,had_no_service,had_no_show,room_notes,pms_metadata,guest_nights_stayed,assignment_id,assigned_to,assignment_type,assignment_status,assignment_started_at,assignment_completed_at,supervisor_approved,ready_to_clean,assignment_notes,source,captured_at,updated_at,status_history')
            .in('hotel', hotelKeys).eq('business_date', selectedDate).order('room_number'),
          supabase.from('general_tasks').select('id,task_name,task_type,assigned_to,status')
            .in('hotel', hotelKeys).eq('assigned_date', selectedDate),
        ]);
        if (historyRes.error) throw historyRes.error;
        if (tasksRes.error) throw tasksRes.error;
        const saved = selectSavedSnapshot((historyRes.data || []) as RoomSnapshot[], hotelName);
        const roomIds = [...new Set(saved.map(row => row.room_id))];
        let datedAssignments: DatedAssignment[] = [];
        let photos: DndEvidence[] = [];
        let warning: string | null = null;
        if (roomIds.length) {
          const assignmentRes = await supabase.from('room_assignments')
            .select('id,room_id,assignment_date,status,is_dnd,dnd_attempt_count,supervisor_approved,supervisor_approved_at,assignment_type,started_at,completed_at,service_result')
            .in('room_id', roomIds).eq('assignment_date', selectedDate);
          if (assignmentRes.error) {
            warning = 'Assignment verification unavailable; DND statuses rely only on the saved snapshot.';
          } else {
            datedAssignments = (assignmentRes.data || []) as unknown as DatedAssignment[];
          }
          const ids = [...new Set(datedAssignments.map(a => a.id).concat(saved.map(row => row.assignment_id || '').filter(Boolean)))];
          if (ids.length) {
            const dndRes = await supabase.from('dnd_photos')
              .select('id,assignment_id,marked_at,attempt_number').in('assignment_id', ids);
            if (dndRes.error) {
              warning = 'DND evidence could not be verified. Historical DND counts may be incomplete.';
            } else {
              photos = ((dndRes.data || []) as DndEvidence[]).filter(photo =>
                isBudapestBusinessDate(photo.marked_at, selectedDate));
            }
          }
        }
        if (cancelled) return;
        setSnapshots(saved);
        setAssignments(datedAssignments);
        setEvidence(photos);
        setTasks((tasksRes.data || []) as Task[]);
        setEvidenceWarning(warning);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load the saved housekeeping day.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedDate, hotelName, refreshKey]);

  const rooms = useMemo<VerifiedRoom[]>(() => {
    const byAssignmentId = new Map(assignments.map(a => [a.id, a]));
    const byRoomId = new Map(assignments.map(a => [a.room_id, a]));
    const photosByAssignment = new Map<string, DndEvidence[]>();
    for (const photo of evidence) {
      if (!photo.assignment_id) continue;
      const list = photosByAssignment.get(photo.assignment_id) || [];
      list.push(photo);
      photosByAssignment.set(photo.assignment_id, list);
    }
    return snapshots.map(snapshot => {
      const assignment = (snapshot.assignment_id && byAssignmentId.get(snapshot.assignment_id))
        || byRoomId.get(snapshot.room_id) || null;
      const photos = assignment ? (photosByAssignment.get(assignment.id) || [])
        : (snapshot.assignment_id ? (photosByAssignment.get(snapshot.assignment_id) || []) : []);
      const resolved = assignment ? {
        ...snapshot,
        assignment_status: assignment.status,
        supervisor_approved: assignment.supervisor_approved,
        is_dnd: assignment.is_dnd,
        dnd_attempt_count: assignment.dnd_attempt_count,
      } : snapshot;
      return { snapshot, assignment, evidence: photos,
        dnd: historicalDndState(resolved, photos.length),
        checkout: isCheckout(snapshot),
        approved: resolved.assignment_status === 'completed' && resolved.supervisor_approved === true,
      };
    });
  }, [snapshots, assignments, evidence]);

  const checkoutRooms = rooms.filter(room => room.checkout);
  const arrivalRooms = rooms.filter(room => !room.checkout && !isNoShow(room.snapshot)
    && room.snapshot.pms_metadata?.arrivalToday === true && room.snapshot.pms_metadata?.occupiedToday !== true);
  const noShowRooms = rooms.filter(room => !room.checkout && isNoShow(room.snapshot));
  const arrivalIds = new Set(arrivalRooms.map(room => room.snapshot.room_id));
  const dailyRooms = rooms.filter(room => !room.checkout && !isNoShow(room.snapshot) && !arrivalIds.has(room.snapshot.room_id));
  const earlyCheckoutRooms = rooms.filter(room => room.checkout && (room.snapshot.room_notes || '').toLowerCase().includes('early checkout'));
  const averageCleanTime = (() => {
    const minutes = rooms.flatMap(room => {
      const a = room.assignment;
      const start = a?.started_at || room.snapshot.assignment_started_at;
      const end = a?.completed_at || room.snapshot.assignment_completed_at;
      if (!start || !end) return [];
      const duration = (Date.parse(end) - Date.parse(start)) / 60000;
      return duration > 0 && duration < 720 ? [duration] : [];
    });
    return minutes.length ? `${Math.round(minutes.reduce((sum, duration) => sum + duration, 0) / minutes.length)}m` : '--';
  })();

  const roomChip = (room: VerifiedRoom) => {
    const row = room.snapshot;
    const status = room.approved ? 'approved'
      : row.assignment_status === 'completed' ? 'pending'
        : row.assignment_status === 'in_progress' || row.room_status === 'in_progress' ? 'in_progress'
          : row.room_status === 'out_of_order' ? 'out_of_order'
            : row.room_status === 'clean' ? 'approved' : 'dirty';
    const flags = parseRoomFlags(row.room_notes);
    const noService = Boolean(row.had_no_service || row.assignment_notes?.includes('[NO_SERVICE]'));
    const towel = !room.checkout && Boolean(row.had_towel_change || row.towel_change_required);
    const linen = !room.checkout && Boolean(row.had_linen_change || row.linen_change_required);
    const name = assigneeLabel(staffMap, row.assigned_to);
    const size = sizeLabel(row.room_size_sqm);
    const config = bedLabel(row.bed_configuration);
    const label = room.dnd === 'active' ? 'DND at saved cutoff'
      : room.dnd === 'earlier' ? 'DND encounter recorded on this business date'
        : room.dnd === 'conflict' ? 'DND and approval disagree; inspect history' : null;
    const noShow = isNoShow(row);
    return (
      <div key={row.room_id} className="flex flex-col items-center gap-0.5 select-none">
        <button type="button" onClick={() => setSelectedRoomId(row.room_id)}
          className={`relative rounded border-2 px-2 py-1 text-xs font-bold min-w-[40px] text-center ${COLORS[status]} ${room.dnd === 'active' ? 'ring-2 ring-purple-500 ring-offset-1' : ''} ${room.dnd === 'conflict' ? 'ring-2 ring-red-500 ring-offset-1' : ''}`}
          title={[`Room ${row.room_number}`, row.assignment_status ? `Assignment: ${row.assignment_status}` : null,
            label, name ? `Assigned: ${name}` : null, 'Read-only saved history – click for details'].filter(Boolean).join(' · ')}>
          {row.room_number}
          {noShow && <span className="ml-0.5 px-0.5 rounded text-[9px] bg-red-600 text-white">NS</span>}
          {row.pms_metadata?.notArrived && !noShow && <span className="ml-0.5 px-0.5 rounded text-[9px] bg-slate-500 text-white">NA</span>}
          {row.pms_metadata?.manual_checkout && <span className="ml-0.5 px-0.5 rounded text-[9px] bg-amber-500 text-white">M</span>}
          {towel && <span className="ml-0.5 px-0.5 rounded text-[9px] bg-blue-600 text-white">T</span>}
          {linen && <span className="ml-0.5 px-0.5 rounded text-[9px] bg-orange-500 text-white">C</span>}
          {(row.had_room_cleaning_request || flags.roomCleaning) && <span className="ml-0.5 px-0.5 rounded text-[9px] bg-green-600 text-white">RC</span>}
          {(row.had_extra_towels_request || flags.collectExtraTowels) && <span className="ml-0.5 text-[9px]">🧺</span>}
          {room.checkout && (row.had_ready_to_clean || row.ready_to_clean) && !room.approved && <span className="ml-0.5 px-0.5 rounded text-[9px] bg-green-600 text-white">RTC</span>}
          {noService && <span className="ml-0.5 px-0.5 rounded text-[9px] bg-gray-600 text-white">NS</span>}
          {room.approved && !noService && <span className="ml-0.5 text-[9px]">✅</span>}
          {room.dnd === 'active' && <span className="ml-0.5 text-[9px]">🚫</span>}
          {room.dnd === 'earlier' && <span className="ml-0.5 text-[9px] text-purple-800" aria-label="DND earlier">DND*</span>}
          {room.dnd === 'conflict' && <span className="ml-0.5 text-[9px]" aria-label="DND inconsistency">⚠️</span>}
          {!room.approved && row.assignment_status === 'completed' && <span className="ml-0.5 text-[9px]">⏳</span>}
          {size && <span className="ml-0.5 text-[8px] opacity-70">{size}</span>}
        </button>
        {config && <span className="text-[8px] text-purple-600 font-semibold truncate max-w-[48px]">{config}</span>}
        {flags.cleanNotes && <span className="text-[8px]" title={flags.cleanNotes}>📝</span>}
        {name && <span className="text-[9px] text-muted-foreground font-medium leading-tight text-center max-w-[76px] break-words">{name}</span>}
      </div>
    );
  };

  const section = (heading: string, sectionRooms: VerifiedRoom[], sectionType: string) => {
    const floors = new Map<number, VerifiedRoom[]>();
    for (const room of sectionRooms) {
      const parsed = Number.parseInt(room.snapshot.room_number, 10);
      const floor = room.snapshot.floor_number ?? (Number.isFinite(parsed) ? Math.floor(parsed / 100) : 0);
      const list = floors.get(floor) || [];
      list.push(room);
      floors.set(floor, list);
    }
    const activeCount = sectionRooms.filter(room => room.dnd === 'active').length;
    const earlierCount = sectionRooms.filter(room => room.dnd === 'earlier').length;
    const conflictCount = sectionRooms.filter(room => room.dnd === 'conflict').length;
    return (
      <div className="space-y-2 py-1">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <BedDouble className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-sm font-semibold">{heading}</span><Badge variant="secondary" className="text-xs">{sectionRooms.length}</Badge>
            {sectionType === 'noshow' && !!sectionRooms.length && <span className="text-[10px] text-red-700">No-show rooms saved for this date</span>}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {activeCount > 0 && <Badge variant="outline" className="text-purple-700 border-purple-400 text-xs"><EyeOff className="h-3 w-3 mr-1" />{activeCount} active DND</Badge>}
            {earlierCount > 0 && <Badge variant="outline" className="text-purple-700 border-purple-300 text-xs">{earlierCount} DND encountered</Badge>}
            {conflictCount > 0 && <Badge variant="outline" className="text-red-700 border-red-400 text-xs"><AlertTriangle className="h-3 w-3 mr-1" />{conflictCount} DND inconsistencies</Badge>}
          </div>
        </div>
        {!sectionRooms.length ? <p className="text-xs text-muted-foreground pl-6">{t('roomOverview.noRooms')}</p>
          : [...floors.entries()].sort((a, b) => a[0] - b[0]).map(([floor, items]) => (
            <div key={floor} className="flex items-start gap-2">
              <Badge variant="outline" className="text-[10px] min-w-[28px] shrink-0 mt-0.5">F{floor}</Badge>
              <div className="flex flex-wrap gap-1.5">{items.map(roomChip)}</div>
            </div>
          ))}
      </div>
    );
  };

  const selectedRoom = rooms.find(room => room.snapshot.room_id === selectedRoomId);
  if (loading) return <Card><CardContent className="flex items-center gap-2 py-8 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading saved housekeeping history…</CardContent></Card>;
  if (error) return <Card className="border-red-300"><CardContent className="py-6 text-sm text-red-700">{error}</CardContent></Card>;

  return (
    <>
      <Card id="hotel-room-overview" className="border-primary/20">
        <CardHeader className="pb-2 pt-3 px-3 sm:px-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm sm:text-base font-semibold flex items-center gap-1.5"><Hotel className="h-4 w-4 text-primary shrink-0" />{t('team.hotelRoomOverview')}</CardTitle>
            <Badge variant="outline" className="text-[10px] shrink-0">{selectedDate} · {t('team.readOnly')}</Badge>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[[t('team.total'), rooms.length], [t('team.earlyCheckout'), earlyCheckoutRooms.length], [t('team.noShow'), noShowRooms.length], [t('team.act'), averageCleanTime]].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border bg-muted/40 px-2 py-1.5 text-center">
                <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
                <div className="text-sm font-semibold leading-tight">{value}</div>
              </div>
            ))}
          </div>
          {evidenceWarning && <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">{evidenceWarning}</div>}
          <div>
            <button type="button" onClick={() => setShowLegend(previous => !previous)} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
              <ChevronDown className={`h-3 w-3 ${showLegend ? '' : '-rotate-90'}`} />{showLegend ? t('legend.hideLegend') : t('legend.showLegend')}
            </button>
            {showLegend && <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-2 p-2 rounded-md bg-muted/30 border border-border/50 text-[10px] text-muted-foreground">
              <span>🟩 Approved / Clean</span><span>🟨 Dirty / Assigned</span><span>🟦 In progress</span><span>🟪 Pending approval</span>
              <span>🚫 Active DND</span><span>DND* Recorded on this day, not active</span><span>⚠️ Inconsistent saved DND</span>
              <span>T Towel change</span><span>C Linen change</span><span>RC Clean Room</span><span>RTC Ready to Clean</span><span>NS No service</span>
            </div>}
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-3">
          {section(t('team.checkoutRooms'), checkoutRooms, 'checkout')}
          <div className="border-t border-border/50" />
          {section(t('team.dailyRooms'), dailyRooms, 'daily')}
          {!!arrivalRooms.length && <><div className="border-t border-border/50" />{section(t('team.arrivalRooms'), arrivalRooms, 'arrival')}</>}
          {!!noShowRooms.length && <><div className="border-t border-border/50" />{section(t('team.noShowRooms'), noShowRooms, 'noshow')}</>}
          {!!tasks.length && <><div className="border-t border-border/50" />
            <div className="flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4" />{t('roomOverview.publicAreas')}<Badge variant="secondary">{tasks.length}</Badge></div>
            <div className="flex flex-wrap gap-2">{tasks.map(task => (
              <div key={task.id} className="flex flex-col items-center">
                <span className={`rounded border px-2 py-1 text-xs ${task.status === 'completed' ? COLORS.approved : COLORS.dirty}`}>{task.task_name}</span>
                <span className="text-[9px] text-muted-foreground">{assigneeLabel(staffMap, task.assigned_to)}</span>
              </div>
            ))}</div>
          </>}
        </CardContent>
      </Card>
      <Dialog open={Boolean(selectedRoom)} onOpenChange={open => { if (!open) setSelectedRoomId(null); }}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          {selectedRoom && <>
            <DialogHeader><DialogTitle>Room {selectedRoom.snapshot.room_number} — {selectedDate} (read-only)</DialogTitle></DialogHeader>
            <div className="space-y-2 text-sm">
              <p><strong>Saved status:</strong> {selectedRoom.snapshot.assignment_status || selectedRoom.snapshot.room_status || 'Not recorded'}; supervisor approved: {selectedRoom.approved ? 'Yes' : 'No'}.</p>
              <p><strong>DND verification:</strong> {selectedRoom.dnd === 'none'
                ? 'No DND event verified for this date.' : selectedRoom.dnd === 'earlier'
                  ? 'DND encounter recorded on this date; not shown as an active block on an approved room.'
                  : selectedRoom.dnd === 'active' ? 'DND reported at the saved cutoff.'
                    : 'Saved DND and approval states conflict; review the audit trail.'}</p>
              {selectedRoom.dnd === 'none' && selectedRoom.snapshot.had_dnd &&
                <p className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">The raw snapshot has had_dnd=true, but this date’s assignment has no recorded DND attempt. A previous-day flag can carry into the midnight capture; it is not counted as a DND event for {selectedDate}.</p>}
              <p><strong>Cleaning started:</strong> {localTime(selectedRoom.assignment?.started_at || selectedRoom.snapshot.assignment_started_at)}</p>
              <p><strong>Cleaning finished:</strong> {localTime(selectedRoom.assignment?.completed_at || selectedRoom.snapshot.assignment_completed_at)}</p>
              <p><strong>Approved at:</strong> {localTime(selectedRoom.assignment?.supervisor_approved_at)}</p>
              <p><strong>Verified DND photos on this assignment/date:</strong> {selectedRoom.evidence.length}</p>
              {selectedRoom.evidence.map(photo => <p key={photo.id} className="pl-3 text-xs">Attempt {photo.attempt_number ?? '?'} — {localTime(photo.marked_at)}</p>)}
              <p className="text-xs text-muted-foreground">Snapshot source: {selectedRoom.snapshot.source || 'Unknown'}; first captured {localTime(selectedRoom.snapshot.captured_at)}; updated {localTime(selectedRoom.snapshot.updated_at)}. All original snapshot flags and status events remain unchanged.</p>
              {Array.isArray(selectedRoom.snapshot.status_history) && <div className="border-t pt-2">
                <strong>Raw saved status timeline</strong>
                <p className="text-xs text-muted-foreground">These are raw technical captures; an overnight carried flag is not by itself a new DND attempt.</p>
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">{selectedRoom.snapshot.status_history.map((event, index) => <div key={`${event.at || 'unknown'}-${index}`} className="text-xs border-b py-1">
                  {localTime(event.at)} · {event.assignment_status || event.room_status || 'Status update'} · DND flag: {event.is_dnd === true ? 'yes' : event.is_dnd === false ? 'no' : 'not recorded'}
                </div>)}</div>
              </div>}
            </div>
          </>}
        </DialogContent>
      </Dialog>
    </>
  );
}
