import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BedDouble, CalendarClock, History, Loader2, MapPin } from 'lucide-react';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { assigneeLabel } from '@/lib/staffNames';

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

interface StaticRoom {
  id: string;
  hotel: string | null;
  room_number: string;
  floor_number: number | null;
  venue_id?: string | null;
  room_size_sqm: number | null;
  bed_type: string | null;
  bed_configuration?: string | null;
}

interface HistoricalAssignment {
  id: string;
  room_id: string;
  assigned_to: string;
  status: string;
  assignment_type: string;
  started_at: string | null;
  completed_at?: string | null;
  supervisor_approved: boolean | null;
  ready_to_clean: boolean | null;
  pms_hold?: boolean | null;
  notes: string | null;
  is_dnd?: boolean | null;
  dnd_attempt_count?: number | null;
}

interface RoomHistorySnapshot {
  business_date: string;
  room_id: string;
  hotel: string;
  room_number: string;
  room_status: string | null;
  is_checkout_room: boolean | null;
  is_dnd: boolean;
  towel_change_required: boolean;
  linen_change_required: boolean;
  had_dnd: boolean;
  had_towel_change: boolean;
  had_linen_change: boolean;
  had_room_cleaning_request: boolean;
  had_extra_towels_request: boolean;
  had_ready_to_clean: boolean;
  had_no_service: boolean;
  assignment_id: string | null;
  assigned_to: string | null;
  assignment_type: string | null;
  assignment_status: string | null;
  supervisor_approved: boolean | null;
  ready_to_clean: boolean | null;
  pms_hold: boolean | null;
  assignment_notes: string | null;
  dnd_attempt_count: number | null;
  pms_metadata: any;
  source: string;
  captured_at: string;
  updated_at: string;
}

interface HistoricalRoom extends StaticRoom {
  assignment?: HistoricalAssignment;
  history?: RoomHistorySnapshot;
  isCheckout: boolean;
  currentNight: number | null;
  towelChange: boolean;
  linenChange: boolean;
}

interface HistoricalTask {
  id: string;
  task_name: string;
  task_type: string;
  assigned_to: string;
  status: string;
}

const normalize = (value: unknown): string => String(value ?? '').trim().toLowerCase();
const digitsOnly = (value: unknown): string => String(value ?? '').match(/\d+/)?.[0] ?? '';

const sizeLabel = (sqm: number | null): string | null => {
  if (!sqm) return null;
  if (sqm <= 18) return 'S';
  if (sqm <= 30) return 'M';
  if (sqm <= 40) return 'L';
  return 'XL';
};

const assignmentRank = (assignment: HistoricalAssignment): number => {
  if (assignment.status === 'completed' && assignment.supervisor_approved) return 6;
  if (assignment.status === 'completed') return 5;
  if (assignment.status === 'in_progress') return 4;
  if (assignment.status === 'dnd_pending_retry') return 3;
  if (assignment.status === 'assigned') return 2;
  return 1;
};

const floorLabel = (floor: number | null): string => floor == null ? 'Other' : `F${floor}`;

const statusStyle = (
  assignmentStatus: string | null | undefined,
  approved: boolean,
  noService: boolean,
  roomStatus: string | null | undefined,
): string => {
  if (noService) {
    return 'bg-slate-200 text-slate-800 border-slate-400 dark:bg-slate-800 dark:text-slate-200';
  }
  if (assignmentStatus === 'completed' && approved) {
    return 'bg-emerald-200 text-emerald-900 border-emerald-500 dark:bg-emerald-900/50 dark:text-emerald-200';
  }
  if (assignmentStatus === 'completed') {
    return 'bg-violet-200 text-violet-900 border-violet-500 dark:bg-violet-900/50 dark:text-violet-200';
  }
  if (assignmentStatus === 'in_progress') {
    return 'bg-sky-200 text-sky-900 border-sky-500 dark:bg-sky-900/50 dark:text-sky-200';
  }
  if (assignmentStatus === 'dnd_pending_retry') {
    return 'bg-purple-100 text-purple-900 border-purple-500 dark:bg-purple-900/50 dark:text-purple-200';
  }
  if (assignmentStatus) {
    return 'bg-amber-200 text-amber-900 border-amber-500 dark:bg-amber-900/50 dark:text-amber-200';
  }
  if (roomStatus === 'clean' || roomStatus === 'inspected') {
    return 'bg-emerald-200 text-emerald-900 border-emerald-500 dark:bg-emerald-900/50 dark:text-emerald-200';
  }
  if (roomStatus === 'in_progress') {
    return 'bg-sky-200 text-sky-900 border-sky-500 dark:bg-sky-900/50 dark:text-sky-200';
  }
  if (roomStatus === 'dirty') {
    return 'bg-amber-200 text-amber-900 border-amber-500 dark:bg-amber-900/50 dark:text-amber-200';
  }
  return 'bg-muted text-muted-foreground border-border';
};

const statusLabel = (
  assignmentStatus: string | null | undefined,
  approved: boolean,
  noService: boolean,
  roomStatus: string | null | undefined,
): string => {
  if (noService) return 'No service';
  if (assignmentStatus === 'completed' && approved) return 'Approved';
  if (assignmentStatus === 'completed') return 'Pending approval';
  if (assignmentStatus === 'dnd_pending_retry') return 'DND retry';
  if (assignmentStatus) return assignmentStatus.replace(/_/g, ' ');
  if (roomStatus) return roomStatus.replace(/_/g, ' ');
  return 'No recorded status';
};

export function HistoricalHotelRoomOverview({
  selectedDate,
  hotelName,
  staffMap,
  refreshKey,
}: HistoricalHotelRoomOverviewProps) {
  const [rooms, setRooms] = useState<StaticRoom[]>([]);
  const [assignments, setAssignments] = useState<HistoricalAssignment[]>([]);
  const [historyRows, setHistoryRows] = useState<RoomHistorySnapshot[]>([]);
  const [tasks, setTasks] = useState<HistoricalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const resolved = await resolveHotelKeys(hotelName);
        const hotelKeys = resolved.length ? resolved : [hotelName];

        const [roomsRes, assignmentsRes, historyRes, tasksRes] = await Promise.all([
          supabase
            .from('rooms')
            .select('id, hotel, room_number, floor_number, venue_id, room_size_sqm, bed_type, bed_configuration')
            .in('hotel', hotelKeys)
            .order('room_number'),
          supabase
            .from('room_assignments')
            .select('id, room_id, assigned_to, status, assignment_type, started_at, completed_at, supervisor_approved, ready_to_clean, pms_hold, notes, is_dnd, dnd_attempt_count')
            .eq('assignment_date', selectedDate),
          (supabase as any)
            .from('housekeeping_room_snapshots')
            .select('business_date, room_id, hotel, room_number, room_status, is_checkout_room, is_dnd, towel_change_required, linen_change_required, had_dnd, had_towel_change, had_linen_change, had_room_cleaning_request, had_extra_towels_request, had_ready_to_clean, had_no_service, assignment_id, assigned_to, assignment_type, assignment_status, supervisor_approved, ready_to_clean, pms_hold, assignment_notes, dnd_attempt_count, pms_metadata, source, captured_at, updated_at')
            .in('hotel', hotelKeys)
            .eq('business_date', selectedDate)
            .order('updated_at', { ascending: false }),
          supabase
            .from('general_tasks')
            .select('id, task_name, task_type, assigned_to, status')
            .in('hotel', hotelKeys)
            .eq('assigned_date', selectedDate),
        ]);

        if (roomsRes.error) throw roomsRes.error;
        if (assignmentsRes.error) throw assignmentsRes.error;
        if (historyRes.error) throw historyRes.error;
        if (tasksRes.error) throw tasksRes.error;
        if (cancelled) return;

        const rawRooms = (roomsRes.data ?? []) as StaticRoom[];
        const assignmentRows = (assignmentsRes.data ?? []) as HistoricalAssignment[];
        const persistedHistory = (historyRes.data ?? []) as RoomHistorySnapshot[];
        const assignmentRoomIds = new Set(assignmentRows.map((row) => row.room_id));
        const historyRoomIds = new Set(persistedHistory.map((row) => row.room_id));

        // Keep the room row which owns this date's historical data when legacy
        // display-name/canonical duplicates exist.
        const byNumber = new Map<string, StaticRoom>();
        const score = (room: StaticRoom) =>
          (historyRoomIds.has(room.id) ? 2000 : 0) +
          (assignmentRoomIds.has(room.id) ? 1000 : 0) +
          (room.hotel === hotelKeys[0] ? 200 : 0);

        for (const room of rawRooms) {
          const key = normalize(room.room_number);
          const existing = byNumber.get(key);
          if (!existing || score(room) > score(existing)) byNumber.set(key, room);
        }

        setRooms(Array.from(byNumber.values()).sort((a, b) =>
          String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true }),
        ));
        setAssignments(assignmentRows);
        setHistoryRows(persistedHistory);
        setTasks((tasksRes.data ?? []) as HistoricalTask[]);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load the historical housekeeping snapshot.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [selectedDate, hotelName, refreshKey]);

  const assignmentMap = useMemo(() => {
    const map = new Map<string, HistoricalAssignment>();
    for (const assignment of assignments) {
      const existing = map.get(assignment.room_id);
      if (!existing || assignmentRank(assignment) >= assignmentRank(existing)) {
        map.set(assignment.room_id, assignment);
      }
    }
    return map;
  }, [assignments]);

  const historyLookup = useMemo(() => {
    const byId = new Map<string, RoomHistorySnapshot>();
    const exact = new Map<string, RoomHistorySnapshot>();
    const digits = new Map<string, RoomHistorySnapshot>();

    // Query is newest-first. Keep the first row for any accidental legacy duplicate.
    for (const row of historyRows) {
      if (!byId.has(row.room_id)) byId.set(row.room_id, row);
      const key = normalize(row.room_number);
      if (key && !exact.has(key)) exact.set(key, row);
      const digitKey = digitsOnly(row.room_number);
      if (digitKey && !digits.has(digitKey)) digits.set(digitKey, row);
    }
    return { byId, exact, digits };
  }, [historyRows]);

  const historicalRooms = useMemo<HistoricalRoom[]>(() => rooms.map((room) => {
    const assignment = assignmentMap.get(room.id);
    const history = historyLookup.byId.get(room.id)
      ?? historyLookup.exact.get(normalize(room.room_number))
      ?? historyLookup.digits.get(digitsOnly(room.room_number));

    const assignmentType = history?.assignment_type ?? assignment?.assignment_type;
    const isCheckout = history?.is_checkout_room != null
      ? history.is_checkout_room
      : assignmentType === 'checkout_cleaning';

    const currentNightRaw = history?.pms_metadata?.currentNight ?? history?.pms_metadata?.current_night;
    const currentNight = Number.isFinite(Number(currentNightRaw)) ? Number(currentNightRaw) : null;

    return {
      ...room,
      assignment,
      history,
      isCheckout,
      currentNight,
      towelChange: Boolean(history?.had_towel_change || history?.towel_change_required),
      linenChange: Boolean(history?.had_linen_change || history?.linen_change_required),
    };
  }), [rooms, assignmentMap, historyLookup]);

  const checkoutRooms = historicalRooms.filter((room) => room.isCheckout);
  const dailyRooms = historicalRooms.filter((room) => !room.isCheckout);
  const latestCapture = historyRows[0]?.updated_at ?? historyRows[0]?.captured_at ?? null;
  const exactCaptureCount = historyRows.filter((row) =>
    row.source === 'live_capture' || row.source === 'assignment_capture',
  ).length;
  const reconstructedCount = Math.max(0, historyRows.length - exactCaptureCount);

  const renderRoom = (room: HistoricalRoom) => {
    const assignment = room.assignment;
    const history = room.history;

    const assignedTo = history?.assigned_to ?? assignment?.assigned_to ?? null;
    const name = assignedTo ? assigneeLabel(staffMap[assignedTo] || assignedTo) : null;
    const assignmentStatus = history?.assignment_status ?? assignment?.status ?? null;
    const approved = Boolean(history?.supervisor_approved ?? assignment?.supervisor_approved);
    const noService = Boolean(
      history?.had_no_service
      || history?.assignment_notes?.includes('[NO_SERVICE]')
      || assignment?.notes?.includes('[NO_SERVICE]'),
    );
    const dnd = Boolean(
      history?.had_dnd
      || history?.is_dnd
      || assignment?.is_dnd
      || (history?.dnd_attempt_count ?? assignment?.dnd_attempt_count ?? 0) > 0
      || assignmentStatus === 'dnd_pending_retry',
    );
    const cleanRequest = Boolean(
      history?.had_room_cleaning_request
      || history?.assignment_notes?.includes('[GREEN_BOARD_CLEAN_REQUEST]')
      || assignment?.notes?.includes('[GREEN_BOARD_CLEAN_REQUEST]'),
    );
    const extraTowels = Boolean(history?.had_extra_towels_request);
    const ready = room.isCheckout && Boolean(
      history?.had_ready_to_clean
      || history?.ready_to_clean
      || assignment?.ready_to_clean,
    ) && !approved;
    const pending = assignmentStatus === 'completed' && !approved;
    const size = sizeLabel(room.room_size_sqm);
    const roomStatus = history?.room_status ?? null;
    const stateLabel = statusLabel(assignmentStatus, approved, noService, roomStatus);

    const arrival = history?.pms_metadata?.arrivalDate ?? history?.pms_metadata?.arrival_date;
    const departure = history?.pms_metadata?.departureDate ?? history?.pms_metadata?.departure_date;

    return (
      <div key={room.id} className="flex flex-col items-center gap-0.5">
        <div
          className={`rounded border-2 px-2 py-1 text-xs font-bold min-w-[42px] text-center ${statusStyle(assignmentStatus, approved, noService, roomStatus)} ${dnd ? 'ring-2 ring-purple-500 ring-offset-1' : ''}`}
          title={[
            `Room ${room.room_number}`,
            `Status: ${stateLabel}`,
            room.currentNight ? `Night ${room.currentNight}` : null,
            arrival ? `Arrival ${arrival}` : null,
            departure ? `Departure ${departure}` : null,
            room.towelChange ? 'Towel change recorded' : null,
            room.linenChange ? 'Linen change recorded' : null,
            dnd ? 'DND recorded' : null,
            cleanRequest ? 'Clean Room request recorded' : null,
            noService ? 'No Service recorded' : null,
            name ? `Assigned: ${name}` : 'Unassigned',
          ].filter(Boolean).join(' · ')}
        >
          {room.room_number}
          {room.bed_type === 'shabath' && <span className="ml-0.5 text-[9px] font-extrabold text-blue-700 dark:text-blue-300">SH</span>}
          {room.towelChange && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-blue-600 text-white">T</span>}
          {room.linenChange && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-orange-500 text-white">C</span>}
          {cleanRequest && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-green-600 text-white">RC</span>}
          {extraTowels && <span className="ml-0.5 text-[9px]">🧺</span>}
          {ready && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-green-600 text-white">RTC</span>}
          {noService && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-gray-600 text-white">NS</span>}
          {approved && <span className="ml-0.5 text-[9px]">✅</span>}
          {pending && <span className="ml-0.5 text-[9px]">⏳</span>}
          {assignmentStatus === 'in_progress' && <span className="ml-0.5 text-[9px]">🧹</span>}
          {dnd && <span className="ml-0.5 text-[9px]">🚫</span>}
          {size && <span className="ml-0.5 text-[8px] opacity-70">{size}</span>}
        </div>

        {room.bed_configuration && (
          <span className="text-[8px] text-purple-600 dark:text-purple-400 font-semibold max-w-[54px] truncate">
            {room.bed_configuration.includes('Double') ? 'DB'
              : room.bed_configuration.includes('Twin') ? 'TW'
                : room.bed_configuration.includes('Single') ? 'SGL'
                  : room.bed_configuration.substring(0, 3).toUpperCase()}
          </span>
        )}
        <span className="text-[8px] leading-tight text-muted-foreground max-w-[82px] text-center truncate" title={stateLabel}>
          {stateLabel}
        </span>
        {name && <span className="text-[9px] text-muted-foreground font-medium max-w-[76px] text-center break-words">{name}</span>}
      </div>
    );
  };

  const renderSection = (title: string, sectionRooms: HistoricalRoom[]) => {
    const floors = new Map<string, HistoricalRoom[]>();
    for (const room of sectionRooms) {
      const key = floorLabel(room.floor_number);
      if (!floors.has(key)) floors.set(key, []);
      floors.get(key)!.push(room);
    }

    return (
      <div className="space-y-2 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BedDouble className="h-4 w-4" />
          <span>{title}</span>
          <Badge variant="secondary" className="text-[10px]">{sectionRooms.length}</Badge>
        </div>
        {[...floors.entries()].map(([floor, floorRooms]) => (
          <div key={floor} className="flex items-start gap-2">
            <span className="w-7 shrink-0 pt-1 text-[10px] text-muted-foreground font-semibold">{floor}</span>
            <div className="flex flex-wrap gap-x-2 gap-y-2">{floorRooms.map(renderRoom)}</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading saved housekeeping history…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-red-300">
        <CardContent className="py-6 text-sm text-red-700">{error}</CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Historical Room Overview
          </CardTitle>
          <Badge variant="outline" className="gap-1 text-[10px]">
            <CalendarClock className="h-3 w-3" /> {selectedDate} · read only
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
          <span>Saved per-day room state · T/C/DND/Clean Room/No Service preserved</span>
          {latestCapture && <span>Last history write {new Date(latestCapture).toLocaleString()}</span>}
          <span>{historyRows.length} room history rows · {assignments.length} assignments</span>
          {reconstructedCount > 0 && (
            <span title="Dates from before the permanent history system use the best available archived PMS + assignment records.">
              {reconstructedCount} legacy reconstructed
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-1 text-[10px]">
          <span className="rounded border border-emerald-500 bg-emerald-100 px-1.5 py-0.5">✅ Approved</span>
          <span className="rounded border border-amber-500 bg-amber-100 px-1.5 py-0.5">Assigned</span>
          <span className="rounded border border-sky-500 bg-sky-100 px-1.5 py-0.5">In progress</span>
          <span className="rounded border border-violet-500 bg-violet-100 px-1.5 py-0.5">⏳ Pending approval</span>
          <span className="rounded border px-1.5 py-0.5"><b>T</b> Towel change</span>
          <span className="rounded border px-1.5 py-0.5"><b>C</b> Linen change</span>
          <span className="rounded border px-1.5 py-0.5"><b>RC</b> Clean Room request</span>
          <span className="rounded border px-1.5 py-0.5"><b>NS</b> No Service</span>
          <span className="rounded border px-1.5 py-0.5">🚫 DND / DND attempt</span>
        </div>
      </CardHeader>

      <CardContent>
        {renderSection('Checkout Rooms', checkoutRooms)}
        <div className="border-t border-border/50" />
        {renderSection('Daily Rooms', dailyRooms)}

        {tasks.length > 0 && (
          <>
            <div className="border-t border-border/50" />
            <div className="space-y-2 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <MapPin className="h-4 w-4" /> Public Areas
                <Badge variant="secondary" className="text-[10px]">{tasks.length}</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {tasks.map((task) => (
                  <div key={task.id} className="rounded border bg-muted/40 px-2 py-1 text-[10px]">
                    <span className="font-semibold">{task.task_name}</span>
                    <span className="ml-1 text-muted-foreground">
                      · {assigneeLabel(staffMap[task.assigned_to] || task.assigned_to)} · {task.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
