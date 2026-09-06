import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BedDouble, ChevronDown, EyeOff, Hotel, Loader2, MapPin } from 'lucide-react';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { assigneeLabel, cleanName } from '@/lib/staffNames';
import { parseRoomFlags } from '@/lib/room-service-flags';
import { summarizePmsNote } from '@/lib/pmsNoteParser';
import { useTranslation } from '@/hooks/useTranslation';

interface HistoricalHotelRoomOverviewProps {
  selectedDate: string;
  hotelName: string;
  staffMap: Record<string, string>;
  refreshKey?: number;
  signedInHousekeepers?: Array<{
    id: string;
    fullName: string;
    nickname?: string | null;
    onBreak?: boolean;
  }>;
}

interface RoomSnapshot {
  business_date: string;
  room_id: string;
  hotel: string;
  room_number: string;
  floor_number: number | null;
  venue_id: string | null;
  room_size_sqm: number | null;
  bed_type: string | null;
  bed_configuration: string | null;
  room_status: string | null;
  is_checkout_room: boolean | null;
  is_dnd: boolean | null;
  towel_change_required: boolean | null;
  linen_change_required: boolean | null;
  room_notes: string | null;
  pms_metadata: any;
  guest_nights_stayed: number | null;
  had_dnd: boolean | null;
  had_towel_change: boolean | null;
  had_linen_change: boolean | null;
  had_room_cleaning_request: boolean | null;
  had_extra_towels_request: boolean | null;
  had_ready_to_clean: boolean | null;
  had_no_service: boolean | null;
  assignment_id: string | null;
  assigned_to: string | null;
  assignment_type: string | null;
  assignment_status: string | null;
  assignment_started_at: string | null;
  assignment_completed_at: string | null;
  supervisor_approved: boolean | null;
  ready_to_clean: boolean | null;
  pms_hold: boolean | null;
  assignment_notes: string | null;
  dnd_attempt_count: number | null;
  source: string | null;
  captured_at: string | null;
  updated_at: string | null;
}

interface HistoricalTask {
  id: string;
  task_name: string;
  task_type: string;
  assigned_to: string;
  status: string;
}

type SectionType = 'checkout' | 'daily' | 'noshow' | 'arrival';

type StatusKey = 'clean' | 'dirty' | 'in_progress' | 'out_of_order' | 'inspected' | 'pending_approval';

const STATUS_COLORS: Record<StatusKey, string> = {
  clean: 'bg-emerald-200 text-emerald-900 border-emerald-500 dark:bg-emerald-900/50 dark:text-emerald-200 dark:border-emerald-600',
  dirty: 'bg-amber-200 text-amber-900 border-amber-500 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-600',
  in_progress: 'bg-sky-200 text-sky-900 border-sky-500 dark:bg-sky-900/50 dark:text-sky-200 dark:border-sky-600',
  out_of_order: 'bg-red-200 text-red-900 border-red-500 dark:bg-red-900/50 dark:text-red-200 dark:border-red-600',
  inspected: 'bg-teal-200 text-teal-900 border-teal-500 dark:bg-teal-900/50 dark:text-teal-200 dark:border-teal-600',
  pending_approval: 'bg-violet-200 text-violet-900 border-violet-500 dark:bg-violet-900/50 dark:text-violet-200 dark:border-violet-600',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  assigned: 'bg-amber-200 text-amber-900 border-amber-500 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-600',
  in_progress: 'bg-sky-200 text-sky-900 border-sky-500 dark:bg-sky-900/50 dark:text-sky-200 dark:border-sky-600',
  completed: 'bg-emerald-200 text-emerald-900 border-emerald-500 dark:bg-emerald-900/50 dark:text-emerald-200 dark:border-emerald-600',
};

const DEFAULT_COLOR = 'bg-muted text-muted-foreground border-border';

function getSizeLabel(sqm: number | null): string | null {
  if (!sqm) return null;
  if (sqm <= 18) return 'S';
  if (sqm <= 30) return 'M';
  if (sqm <= 40) return 'L';
  return 'XL';
}

function statusKey(row: RoomSnapshot): StatusKey {
  if (row.assignment_status === 'completed' && row.supervisor_approved) return 'clean';
  if (row.assignment_status === 'completed') return 'pending_approval';
  if (row.assignment_status === 'in_progress' || row.room_status === 'in_progress') return 'in_progress';
  if (row.room_status === 'out_of_order') return 'out_of_order';
  if (row.room_status === 'inspected') return 'inspected';
  if (row.room_status === 'clean') return 'clean';
  return 'dirty';
}

function isCheckout(row: RoomSnapshot): boolean {
  const meta = row.pms_metadata || {};
  if (meta.manual_daily === true) return false;
  if (row.is_checkout_room === true || meta.scheduledDepartureToday === true) return true;
  return row.assignment_type === 'checkout_cleaning';
}

function isNoShow(row: RoomSnapshot): boolean {
  return row.pms_metadata?.isNoShow === true || (row.room_notes || '').toLowerCase().includes('no show');
}

function isEarlyCheckout(row: RoomSnapshot): boolean {
  return isCheckout(row) && (row.room_notes || '').toLowerCase().includes('early checkout');
}

function isArrivalOnly(row: RoomSnapshot): boolean {
  return !isCheckout(row)
    && !isNoShow(row)
    && row.pms_metadata?.arrivalToday === true
    && row.pms_metadata?.occupiedToday !== true;
}

function floorNumber(row: RoomSnapshot): number {
  if (row.floor_number != null) return row.floor_number;
  const parsed = Number.parseInt(row.room_number, 10);
  return Number.isFinite(parsed) ? Math.floor(parsed / 100) : 0;
}

function bedLabel(config: string | null): string | null {
  if (!config) return null;
  if (config.includes('Double')) return 'DB';
  if (config.includes('Twin') && config.includes('Sep')) return 'TW-S';
  if (config.includes('Twin')) return 'TW';
  if (config.includes('Single')) return 'SGL';
  if (config.includes('Baby')) return '👶BB';
  if (config.includes('Sofa')) return 'SOFA';
  if (config.includes('Extra') || config.includes('Cot')) return '+COT';
  return config.substring(0, 3).toUpperCase();
}

export function HistoricalHotelRoomOverviewSaved({
  selectedDate,
  hotelName,
  staffMap,
  refreshKey,
}: HistoricalHotelRoomOverviewProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<RoomSnapshot[]>([]);
  const [tasks, setTasks] = useState<HistoricalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const resolved = await resolveHotelKeys(hotelName);
        const hotelKeys = resolved.length ? resolved : [hotelName];
        const [historyRes, tasksRes] = await Promise.all([
          (supabase as any)
            .from('housekeeping_room_snapshots')
            .select('business_date, room_id, hotel, room_number, floor_number, venue_id, room_size_sqm, bed_type, bed_configuration, room_status, is_checkout_room, is_dnd, towel_change_required, linen_change_required, room_notes, pms_metadata, guest_nights_stayed, had_dnd, had_towel_change, had_linen_change, had_room_cleaning_request, had_extra_towels_request, had_ready_to_clean, had_no_service, assignment_id, assigned_to, assignment_type, assignment_status, assignment_started_at, assignment_completed_at, supervisor_approved, ready_to_clean, pms_hold, assignment_notes, dnd_attempt_count, source, captured_at, updated_at')
            .in('hotel', hotelKeys)
            .eq('business_date', selectedDate)
            .order('room_number'),
          supabase
            .from('general_tasks')
            .select('id, task_name, task_type, assigned_to, status')
            .in('hotel', hotelKeys)
            .eq('assigned_date', selectedDate),
        ]);

        if (historyRes.error) throw historyRes.error;
        if (tasksRes.error) throw tasksRes.error;
        if (cancelled) return;

        const byRoomNumber = new Map<string, RoomSnapshot>();
        for (const row of (historyRes.data || []) as RoomSnapshot[]) {
          const key = String(row.room_number || '').trim();
          const existing = byRoomNumber.get(key);
          if (!existing || (row.source === 'live_capture' && existing.source !== 'live_capture')) {
            byRoomNumber.set(key, row);
          }
        }
        setRows([...byRoomNumber.values()].sort((a, b) =>
          String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true }),
        ));
        setTasks((tasksRes.data || []) as HistoricalTask[]);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load the saved housekeeping day.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [selectedDate, hotelName, refreshKey]);

  const checkoutRooms = useMemo(() => rows.filter(isCheckout), [rows]);
  const arrivalRooms = useMemo(() => rows.filter(isArrivalOnly), [rows]);
  const noShowRooms = useMemo(() => rows.filter(r => isNoShow(r) && !isCheckout(r)), [rows]);
  const dailyRooms = useMemo(() => rows.filter(r => !isCheckout(r) && !isNoShow(r) && !isArrivalOnly(r)), [rows]);
  const earlyCheckoutRooms = useMemo(() => rows.filter(isEarlyCheckout), [rows]);

  const averageCleanTime = useMemo(() => {
    const durations = rows.flatMap(row => {
      if (!row.assignment_started_at || !row.assignment_completed_at) return [];
      const start = Date.parse(row.assignment_started_at);
      const end = Date.parse(row.assignment_completed_at);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
      const minutes = (end - start) / 60_000;
      return minutes > 0 && minutes < 12 * 60 ? [minutes] : [];
    });
    if (!durations.length) return null;
    return Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
  }, [rows]);

  const renderRoomChip = (room: RoomSnapshot) => {
    const checkout = isCheckout(room);
    const status = statusKey(room);
    const colorClass = STATUS_COLORS[status] || DEFAULT_COLOR;
    const flags = parseRoomFlags(room.room_notes);
    const dnd = Boolean(room.had_dnd || room.is_dnd || (room.dnd_attempt_count || 0) > 0 || room.assignment_status === 'dnd_pending_retry');
    const noShow = isNoShow(room) && !isEarlyCheckout(room);
    const earlyCheckout = isEarlyCheckout(room);
    const towel = Boolean(room.had_towel_change || room.towel_change_required) && !checkout;
    const linen = Boolean(room.had_linen_change || room.linen_change_required) && !checkout;
    const cleanRequest = Boolean(room.had_room_cleaning_request || flags.roomCleaning);
    const extraTowels = Boolean(room.had_extra_towels_request || flags.collectExtraTowels);
    const noService = Boolean(room.had_no_service || room.assignment_notes?.includes('[NO_SERVICE]'));
    const approved = room.assignment_status === 'completed' && room.supervisor_approved === true;
    const pending = room.assignment_status === 'completed' && room.supervisor_approved !== true;
    const ready = checkout && Boolean(room.had_ready_to_clean || room.ready_to_clean) && !approved;
    const size = getSizeLabel(room.room_size_sqm);
    const staffName = assigneeLabel(staffMap, room.assigned_to);
    const config = bedLabel(room.bed_configuration);
    const meta = room.pms_metadata || {};
    const currentNight = Number(meta.currentNight ?? meta.current_night ?? room.guest_nights_stayed);
    const totalNights = Number(meta.totalNights ?? meta.total_nights);
    const showCheckoutTomorrow = meta.scheduledDepartureTomorrow === true
      && !checkout
      && meta.scheduledDepartureToday !== true
      && meta.checkedOutToday !== true
      && (!Number.isFinite(currentNight) || !Number.isFinite(totalNights) || currentNight <= 0 || totalNights <= 0 || currentNight === totalNights);

    return (
      <div key={room.room_id} className="flex flex-col items-center gap-0.5 select-none">
        <div
          className={`relative rounded border-2 px-2 py-1 text-xs font-bold min-w-[40px] text-center ${colorClass} ${dnd ? 'ring-2 ring-purple-500 ring-offset-1' : ''} ${noShow ? 'ring-2 ring-red-600 ring-offset-1' : ''} ${earlyCheckout ? 'ring-2 ring-orange-500 ring-offset-1' : ''}`}
          title={[
            `Room ${room.room_number}`,
            checkout ? 'Checkout' : 'Daily',
            room.assignment_status ? `Assignment: ${room.assignment_status.replace(/_/g, ' ')}` : null,
            room.room_status ? `Room: ${room.room_status.replace(/_/g, ' ')}` : null,
            towel ? 'Towel change recorded' : null,
            linen ? 'Linen change recorded' : null,
            dnd ? 'DND / DND attempt recorded' : null,
            cleanRequest ? 'Clean Room request recorded' : null,
            noService ? 'No Service recorded' : null,
            staffName ? `Assigned: ${staffName}` : null,
          ].filter(Boolean).join(' · ')}
        >
          {room.room_number}
          {meta.isNoShow === true && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-red-600 text-white">NS</span>}
          {meta.notArrived === true && meta.isNoShow !== true && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-slate-500 text-white">NA</span>}
          {meta.manual_checkout === true && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-amber-500 text-white">M</span>}
          {showCheckoutTomorrow && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-indigo-600 text-white">C/O+1</span>}
          {room.bed_type === 'shabath' && <span className="ml-0.5 text-[9px] font-extrabold text-blue-700 dark:text-blue-300">SH</span>}
          {towel && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-blue-600 text-white">T</span>}
          {linen && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-orange-500 text-white">C</span>}
          {cleanRequest && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-green-600 text-white">RC</span>}
          {extraTowels && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-orange-500 text-white">🧺</span>}
          {ready && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-green-600 text-white">RTC</span>}
          {noService && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-gray-500 text-white">NS</span>}
          {approved && !noService && <span className="ml-0.5 text-[9px]">✅</span>}
          {dnd && <span className="ml-0.5 text-[9px]">🚫</span>}
          {noShow && <span className="ml-0.5 text-[9px]">⚠️</span>}
          {earlyCheckout && <span className="ml-0.5 text-[9px]">🔶</span>}
          {pending && <span className="ml-0.5 text-[9px]">⏳</span>}
          {room.assignment_status === 'in_progress' && <span className="ml-0.5 text-[9px]">⏱</span>}
          {size && <span className="ml-0.5 text-[8px] opacity-70">{size}</span>}
        </div>
        <div className="flex flex-col items-center gap-0">
          {config && <span className="text-[8px] text-purple-600 dark:text-purple-400 font-semibold truncate max-w-[48px]">{config}</span>}
          {flags.cleanNotes && <span className="text-[8px]" title={summarizePmsNote(flags.cleanNotes) || flags.cleanNotes}>📝</span>}
          {staffName && (
            <span className="text-[9px] text-muted-foreground font-medium leading-tight text-center max-w-[76px] break-words" title={cleanName(staffMap[room.assigned_to || '']) || undefined}>
              {staffName}
            </span>
          )}
        </div>
      </div>
    );
  };

  const renderSection = (title: string, roomList: RoomSnapshot[], icon: React.ReactNode, sectionType: SectionType) => {
    const grouped = new Map<number, RoomSnapshot[]>();
    for (const room of roomList) {
      const floor = floorNumber(room);
      if (!grouped.has(floor)) grouped.set(floor, []);
      grouped.get(floor)!.push(room);
    }
    const floors = [...grouped.entries()].sort((a, b) => a[0] - b[0]);
    const dndCount = roomList.filter(r => Boolean(r.had_dnd || r.is_dnd || (r.dnd_attempt_count || 0) > 0)).length;

    return (
      <div className="space-y-2 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            {icon}
            <span className="text-sm font-semibold">{title}</span>
            <Badge variant="secondary" className="text-xs">{roomList.length}</Badge>
            {sectionType === 'noshow' && roomList.length > 0 && (
              <span className="text-[10px] text-red-700 dark:text-red-300 font-medium">No-show rooms saved for this date</span>
            )}
          </div>
          {dndCount > 0 && (
            <Badge variant="outline" className="text-purple-600 border-purple-300 text-xs">
              <EyeOff className="h-3 w-3 mr-1" /> {dndCount} DND
            </Badge>
          )}
        </div>

        {floors.length === 0 ? (
          <p className="text-xs text-muted-foreground pl-6">{t('roomOverview.noRooms')}</p>
        ) : (
          <div className="space-y-1.5">
            {floors.map(([floor, floorRooms]) => (
              <div key={floor} className="flex items-start gap-2">
                <Badge variant="outline" className="text-[10px] min-w-[28px] text-center shrink-0 mt-0.5">F{floor}</Badge>
                <div className="flex flex-wrap gap-1.5">
                  {floorRooms
                    .sort((a, b) => String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true }))
                    .map(renderRoomChip)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderPublicAreas = () => {
    if (!tasks.length) return null;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 text-emerald-600" />
          <span className="text-sm font-semibold">{t('roomOverview.publicAreas')}</span>
          <Badge variant="secondary" className="text-xs">{tasks.length}</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tasks.map(task => {
            const colorClass = TASK_STATUS_COLORS[task.status] || DEFAULT_COLOR;
            const staffName = assigneeLabel(staffMap, task.assigned_to);
            return (
              <div key={task.id} className="flex flex-col items-center gap-0.5">
                <div className={`px-2 py-1 rounded text-xs font-semibold border ${colorClass} min-w-[40px] text-center`}>
                  {task.task_name}
                </div>
                {staffName && <span className="text-[9px] text-muted-foreground font-medium leading-tight text-center max-w-[76px] break-words">{staffName}</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading room overview...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-red-300">
        <CardContent className="py-5 text-sm text-red-700">{error}</CardContent>
      </Card>
    );
  }

  return (
    <Card id="hotel-room-overview" className="border-primary/20">
      <CardHeader className="pb-2 pt-3 px-3 sm:px-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm sm:text-base font-semibold flex items-center gap-1.5 min-w-0">
            <Hotel className="h-4 w-4 text-primary shrink-0" />
            <span className="truncate">{t('team.hotelRoomOverview')}</span>
          </CardTitle>
          <Badge variant="outline" className="text-[10px] shrink-0">{selectedDate} · {t('team.readOnly')}</Badge>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <div className="rounded-lg border bg-muted/40 px-2 py-1.5 text-center">
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{t('team.total')}</div>
            <div className="text-sm font-semibold leading-tight">{rows.length}</div>
          </div>
          <div className={`rounded-lg border px-2 py-1.5 text-center ${earlyCheckoutRooms.length > 0 ? 'bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-700' : 'bg-muted/40'}`}>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{t('team.earlyCheckout')}</div>
            <div className={`text-sm font-semibold leading-tight ${earlyCheckoutRooms.length > 0 ? 'text-orange-700 dark:text-orange-300' : ''}`}>{earlyCheckoutRooms.length}</div>
          </div>
          <div className={`rounded-lg border px-2 py-1.5 text-center ${noShowRooms.length > 0 ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-700' : 'bg-muted/40'}`}>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{t('team.noShow')}</div>
            <div className={`text-sm font-semibold leading-tight ${noShowRooms.length > 0 ? 'text-red-700 dark:text-red-300' : ''}`}>{noShowRooms.length}</div>
          </div>
          <div className="rounded-lg border bg-muted/40 px-2 py-1.5 text-center">
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{t('team.act')}</div>
            <div className="text-sm font-semibold leading-tight">{averageCleanTime !== null ? `${averageCleanTime}m` : '--'}</div>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowLegend(prev => !prev)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${showLegend ? '' : '-rotate-90'}`} />
            {showLegend ? t('legend.hideLegend') : t('legend.showLegend')}
          </button>
          {showLegend && (
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-x-3 gap-y-1.5 mt-2 p-2 rounded-md bg-muted/30 border border-border/50">
              {[
                ['Approved / Clean', 'bg-emerald-200 border-emerald-500', null],
                ['Dirty / Assigned', 'bg-amber-200 border-amber-500', null],
                ['In progress', 'bg-sky-200 border-sky-500', null],
                ['Pending approval', 'bg-violet-200 border-violet-500', null],
                ['DND', 'ring-2 ring-purple-500 bg-muted', null],
                ['Towel change', 'bg-blue-600 text-white text-[8px] font-bold px-0.5', 'T'],
                ['Linen change', 'bg-orange-500 text-white text-[8px] font-bold px-0.5', 'C'],
                ['Clean Room', 'bg-green-600 text-white text-[8px] font-bold px-0.5', 'RC'],
                ['Extra towels', 'bg-orange-500 text-white text-[8px] font-bold px-0.5', '🧺'],
                ['Ready to Clean', 'bg-green-600 text-white text-[8px] font-bold px-0.5', 'RTC'],
                ['No Service', 'bg-gray-500 text-white text-[8px] font-bold px-0.5', 'NS'],
                ['Departs tomorrow', 'bg-indigo-600 text-white text-[8px] font-bold px-0.5', 'C/O+1'],
              ].map(([label, cls, text]) => (
                <div key={label} className="flex items-center gap-1">
                  {text ? <span className={`rounded ${cls}`}>{text}</span> : <span className={`w-3 h-3 rounded border-2 ${cls}`} />}
                  <span className="text-[10px] text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-3 space-y-3">
        {renderSection(t('team.checkoutRooms'), checkoutRooms, <BedDouble className="h-3.5 w-3.5 text-amber-600" />, 'checkout')}
        <div className="border-t border-border/50" />
        {renderSection(t('team.dailyRooms'), dailyRooms, <BedDouble className="h-3.5 w-3.5 text-blue-600" />, 'daily')}
        {arrivalRooms.length > 0 && (
          <>
            <div className="border-t border-border/50" />
            {renderSection(t('team.arrivalRooms'), arrivalRooms, <BedDouble className="h-3.5 w-3.5 text-emerald-600" />, 'arrival')}
          </>
        )}
        {noShowRooms.length > 0 && (
          <>
            <div className="border-t border-border/50" />
            {renderSection(t('team.noShowRooms'), noShowRooms, <BedDouble className="h-3.5 w-3.5 text-red-600" />, 'noshow')}
          </>
        )}
        {tasks.length > 0 && (
          <>
            <div className="border-t border-border/50" />
            {renderPublicAreas()}
          </>
        )}
      </CardContent>
    </Card>
  );
}
