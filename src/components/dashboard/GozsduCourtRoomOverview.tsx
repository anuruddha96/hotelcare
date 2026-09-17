import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { reconcileGozsduPmsRoster, type GozsduPmsRow } from '@/lib/gozsduPmsRoster';
import { canonicalGozsduOverviewName, groupGozsduOverviewByBuilding } from '@/lib/gozsduRoomOverviewDisplay';
import { BedDouble, Building2, ChevronDown, ChevronRight, Coffee, GripVertical, Hotel, MapPin, Plus, RefreshCw, UserX } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { canManageHousekeepingMapping, hasManagerPowers } from '@/lib/roleAccess';
import { GOZSDU_COURT_HOTEL_ID, getGozsduHousekeepingCycle, type GozsduHousekeepingService } from '@/lib/gozsdu-housekeeping';
import { setHousekeeperDragPayload, readHousekeeperDragPayload, setRoomDragPayload, assignRoomToStaff, isAssignmentInProgressError } from '@/lib/hkAssignmentDnd';
import { parseRoomFlags } from '@/lib/room-service-flags';
import { isPmsRtcToday } from '@/lib/pmsReadiness';
import { assigneeLabel, cleanName } from '@/lib/staffNames';
import { todayBudapest } from '@/lib/budapestTime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import type { SignedInHousekeeper } from './HotelRoomOverviewLive';

// Entire component and its registry query are exclusive to Gozsdu. Its active
// chips retain the same target/drag contracts as the ordinary Team View.
const HOTEL_NAME = 'Gozsdu Court Budapest';
const HOTEL_KEYS = [GOZSDU_COURT_HOTEL_ID, HOTEL_NAME];
type Bucket = 'checkout' | 'service' | 'other' | 'noshow';
type Room = {
  id: string; hotel: string | null; room_number: string; floor_number: number | null;
  status: string | null; last_cleaned_at: string | null; updated_at: string | null;
  is_checkout_room: boolean | null; is_dnd: boolean | null; notes: string | null;
  wing: string | null; room_category: string | null; room_size_sqm: number | null;
  bed_type: string | null; bed_configuration: string | null; guest_nights_stayed: number | null;
  towel_change_required: boolean | null; linen_change_required: boolean | null;
  pms_metadata?: any;
};
type Assignment = {
  id: string; room_id: string; assigned_to: string; status: string;
  assignment_type: string; started_at: string | null; supervisor_approved: boolean | null;
  ready_to_clean: boolean | null; notes: string | null;
};
type Building = { id: string; name: string; sort_order: number };
type Mapping = { room_id: string; section_id: string };
type PublicArea = { id: string; task_name: string; assigned_to: string; status: string };
type RegistryRoom = {
  room_id: string; pms_room_name: string; building_code: string;
  service_status: 'operating' | 'unavailable' | 'non_guest';
  unavailability_reason: string | null;
};
type Props = {
  selectedDate: string; hotelName: string; staffMap: Record<string, string>;
  refreshKey?: number; signedInHousekeepers?: SignedInHousekeeper[];
};
const STATUS_COLORS: Record<string, string> = {
  clean: 'bg-emerald-200 text-emerald-900 border-emerald-500 dark:bg-emerald-900/50 dark:text-emerald-200 dark:border-emerald-600',
  dirty: 'bg-amber-200 text-amber-900 border-amber-500 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-600',
  in_progress: 'bg-sky-200 text-sky-900 border-sky-500 dark:bg-sky-900/50 dark:text-sky-200 dark:border-sky-600',
  out_of_order: 'bg-red-200 text-red-900 border-red-500 dark:bg-red-900/50 dark:text-red-200 dark:border-red-600',
  inspected: 'bg-teal-200 text-teal-900 border-teal-500 dark:bg-teal-900/50 dark:text-teal-200 dark:border-teal-600',
  pending_approval: 'bg-violet-200 text-violet-900 border-violet-500 dark:bg-violet-900/50 dark:text-violet-200 dark:border-violet-600',
  overdue: 'bg-rose-300 text-rose-950 border-rose-600 dark:bg-rose-900/60 dark:text-rose-200 dark:border-rose-500',
};
function checkout(room: Room, assignment?: Assignment) {
  if (room.pms_metadata?.manual_daily === true) return false;
  return room.is_checkout_room === true || room.pms_metadata?.scheduledDepartureToday === true
    || room.pms_metadata?.checkedOutToday === true
    || (room.pms_metadata?.pmsSyncDate !== todayBudapest() && assignment?.assignment_type === 'checkout_cleaning');
}
function noShow(room: Room) {
  return room.pms_metadata?.isNoShow === true || Number(room.pms_metadata?.reservationStatusId) === 8;
}
function service(room: Room, isCheckout: boolean): GozsduHousekeepingService {
  if (isCheckout || noShow(room)) return 'none';
  const stored = room.pms_metadata?.gozsduHousekeeping?.serviceType;
  if (stored === 'towel_change' || stored === 'change_room') return stored;
  return getGozsduHousekeepingCycle({
    currentNight: room.pms_metadata?.currentNight ?? room.guest_nights_stayed,
    totalNights: room.pms_metadata?.totalNights,
    isCheckout,
  }).service;
}
function roomSort(a: Room, b: Room) {
  return a.room_number.localeCompare(b.room_number, undefined, { numeric: true });
}

export function GozsduCourtRoomOverview({ selectedDate, staffMap, refreshKey, signedInHousekeepers = [] }: Props) {
  const { user, profile } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [registry, setRegistry] = useState<RegistryRoom[]>([]);
  const [pmsRows, setPmsRows] = useState<GozsduPmsRow[]>([]);
  const [pmsFetchIssue, setPmsFetchIssue] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [areas, setAreas] = useState<PublicArea[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'rooms' | 'buildings'>('rooms');
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [buildingName, setBuildingName] = useState('');
  const [mappingBusy, setMappingBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [draggingHousekeeper, setDraggingHousekeeper] = useState<string | null>(null);
  const [droppingOn, setDroppingOn] = useState<string | null>(null);
  const canAssign = hasManagerPowers(profile?.role) || profile?.role === 'supervisor';
  const canMap = canManageHousekeepingMapping(profile?.role);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [roomResult, areaResult, sectionsResult, registryResult, snapshotResult] = await Promise.all([
        supabase.from('rooms')
          .select('id, hotel, room_number, floor_number, status, last_cleaned_at, updated_at, is_checkout_room, is_dnd, notes, wing, room_category, room_size_sqm, bed_type, bed_configuration, guest_nights_stayed, towel_change_required, linen_change_required, pms_metadata')
          .in('hotel', HOTEL_KEYS).order('room_number'),
        supabase.from('general_tasks').select('id, task_name, assigned_to, status')
          .in('hotel', HOTEL_KEYS).eq('assigned_date', selectedDate),
        (supabase as any).from('hotel_housekeeping_sections')
          .select('id, name, sort_order').eq('hotel_name', HOTEL_NAME).eq('is_active', true)
          .order('sort_order').order('name'),
        (supabase as any).from('gozsdu_housekeeping_room_registry')
          .select('room_id, pms_room_name, building_code, service_status, unavailability_reason'),
        profile?.organization_slug ? (supabase as any).from('daily_overview_snapshots')
          .select('room_label,room_number,arrival_date,departure_date,status,housekeeping_dep,captured_at')
          .eq('organization_slug', profile.organization_slug).eq('hotel_id', GOZSDU_COURT_HOTEL_ID)
          .eq('business_date', selectedDate).eq('source', 'previo')
          : Promise.resolve({ data: [], error: { message: 'Organization missing from user session.' } }),
      ]);
      if (roomResult.error) throw roomResult.error;
      if (areaResult.error) throw areaResult.error;
      if (sectionsResult.error) throw sectionsResult.error;
      if (registryResult.error) throw registryResult.error;
      const rawRooms = (roomResult.data || []) as Room[];
      const ids = rawRooms.map(room => room.id);
      const assignmentRows: Assignment[] = [];
      if (ids.length > 0) {
        const { data, error } = await supabase.from('room_assignments')
          .select('id, room_id, assigned_to, status, assignment_type, started_at, supervisor_approved, ready_to_clean, notes')
          .eq('assignment_date', selectedDate).in('room_id', ids);
        if (error) throw error;
        assignmentRows.push(...((data || []) as Assignment[]));
      }
      const assignedIds = new Set(assignmentRows.map(row => row.room_id));
      const deduped = new Map<string, Room>();
      for (const room of rawRooms) {
        const existing = deduped.get(room.room_number);
        if (!existing || (assignedIds.has(room.id) && !assignedIds.has(existing.id))
          || (!assignedIds.has(existing.id) && room.hotel === GOZSDU_COURT_HOTEL_ID)) {
          deduped.set(room.room_number, room);
        }
      }
      const selectedRooms = Array.from(deduped.values()).sort(roomSort);
      const selectedIds = new Set(selectedRooms.map(room => room.id));
      const nextBuildings = (sectionsResult.data || []) as Building[];
      let nextMappings: Mapping[] = [];
      if (nextBuildings.length > 0) {
        const { data, error } = await (supabase as any).from('hotel_housekeeping_section_rooms')
          .select('room_id, section_id').in('section_id', nextBuildings.map(row => row.id));
        if (error) throw error;
        nextMappings = ((data || []) as Mapping[]).filter(mapping => selectedIds.has(mapping.room_id));
      }
      setRooms(selectedRooms);
      setRegistry(((registryResult.data || []) as RegistryRoom[]).filter(row => selectedIds.has(row.room_id)));
      setPmsRows((snapshotResult.data || []) as GozsduPmsRow[]);
      setPmsFetchIssue(snapshotResult.error?.message || null);
      setAssignments(assignmentRows.filter(row => selectedIds.has(row.room_id)));
      setAreas((areaResult.data || []) as PublicArea[]);
      setBuildings(nextBuildings);
      setMappings(nextMappings);
    } catch (error) {
      console.error('[GozsduCourtRoomOverview] refresh failed', error);
      toast.error('Could not refresh Gozsdu housekeeping or the operational room list');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedDate, profile?.organization_slug]);

  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => {
    const onChanged = () => { void load(true); };
    window.addEventListener('pms-sync-completed', onChanged);
    window.addEventListener('hk-assignments-changed', onChanged);
    const onVisible = () => { if (!document.hidden) onChanged(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => { if (!document.hidden) onChanged(); }, 60_000);
    const channel = supabase.channel(`gozsdu-room-overview-${selectedDate}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, (event: any) => {
        if (HOTEL_KEYS.includes(event.new?.hotel || event.old?.hotel)) onChanged();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_assignments', filter: `assignment_date=eq.${selectedDate}` }, onChanged)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gozsdu_housekeeping_room_registry' }, onChanged)
      .subscribe();
    return () => {
      window.removeEventListener('pms-sync-completed', onChanged);
      window.removeEventListener('hk-assignments-changed', onChanged);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [load, selectedDate]);

  const pmsRoster = useMemo(() => {
    if (pmsFetchIssue) return { data: null, error: pmsFetchIssue };
    try {
      return { data: reconcileGozsduPmsRoster(rooms, registry, pmsRows, selectedDate), error: null };
    } catch (cause) {
      return { data: null, error: cause instanceof Error ? cause.message : 'Could not verify Gozsdu PMS data.' };
    }
  }, [rooms, registry, pmsRows, selectedDate, pmsFetchIssue]);
  const registryByRoom = useMemo(() => new Map(registry.map(row => [row.room_id, row])), [registry]);
  const displayName = useCallback((room: Room) => canonicalGozsduOverviewName(room, registryByRoom), [registryByRoom]);
  const isOperating = (room: Room) => registryByRoom.get(room.id)?.service_status === 'operating';
  const assignmentMap = useMemo(() => new Map(assignments.map(row => [row.room_id, row])), [assignments]);
  const buildingByRoom = useMemo(() => new Map(mappings.map(row => [row.room_id, row.section_id])), [mappings]);
  const nameByBuilding = useMemo(() => new Map(buildings.map(row => [row.id, row.name])), [buildings]);
  const buckets = useMemo(() => {
    const result: Record<Bucket, Room[]> & { inactive: Room[] } = { checkout: [], service: [], other: [], noshow: [], inactive: [] };
    for (const room of rooms) {
      if (registryByRoom.get(room.id)?.service_status !== 'operating') {
        result.inactive.push(room);
        continue;
      }
      const verifiedBucket = pmsRoster.data?.byRoom.get(room.id)?.bucket;
      if (verifiedBucket === 'checkout') result.checkout.push(room);
      else if (verifiedBucket === 'noshow') result.noshow.push(room);
      else if (verifiedBucket === 'service') result.service.push(room);
      else if (verifiedBucket === 'other') result.other.push(room);
      else {
        // Degraded fallback is visibly marked unverified; never claim these stored flags match Previo.
        const isCheckout = checkout(room, assignmentMap.get(room.id));
        if (isCheckout) result.checkout.push(room);
        else if (noShow(room)) result.noshow.push(room);
        else if (service(room, false) !== 'none') result.service.push(room);
        else result.other.push(room);
      }
    }
    return result;
  }, [rooms, registryByRoom, assignmentMap, pmsRoster]);

  const onDropHousekeeper = async (event: React.DragEvent, room: Room) => {
    const payload = readHousekeeperDragPayload(event);
    if (!payload || !canAssign || selectedDate !== todayBudapest() || !isOperating(room)) return;
    if (!pmsRoster.data) { toast.warning('Gozsdu PMS room counts are unverified; check Previo before changing assignments.'); return; }
    event.preventDefault();
    event.stopPropagation();
    setDroppingOn(null);
    const existing = assignmentMap.get(room.id);
    if (existing?.assigned_to === payload.staffId) return;
    try {
      await assignRoomToStaff({
        roomId: room.id, staffId: payload.staffId, assignmentDate: selectedDate,
        assignedBy: profile?.id || user?.id || '', organizationSlug: profile?.organization_slug || null,
        isCheckoutRoom: pmsRoster.data.byRoom.get(room.id)?.bucket === 'checkout',
      });
      toast.success(`Room ${displayName(room)} → ${cleanName(payload.staffName)}`);
      await load(true);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch (error) {
      if (isAssignmentInProgressError(error)) toast.warning(`Room ${displayName(room)} is already being cleaned; its housekeeper cannot be changed.`);
      else { console.error('[Gozsdu] assignment failed', error); toast.error('Could not assign room'); }
    }
  };

  const renderChip = (room: Room, bucket: Bucket) => {
    const assignment = assignmentMap.get(room.id);
    const flags = parseRoomFlags(room.notes);
    const isCheckout = bucket === 'checkout';
    const isNoShow = bucket === 'noshow';
    const verified = pmsRoster.data?.byRoom.get(room.id);
    const change = bucket === 'service' ? (verified?.service ?? service(room, false)) : 'none';
    const pending = assignment?.status === 'completed' && assignment.supervisor_approved !== true;
    const overdue = assignment?.status === 'in_progress' && assignment.started_at
      && Date.now() - new Date(assignment.started_at).getTime() > 2 * 60 * 60 * 1000;
    const pmsClean = room.status === 'clean' && (
      room.pms_metadata?.pmsSyncDate === selectedDate || room.pms_metadata?.lastPmsRefreshDate === selectedDate);
    const cleanedToday = room.last_cleaned_at?.slice(0, 10) === selectedDate;
    const status = overdue ? 'overdue' : pending ? 'pending_approval'
      : assignment?.status === 'in_progress' ? 'in_progress'
      : assignment?.status === 'completed' && assignment.supervisor_approved ? 'clean'
      : (room.status === 'clean' && (cleanedToday || pmsClean) ? 'clean' : room.status === 'clean' ? 'dirty' : room.status || 'dirty');
    const staffName = assignment ? assigneeLabel(staffMap, assignment.assigned_to) : null;
    const nights = verified?.night ?? Number(room.pms_metadata?.currentNight ?? room.guest_nights_stayed ?? 0);
    const total = verified?.totalNights ?? Number(room.pms_metadata?.totalNights ?? 0);
    const hasNote = !!flags.cleanNotes;
    const size = room.room_size_sqm;
    const sizeLabel = !size ? null : size <= 18 ? 'S' : size <= 30 ? 'M' : size <= 40 ? 'L' : 'XL';
    const highlight = droppingOn === room.id;
    return (
      <TooltipProvider key={room.id} delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`flex flex-col items-center gap-0.5 select-none transition-transform ${highlight ? 'scale-110' : ''}`}
              draggable={canAssign && selectedDate === todayBudapest()}
              onDragStart={canAssign ? event => setRoomDragPayload(event, {
                roomId: room.id, roomNumber: room.room_number,
                sourceType: isCheckout ? 'checkout' : 'daily', origin: 'overview',
                assignedTo: assignment?.assigned_to || null,
                assignedToName: assignment ? staffMap[assignment.assigned_to] || null : null,
              }) : undefined}
              onDragEnd={() => setDroppingOn(null)}
              onDragOver={canAssign ? event => { event.preventDefault(); setDroppingOn(room.id); } : undefined}
              onDragLeave={() => setDroppingOn(current => current === room.id ? null : current)}
              onDrop={canAssign ? event => { void onDropHousekeeper(event, room); } : undefined}
              onMouseEnter={() => setHovered(room.id)}
              onMouseLeave={() => setHovered(null)}
              role="button" tabIndex={0}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') (event.currentTarget as HTMLElement).click(); }}
              style={{ cursor: 'pointer' }}
            >
              <div className={`relative rounded border transition-all text-center px-2 py-1 text-xs font-bold border-2 min-w-[40px] ${STATUS_COLORS[status] || STATUS_COLORS.dirty}
                ${room.is_dnd ? 'ring-2 ring-purple-500 ring-offset-1' : ''}
                ${isNoShow ? 'ring-2 ring-red-600 ring-offset-1' : ''}
                ${highlight ? 'ring-2 ring-primary ring-offset-1' : ''}
                ${hovered === room.id ? 'shadow-md' : ''}`}>
                {displayName(room)}
                {room.pms_metadata?.manual_checkout === true && <span className="ml-0.5 rounded bg-amber-500 px-0.5 text-[9px] text-white" title="Manual checkout">M</span>}
                {room.pms_metadata?.notArrived === true && !isNoShow && <span className="ml-0.5 rounded bg-slate-500 px-0.5 text-[9px] text-white">NA</span>}
                {(verified?.leavesTomorrow ?? (room.pms_metadata?.scheduledDepartureTomorrow === true)) && !isCheckout && <span className="ml-0.5 rounded bg-indigo-600 px-0.5 text-[9px] text-white">C/O+1</span>}
                {room.bed_type === 'shabath' && <span className="ml-0.5 text-[9px] font-extrabold text-blue-700">SH</span>}
                {change === 'towel_change' && <span className="ml-0.5 rounded bg-blue-600 px-0.5 text-[9px] text-white">T</span>}
                {change === 'change_room' && <span className="ml-0.5 rounded bg-orange-500 px-0.5 text-[9px] text-white">C</span>}
                {flags.roomCleaning && <span className="ml-0.5 rounded bg-green-600 px-0.5 text-[9px] text-white">RC</span>}
                {flags.collectExtraTowels && <span className="ml-0.5 text-[9px]">🧺</span>}
                {isCheckout && (assignment?.ready_to_clean || (!assignment && isPmsRtcToday(room.pms_metadata))) && <span className="ml-0.5 rounded bg-green-600 px-0.5 text-[9px] text-white">RTC</span>}
                {assignment?.notes?.includes('[NO_SERVICE]') && <span className="ml-0.5 rounded bg-gray-500 px-0.5 text-[9px] text-white">NS</span>}
                {assignment?.status === 'completed' && assignment.supervisor_approved && !assignment.notes?.includes('[NO_SERVICE]') && <span className="ml-0.5 text-[9px]">✅</span>}
                {room.is_dnd && <span className="ml-0.5 text-[9px]">🚫</span>}
                {isNoShow && <span className="ml-0.5 text-[9px]">⚠️</span>}
                {pending && <span className="ml-0.5 text-[9px]">⏳</span>}
                {overdue && <span className="ml-0.5 text-[9px]">🔴</span>}
                {sizeLabel && <span className="ml-0.5 text-[8px] opacity-70">{sizeLabel}</span>}
              </div>
              {room.bed_configuration && <span className="max-w-[48px] truncate text-[8px] font-semibold text-purple-600" title={room.bed_configuration}>{room.bed_configuration.includes('Twin') ? 'TW' : room.bed_configuration.includes('Double') ? 'DB' : room.bed_configuration.slice(0, 3).toUpperCase()}</span>}
              {hasNote && <span className="text-[8px]" title={flags.cleanNotes}>📝</span>}
              {staffName && <span className="max-w-[76px] break-words text-center text-[9px] font-medium leading-tight text-muted-foreground" title={staffMap[assignment?.assigned_to || '']}>{staffName}</span>}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            <p className="font-semibold">Room {displayName(room)} · {status.replaceAll('_', ' ')}</p>
            <p>PMS: {displayName(room)}</p>
            {nights > 0 && total > 0 && <p>Stay {nights}/{total}</p>}
            {change !== 'none' && <p>{change === 'change_room' ? 'Change Room' : 'Towel change'}</p>}
            {nameByBuilding.get(buildingByRoom.get(room.id) || '') && <p>Building: {nameByBuilding.get(buildingByRoom.get(room.id) || '')}</p>}
            {staffName && <p>Housekeeper: {staffName}</p>}
            <p className="text-muted-foreground">Click for the same room operations as other hotels.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const renderSection = (title: string, list: Room[], bucket: Bucket, icon: React.ReactNode, hint: string) => {
    // Manager section assignments are the physical location source. A 1B/2B
    // PMS name does NOT identify a real building; neither does numeric floor.
    const groups = groupGozsduOverviewByBuilding(list, mappings, buildings, displayName);
    return (
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {icon}<span className="text-sm font-semibold">{title}</span>
          <Badge variant="secondary" className="text-xs">{list.length}</Badge>
          <span className="text-[10px] text-muted-foreground">{hint}</span>
        </div>
        {list.length === 0 ? <p className="pl-6 text-xs text-muted-foreground">No rooms</p> : (
          <div className="space-y-1.5">
            {groups.map(group => (
              <div key={group.key} className="flex items-start gap-2">
                <Badge variant="outline" className="mt-0.5 w-[88px] max-w-[88px] shrink-0 whitespace-normal break-words text-center text-[10px] leading-tight sm:w-[110px] sm:max-w-[110px]" title={group.label}>{group.label}</Badge>
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {group.rooms.map(room => <div key={room.id} className="animate-fade-in">{renderChip(room, bucket)}</div>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  const refresh = async () => { setRefreshing(true); await load(true); setRefreshing(false); };
  const createBuilding = async () => {
    const name = buildingName.trim();
    if (!name || !canMap) return;
    setCreating(true);
    try {
      const { data, error } = await (supabase as any).from('hotel_housekeeping_sections').insert({
        hotel_name: HOTEL_NAME, name, floor_number: 0,
        description: 'Gozsdu Court building / apartment group', color: 'slate',
        sort_order: buildings.reduce((max, row) => Math.max(max, row.sort_order || 0), 0) + 10,
        created_by: user?.id || null,
      }).select('id, name, sort_order').single();
      if (error) throw error;
      setBuildings(current => [...current, data]);
      setBuildingName('');
      toast.success(`Building ${name} created`);
    } catch (error: any) {
      toast.error(error?.code === '23505' ? 'Building already exists' : 'Could not create building');
    } finally { setCreating(false); }
  };
  const mapRoom = async (room: Room, sectionId: string) => {
    if (!canMap) return;
    setMappingBusy(room.id);
    try {
      const query = (supabase as any).from('hotel_housekeeping_section_rooms');
      const { error } = sectionId === 'unmapped'
        ? await query.delete().eq('room_id', room.id)
        : await query.upsert({ room_id: room.id, section_id: sectionId, created_by: user?.id || null }, { onConflict: 'room_id' });
      if (error) throw error;
      setMappings(current => [ ...current.filter(row => row.room_id !== room.id),
        ...(sectionId === 'unmapped' ? [] : [{ room_id: room.id, section_id: sectionId }]) ]);
      toast.success(`Room ${registryByRoom.get(room.id)?.pms_room_name || room.room_number} mapping saved`);
    } catch (error) { toast.error('Could not save room mapping'); }
    finally { setMappingBusy(null); }
  };

  if (loading) return <Card><CardContent className="py-4 text-sm text-muted-foreground">Loading room overview…</CardContent></Card>;
  return (
    <Card id="hotel-room-overview" className="border-primary/20">
      <CardHeader className="space-y-3 px-3 pb-2 pt-3 sm:px-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-1.5 text-sm font-semibold sm:text-base"><Hotel className="h-4 w-4 shrink-0 text-primary" />Hotel Room Overview</CardTitle>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => setView(current => current === 'rooms' ? 'buildings' : 'rooms')}>
              {view === 'rooms' ? <><Building2 className="mr-1 h-3.5 w-3.5" />Map</> : <><BedDouble className="mr-1 h-3.5 w-3.5" />List</>}
            </Button>
            <Button size="sm" className="h-8 px-2 text-xs" onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[['Operating', rooms.length - buckets.inactive.length], ['Checkout', buckets.checkout.length], ['Service', buckets.service.length], ['Unavailable', buckets.inactive.length]].map(([label, count]) => (
            <div key={label} className="rounded-lg border bg-muted/40 px-2 py-1.5 text-center">
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className="text-sm font-semibold leading-tight">{count}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/50 bg-muted/30 p-2 text-[10px] text-muted-foreground">
          <span>🟩 Clean</span><span>🟨 Dirty/assigned</span><span>🟦 In progress</span><span>🟪 Approval</span>
          <span><b className="rounded bg-blue-600 px-1 text-white">T</b> Towel</span>
          <span><b className="rounded bg-orange-500 px-1 text-white">C</b> Change Room</span>
          <span>🟢 RTC</span><span>🚫 DND</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-3">
        {pmsRoster.error ? <div role="alert" className="rounded-md border border-amber-500 bg-amber-50 p-2 text-xs text-amber-950">PMS not verified for {selectedDate}: {pmsRoster.error} The counts below use stored room flags and may be wrong. Confirm departures in Previo before assigning.</div>
          : <p className="text-[10px] text-muted-foreground">Verified against Previo for {selectedDate} · captured {new Date(pmsRoster.data!.capturedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Budapest' })} Budapest time · scheduled departures (not rooms awaiting cleaning)</p>}
        {canAssign && signedInHousekeepers.length > 0 && selectedDate === todayBudapest() && (
          <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-2">
            <div className="mb-1.5 flex items-center gap-1.5"><GripVertical className="h-3.5 w-3.5" /><span className="text-[11px] font-semibold">Signed in today</span><span className="text-[10px] text-muted-foreground">— drag a housekeeper onto a room</span></div>
            <div className="flex flex-wrap gap-1.5">{signedInHousekeepers.map(person => (
              <div key={person.id} draggable onDragStart={event => { setHousekeeperDragPayload(event, { staffId: person.id, staffName: person.fullName }); setDraggingHousekeeper(person.id); }}
                onDragEnd={() => { setDraggingHousekeeper(null); setDroppingOn(null); }}
                className={`flex cursor-grab items-center gap-1 rounded-full border bg-background px-2 py-1 text-[11px] font-medium shadow-sm ${draggingHousekeeper === person.id ? 'opacity-60' : ''}`}>
                <GripVertical className="h-3 w-3 text-muted-foreground" />{cleanName(person.nickname) || cleanName(person.fullName)}
                {person.onBreak && <span className="text-[9px] text-amber-700"><Coffee className="inline h-2.5 w-2.5" />Break</span>}
              </div>
            ))}</div>
          </div>
        )}
        {view === 'rooms' ? <>
          {renderSection('Checkout Rooms', buckets.checkout, 'checkout', <BedDouble className="h-3.5 w-3.5 text-amber-600" />, 'Departure / checkout cleaning')}
          <div className="border-t border-border/50" />
          {renderSection('Second-day service rooms', buckets.service, 'service', <BedDouble className="h-3.5 w-3.5 text-blue-600" />, 'T = towel · C = Change Room')}
          <div className="border-t border-border/50" />
          {renderSection('Other rooms', buckets.other, 'other', <MapPin className="h-3.5 w-3.5 text-slate-500" />, 'No housekeeping scheduled today')}
          <div className="border-t border-border/50" />
          {renderSection('No show', buckets.noshow, 'noshow', <UserX className="h-3.5 w-3.5 text-red-600" />, 'No-show reservations')}
          <div className="border-t border-border/50" />
          <section className="space-y-2">
            <button type="button" aria-expanded={showUnavailable} onClick={() => setShowUnavailable(current => !current)} className="flex w-full items-center gap-2 rounded-md p-1 text-left hover:bg-muted/40">
              {showUnavailable ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span className="text-sm font-semibold">Not available rooms</span><Badge variant="secondary">{buckets.inactive.length}</Badge>
              <span className="text-[10px] text-muted-foreground">PMS rooms not in the operating housekeeping inventory · hidden by default</span>
            </button>
            {showUnavailable && <div className="flex flex-wrap gap-2 rounded-md border border-border/50 bg-muted/20 p-2">
              {buckets.inactive.map(room => {
                const entry = registryByRoom.get(room.id);
                return <div key={room.id} className="flex flex-col gap-0.5 rounded border border-slate-300 bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-200" title={entry?.unavailability_reason || 'Not approved for housekeeping'}>
                  <span className="font-semibold">{entry?.pms_room_name || room.room_number}</span>
                  <span className="text-[10px]">{entry?.unavailability_reason || (entry?.service_status === 'unavailable' ? 'Not available' : 'Not mapped / non-guest')}</span>
                </div>;
              })}
            </div>}
          </section>
          {areas.length > 0 && <><div className="border-t border-border/50" /><div className="space-y-2"><div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-emerald-600" /><span className="text-sm font-semibold">Public Areas</span><Badge variant="secondary">{areas.length}</Badge></div><div className="flex flex-wrap gap-1.5">{areas.map(area => <div key={area.id} className="flex flex-col items-center gap-0.5"><div className={`rounded border px-2 py-1 text-xs font-semibold ${STATUS_COLORS[area.status] || STATUS_COLORS.dirty}`}>{area.task_name}</div><span className="text-[9px] text-muted-foreground">{assigneeLabel(staffMap, area.assigned_to)}</span></div>)}</div></div></>}
        </> : <div className="space-y-3">
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">Gozsdu building / apartment mapping</span><Badge variant="secondary">{mappings.length}/{rooms.length} mapped</Badge></div>
            <p className="mt-1 text-xs text-muted-foreground">PMS apartment names are kept intact. Unavailable units stay mapped but cannot be assigned.</p>
            {canMap && <div className="mt-3 flex max-w-md gap-2"><Input value={buildingName} onChange={event => setBuildingName(event.target.value)} placeholder="Building name / address" onKeyDown={event => { if (event.key === 'Enter') void createBuilding(); }} /><Button disabled={creating || !buildingName.trim()} onClick={() => void createBuilding()}><Plus className="mr-1 h-4 w-4" />Add</Button></div>}
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{rooms.map(room => <div key={room.id} className="flex items-center gap-2 rounded-lg border p-2"><div className="min-w-[85px]"><div className="text-xs font-bold">{registryByRoom.get(room.id)?.pms_room_name || room.room_number}</div>{!isOperating(room) && <div className="text-[9px] text-slate-500">Not available</div>}</div><Select value={buildingByRoom.get(room.id) || 'unmapped'} onValueChange={value => void mapRoom(room, value)} disabled={!canMap || mappingBusy === room.id}><SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="Unmapped" /></SelectTrigger><SelectContent><SelectItem value="unmapped">Unmapped</SelectItem>{buildings.map(building => <SelectItem key={building.id} value={building.id}>{building.name}</SelectItem>)}</SelectContent></Select></div>)}</div>
        </div>}
      </CardContent>
    </Card>
  );
}
