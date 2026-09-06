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
}

interface DailySnapshot {
  hotel_id: string;
  business_date: string;
  room_number: string | null;
  room_label: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  status: string | null;
  housekeeping_stay: string | null;
  housekeeping_dep: string | null;
  captured_at: string;
}

interface HistoricalRoom extends StaticRoom {
  assignment?: HistoricalAssignment;
  snapshot?: DailySnapshot;
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

const daysInclusive = (from: string | null, to: string): number | null => {
  if (!from) return null;
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
};

const sizeLabel = (sqm: number | null): string | null => {
  if (!sqm) return null;
  if (sqm <= 18) return 'S';
  if (sqm <= 30) return 'M';
  if (sqm <= 40) return 'L';
  return 'XL';
};

const assignmentRank = (assignment: HistoricalAssignment): number => {
  if (assignment.status === 'completed' && assignment.supervisor_approved) return 5;
  if (assignment.status === 'completed') return 4;
  if (assignment.status === 'in_progress') return 3;
  if (assignment.status === 'assigned') return 2;
  return 1;
};

const statusStyle = (assignment?: HistoricalAssignment): string => {
  if (!assignment) return 'bg-muted text-muted-foreground border-border';
  if (assignment.notes?.includes('[NO_SERVICE]')) return 'bg-slate-200 text-slate-800 border-slate-400 dark:bg-slate-800 dark:text-slate-200';
  if (assignment.status === 'completed' && assignment.supervisor_approved) {
    return 'bg-emerald-200 text-emerald-900 border-emerald-500 dark:bg-emerald-900/50 dark:text-emerald-200';
  }
  if (assignment.status === 'completed') {
    return 'bg-violet-200 text-violet-900 border-violet-500 dark:bg-violet-900/50 dark:text-violet-200';
  }
  if (assignment.status === 'in_progress') {
    return 'bg-sky-200 text-sky-900 border-sky-500 dark:bg-sky-900/50 dark:text-sky-200';
  }
  return 'bg-amber-200 text-amber-900 border-amber-500 dark:bg-amber-900/50 dark:text-amber-200';
};

const floorLabel = (floor: number | null): string => floor == null ? 'Other' : `F${floor}`;

export function HistoricalHotelRoomOverview({
  selectedDate,
  hotelName,
  staffMap,
  refreshKey,
}: HistoricalHotelRoomOverviewProps) {
  const [rooms, setRooms] = useState<StaticRoom[]>([]);
  const [assignments, setAssignments] = useState<HistoricalAssignment[]>([]);
  const [snapshots, setSnapshots] = useState<DailySnapshot[]>([]);
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

        const [roomsRes, assignmentsRes, snapshotRes, tasksRes] = await Promise.all([
          supabase
            .from('rooms')
            .select('id, hotel, room_number, floor_number, venue_id, room_size_sqm, bed_type, bed_configuration')
            .in('hotel', hotelKeys)
            .order('room_number'),
          supabase
            .from('room_assignments')
            .select('id, room_id, assigned_to, status, assignment_type, started_at, completed_at, supervisor_approved, ready_to_clean, pms_hold, notes, is_dnd')
            .eq('assignment_date', selectedDate),
          supabase
            .from('daily_overview_snapshots')
            .select('hotel_id, business_date, room_number, room_label, arrival_date, departure_date, status, housekeeping_stay, housekeeping_dep, captured_at')
            .in('hotel_id', hotelKeys)
            .eq('business_date', selectedDate)
            .order('captured_at', { ascending: false }),
          supabase
            .from('general_tasks')
            .select('id, task_name, task_type, assigned_to, status')
            .in('hotel', hotelKeys)
            .eq('assigned_date', selectedDate),
        ]);

        if (roomsRes.error) throw roomsRes.error;
        if (assignmentsRes.error) throw assignmentsRes.error;
        if (snapshotRes.error) throw snapshotRes.error;
        if (tasksRes.error) throw tasksRes.error;
        if (cancelled) return;

        const rawRooms = (roomsRes.data ?? []) as StaticRoom[];
        const assignmentRows = (assignmentsRes.data ?? []) as HistoricalAssignment[];
        const assignmentRoomIds = new Set(assignmentRows.map((row) => row.room_id));

        // A few legacy hotels contain duplicate room rows under display-name and
        // canonical hotel keys. Keep the row that actually owns this day's
        // assignment first, then prefer the canonical key (first resolved key).
        const byNumber = new Map<string, StaticRoom>();
        const score = (room: StaticRoom) =>
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
        setSnapshots((snapshotRes.data ?? []) as DailySnapshot[]);
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

  const snapshotLookup = useMemo(() => {
    const exact = new Map<string, DailySnapshot>();
    const digits = new Map<string, DailySnapshot>();
    // Query is newest-first. Keep the first row for a room if accidental
    // duplicate captures exist for the same business date.
    for (const snapshot of snapshots) {
      for (const value of [snapshot.room_number, snapshot.room_label]) {
        const key = normalize(value);
        if (key && !exact.has(key)) exact.set(key, snapshot);
        const digitKey = digitsOnly(value);
        if (digitKey && !digits.has(digitKey)) digits.set(digitKey, snapshot);
      }
    }
    return { exact, digits };
  }, [snapshots]);

  const historicalRooms = useMemo<HistoricalRoom[]>(() => rooms.map((room) => {
    const assignment = assignmentMap.get(room.id);
    const snapshot = snapshotLookup.exact.get(normalize(room.room_number))
      ?? snapshotLookup.digits.get(digitsOnly(room.room_number));
    const currentNight = daysInclusive(snapshot?.arrival_date ?? null, selectedDate);
    const snapshotCheckout = snapshot?.departure_date?.slice(0, 10) === selectedDate
      || normalize(snapshot?.status) === 'departing';
    // The date-scoped assignment is the closest record of what the manager
    // actually worked from that day. Snapshot is the fallback for unassigned rooms.
    const isCheckout = assignment?.assignment_type === 'checkout_cleaning'
      ? true
      : assignment?.assignment_type === 'daily_cleaning'
        ? false
        : snapshotCheckout;
    const towelChange = currentNight != null
      && currentNight >= 3
      && (currentNight - 3) % 4 === 0
      && !isCheckout;
    const linenChange = currentNight != null
      && currentNight >= 3
      && (currentNight - 3) % 4 === 2
      && !isCheckout;

    return {
      ...room,
      assignment,
      snapshot,
      isCheckout,
      currentNight,
      towelChange,
      linenChange,
    };
  }), [rooms, assignmentMap, snapshotLookup, selectedDate]);

  const checkoutRooms = historicalRooms.filter((room) => room.isCheckout);
  const dailyRooms = historicalRooms.filter((room) => !room.isCheckout);
  const latestCapture = snapshots[0]?.captured_at ?? null;

  const renderRoom = (room: HistoricalRoom) => {
    const assignment = room.assignment;
    const name = assignment ? assigneeLabel(staffMap[assignment.assigned_to] || assignment.assigned_to) : null;
    const noService = assignment?.notes?.includes('[NO_SERVICE]') === true;
    const approved = assignment?.status === 'completed' && assignment?.supervisor_approved;
    const pending = assignment?.status === 'completed' && !assignment?.supervisor_approved;
    const dnd = assignment?.is_dnd === true;
    const ready = room.isCheckout && assignment?.ready_to_clean === true && !approved;
    const size = sizeLabel(room.room_size_sqm);

    return (
      <div key={room.id} className="flex flex-col items-center gap-0.5">
        <div
          className={`rounded border-2 px-2 py-1 text-xs font-bold min-w-[42px] text-center ${statusStyle(assignment)} ${dnd ? 'ring-2 ring-purple-500 ring-offset-1' : ''}`}
          title={[
            `Room ${room.room_number}`,
            room.currentNight ? `Night ${room.currentNight}` : null,
            room.snapshot?.arrival_date ? `Arrival ${room.snapshot.arrival_date}` : null,
            room.snapshot?.departure_date ? `Departure ${room.snapshot.departure_date}` : null,
            name ? `Assigned: ${name}` : 'Unassigned',
          ].filter(Boolean).join(' · ')}
        >
          {room.room_number}
          {room.bed_type === 'shabath' && <span className="ml-0.5 text-[9px] font-extrabold text-blue-700 dark:text-blue-300">SH</span>}
          {room.towelChange && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-blue-600 text-white">T</span>}
          {room.linenChange && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-orange-500 text-white">C</span>}
          {ready && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-green-600 text-white">RTC</span>}
          {noService && <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-gray-600 text-white">NS</span>}
          {approved && <span className="ml-0.5 text-[9px]">✅</span>}
          {pending && <span className="ml-0.5 text-[9px]">⏳</span>}
          {assignment?.status === 'in_progress' && <span className="ml-0.5 text-[9px]">🧹</span>}
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
          <Loader2 className="h-4 w-4 animate-spin" /> Loading historical housekeeping snapshot…
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
          <span>Exact date-scoped assignments + archived PMS snapshot</span>
          {latestCapture && <span>Archived {new Date(latestCapture).toLocaleString()}</span>}
          <span>{snapshots.length} PMS room rows · {assignments.length} assignments</span>
        </div>
        <div className="flex flex-wrap gap-2 pt-1 text-[10px]">
          <span className="rounded border border-emerald-500 bg-emerald-100 px-1.5 py-0.5">✅ Approved</span>
          <span className="rounded border border-amber-500 bg-amber-100 px-1.5 py-0.5">Assigned</span>
          <span className="rounded border border-sky-500 bg-sky-100 px-1.5 py-0.5">In progress</span>
          <span className="rounded border border-violet-500 bg-violet-100 px-1.5 py-0.5">⏳ Pending approval</span>
          <span className="rounded border px-1.5 py-0.5"><b>T</b> Towel change</span>
          <span className="rounded border px-1.5 py-0.5"><b>C</b> Linen change</span>
          <span className="rounded border px-1.5 py-0.5">🚫 DND</span>
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
                    <span className="ml-1 text-muted-foreground">· {assigneeLabel(staffMap[task.assigned_to] || task.assigned_to)} · {task.status.replace(/_/g, ' ')}</span>
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
