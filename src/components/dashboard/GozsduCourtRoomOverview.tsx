import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BedDouble, Building2, Hotel, MapPin, Plus, RefreshCw, UserX } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { canManageHousekeepingMapping } from '@/lib/roleAccess';
import {
  GOZSDU_COURT_HOTEL_ID,
  getGozsduHousekeepingCycle,
  gozsduServiceLabel,
  type GozsduHousekeepingService,
} from '@/lib/gozsdu-housekeeping';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import type { SignedInHousekeeper } from './HotelRoomOverviewLive';

interface RoomData {
  id: string;
  hotel: string | null;
  room_number: string;
  floor_number: number | null;
  status: string | null;
  is_checkout_room: boolean | null;
  is_dnd: boolean | null;
  notes: string | null;
  wing: string | null;
  room_category: string | null;
  room_size_sqm: number | null;
  bed_type: string | null;
  guest_nights_stayed: number | null;
  towel_change_required: boolean | null;
  linen_change_required: boolean | null;
  pms_metadata?: any;
}

interface AssignmentData {
  id: string;
  room_id: string;
  assigned_to: string;
  status: string;
  assignment_type: string;
}

interface BuildingSection {
  id: string;
  name: string;
  sort_order: number;
}

interface BuildingMapping {
  room_id: string;
  section_id: string;
}

interface GozsduCourtRoomOverviewProps {
  selectedDate: string;
  hotelName: string;
  staffMap: Record<string, string>;
  refreshKey?: number;
  signedInHousekeepers?: SignedInHousekeeper[];
}

function numericRoomSort(a: RoomData, b: RoomData): number {
  return String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true });
}

function isCheckout(room: RoomData, assignment?: AssignmentData): boolean {
  return room.is_checkout_room === true
    || room.pms_metadata?.scheduledDepartureToday === true
    || room.pms_metadata?.checkedOutToday === true
    || assignment?.assignment_type === 'checkout_cleaning';
}

function isNoShow(room: RoomData): boolean {
  return room.pms_metadata?.isNoShow === true || Number(room.pms_metadata?.reservationStatusId) === 8;
}

function serviceFor(room: RoomData, checkout: boolean): GozsduHousekeepingService {
  if (checkout || isNoShow(room)) return 'none';
  const stored = room.pms_metadata?.gozsduHousekeeping?.serviceType;
  if (stored === 'towel_change' || stored === 'change_room') return stored;

  return getGozsduHousekeepingCycle({
    currentNight: room.pms_metadata?.currentNight ?? room.guest_nights_stayed,
    totalNights: room.pms_metadata?.totalNights,
    isCheckout: checkout,
  }).service;
}

function stayLabel(room: RoomData): string | null {
  const current = Number(room.pms_metadata?.currentNight ?? room.guest_nights_stayed ?? 0);
  const total = Number(room.pms_metadata?.totalNights ?? 0);
  return current > 0 && total > 0 ? `${current}/${total}` : null;
}

export function GozsduCourtRoomOverview({
  selectedDate,
  hotelName,
  staffMap,
  refreshKey,
}: GozsduCourtRoomOverviewProps) {
  const { user, profile } = useAuth();
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [assignments, setAssignments] = useState<AssignmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'rooms' | 'buildings'>('rooms');
  const [buildings, setBuildings] = useState<BuildingSection[]>([]);
  const [buildingMappings, setBuildingMappings] = useState<BuildingMapping[]>([]);
  const [newBuildingName, setNewBuildingName] = useState('');
  const [mappingBusyRoom, setMappingBusyRoom] = useState<string | null>(null);
  const [creatingBuilding, setCreatingBuilding] = useState(false);

  const canManageMap = canManageHousekeepingMapping(profile?.role);

  const loadRooms = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const resolved = await resolveHotelKeys(hotelName);
      const keys = Array.from(new Set([GOZSDU_COURT_HOTEL_ID, 'Gozsdu Court Budapest', ...resolved]));
      const { data: roomRows, error: roomError } = await supabase
        .from('rooms')
        .select('id, hotel, room_number, floor_number, status, is_checkout_room, is_dnd, notes, wing, room_category, room_size_sqm, bed_type, guest_nights_stayed, towel_change_required, linen_change_required, pms_metadata')
        .in('hotel', keys)
        .order('room_number');
      if (roomError) throw roomError;

      const deduped = new Map<string, RoomData>();
      for (const room of (roomRows || []) as RoomData[]) {
        const current = deduped.get(room.room_number);
        if (!current || room.hotel === GOZSDU_COURT_HOTEL_ID) deduped.set(room.room_number, room);
      }
      const nextRooms = Array.from(deduped.values()).sort(numericRoomSort);
      const roomIds = nextRooms.map(room => room.id);

      let nextAssignments: AssignmentData[] = [];
      if (roomIds.length > 0) {
        const { data: assignmentRows, error: assignmentError } = await supabase
          .from('room_assignments')
          .select('id, room_id, assigned_to, status, assignment_type')
          .eq('assignment_date', selectedDate)
          .in('room_id', roomIds);
        if (assignmentError) throw assignmentError;
        nextAssignments = (assignmentRows || []) as AssignmentData[];
      }

      setRooms(nextRooms);
      setAssignments(nextAssignments);
    } catch (error) {
      console.error('[GozsduCourtRoomOverview] load failed', error);
      toast.error('Gozsdu housekeeping rooms could not be loaded');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [hotelName, selectedDate]);

  const loadBuildings = useCallback(async () => {
    try {
      const { data: sectionRows, error: sectionError } = await (supabase as any)
        .from('hotel_housekeeping_sections')
        .select('id, name, sort_order')
        .eq('hotel_name', GOZSDU_COURT_HOTEL_ID)
        .eq('is_active', true)
        .order('sort_order')
        .order('name');
      if (sectionError) throw sectionError;
      const nextBuildings = (sectionRows || []) as BuildingSection[];
      setBuildings(nextBuildings);

      if (nextBuildings.length === 0) {
        setBuildingMappings([]);
        return;
      }
      const { data: mappingRows, error: mappingError } = await (supabase as any)
        .from('hotel_housekeeping_section_rooms')
        .select('room_id, section_id')
        .in('section_id', nextBuildings.map(section => section.id));
      if (mappingError) throw mappingError;
      setBuildingMappings((mappingRows || []) as BuildingMapping[]);
    } catch (error) {
      console.error('[GozsduCourtRoomOverview] building map failed', error);
      toast.error('Gozsdu building mapping could not be loaded');
    }
  }, []);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms, refreshKey]);

  useEffect(() => {
    if (view === 'buildings') void loadBuildings();
  }, [loadBuildings, view]);

  const assignmentMap = useMemo(
    () => new Map(assignments.map(assignment => [assignment.room_id, assignment])),
    [assignments],
  );
  const buildingByRoom = useMemo(
    () => new Map(buildingMappings.map(mapping => [mapping.room_id, mapping.section_id])),
    [buildingMappings],
  );
  const buildingNameById = useMemo(
    () => new Map(buildings.map(building => [building.id, building.name])),
    [buildings],
  );

  const buckets = useMemo(() => {
    const checkoutRooms: RoomData[] = [];
    const secondDayRooms: RoomData[] = [];
    const otherRooms: RoomData[] = [];
    const noShowRooms: RoomData[] = [];

    for (const room of rooms) {
      const assignment = assignmentMap.get(room.id);
      const checkout = isCheckout(room, assignment);
      if (checkout) {
        checkoutRooms.push(room);
        continue;
      }
      if (isNoShow(room)) {
        noShowRooms.push(room);
        continue;
      }
      if (serviceFor(room, false) !== 'none') secondDayRooms.push(room);
      else otherRooms.push(room);
    }

    return { checkoutRooms, secondDayRooms, otherRooms, noShowRooms };
  }, [assignmentMap, rooms]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadRooms(true), view === 'buildings' ? loadBuildings() : Promise.resolve()]);
    setRefreshing(false);
  };

  const createBuilding = async () => {
    const name = newBuildingName.trim();
    if (!name || !canManageMap) return;
    setCreatingBuilding(true);
    try {
      const maxOrder = buildings.reduce((max, building) => Math.max(max, building.sort_order || 0), 0);
      const { data, error } = await (supabase as any)
        .from('hotel_housekeeping_sections')
        .insert({
          hotel_name: GOZSDU_COURT_HOTEL_ID,
          name,
          floor_number: 0,
          description: 'Gozsdu Court building / apartment group',
          color: 'slate',
          sort_order: maxOrder + 10,
          created_by: user?.id || null,
        })
        .select('id, name, sort_order')
        .single();
      if (error) throw error;
      setBuildings(previous => [...previous, data]);
      setNewBuildingName('');
      toast.success(`Building “${name}” created`);
    } catch (error: any) {
      console.error('[GozsduCourtRoomOverview] create building failed', error);
      toast.error(error?.code === '23505' ? 'This building already exists' : 'Building could not be created');
    } finally {
      setCreatingBuilding(false);
    }
  };

  const mapRoomToBuilding = async (room: RoomData, sectionId: string) => {
    if (!canManageMap) return;
    setMappingBusyRoom(room.id);
    const previousSectionId = buildingByRoom.get(room.id) || null;
    try {
      if (sectionId === 'unmapped') {
        const { error } = await (supabase as any)
          .from('hotel_housekeeping_section_rooms')
          .delete()
          .eq('room_id', room.id);
        if (error) throw error;
        setBuildingMappings(previous => previous.filter(mapping => mapping.room_id !== room.id));
        toast.success(`Room ${room.room_number} unmapped`);
      } else {
        const { error } = await (supabase as any)
          .from('hotel_housekeeping_section_rooms')
          .upsert({ room_id: room.id, section_id: sectionId, created_by: user?.id || null }, { onConflict: 'room_id' });
        if (error) throw error;
        setBuildingMappings(previous => [
          ...previous.filter(mapping => mapping.room_id !== room.id),
          { room_id: room.id, section_id: sectionId },
        ]);
        toast.success(`Room ${room.room_number} → ${buildingNameById.get(sectionId) || 'building'}`);
      }
    } catch (error) {
      console.error('[GozsduCourtRoomOverview] map room failed', error);
      toast.error(`Room ${room.room_number} mapping could not be saved`);
      if (previousSectionId) await loadBuildings();
    } finally {
      setMappingBusyRoom(null);
    }
  };

  const renderRoom = (room: RoomData, bucket: 'checkout' | 'service' | 'other' | 'noshow') => {
    const assignment = assignmentMap.get(room.id);
    const staffName = assignment ? staffMap[assignment.assigned_to] : null;
    const service = bucket === 'service' ? serviceFor(room, false) : 'none';
    const night = stayLabel(room);
    const buildingId = buildingByRoom.get(room.id);
    const building = buildingId ? buildingNameById.get(buildingId) : null;
    const bucketClass = bucket === 'checkout'
      ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30'
      : bucket === 'service' && service === 'change_room'
        ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/30'
        : bucket === 'service'
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
          : bucket === 'noshow'
            ? 'border-red-400 bg-red-50 dark:bg-red-950/30'
            : 'border-border bg-muted/30';

    return (
      <div key={room.id} className={`min-w-[92px] rounded-lg border px-2 py-1.5 shadow-sm ${bucketClass}`}>
        <div className="flex items-center gap-1">
          <span className="text-sm font-bold">{room.room_number}</span>
          {room.is_dnd && <Badge variant="outline" className="h-4 px-1 text-[8px]">DND</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {night && <Badge variant="outline" className="h-4 px-1 text-[8px]">{night}</Badge>}
          {service === 'towel_change' && <Badge className="h-4 bg-blue-600 px-1 text-[8px] text-white">T · Towel</Badge>}
          {service === 'change_room' && <Badge className="h-4 bg-orange-600 px-1 text-[8px] text-white">CR · Change</Badge>}
          {room.pms_metadata?.arrivalToday === true && bucket === 'other' && <Badge variant="outline" className="h-4 px-1 text-[8px]">Arrival</Badge>}
        </div>
        {staffName && <div className="mt-1 max-w-[130px] truncate text-[9px] text-muted-foreground">{staffName}</div>}
        {building && <div className="mt-0.5 max-w-[130px] truncate text-[9px] text-muted-foreground">🏢 {building}</div>}
      </div>
    );
  };

  const renderSection = (
    title: string,
    list: RoomData[],
    bucket: 'checkout' | 'service' | 'other' | 'noshow',
    icon: React.ReactNode,
    description: string,
  ) => (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {icon}
        <span className="text-sm font-semibold">{title}</span>
        <Badge variant="secondary" className="text-xs">{list.length}</Badge>
        <span className="text-[10px] text-muted-foreground">{description}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {list.map(room => renderRoom(room, bucket))}
        {list.length === 0 && <span className="text-xs text-muted-foreground">No rooms</span>}
      </div>
    </section>
  );

  if (loading) {
    return (
      <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading Gozsdu housekeeping overview…</CardContent></Card>
    );
  }

  return (
    <Card id="hotel-room-overview" className="border-primary/20">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Hotel className="h-4 w-4 text-primary" />
            Gozsdu Court Budapest · Housekeeping
          </CardTitle>
          <div className="flex gap-1.5">
            <Button size="sm" variant={view === 'rooms' ? 'default' : 'outline'} onClick={() => setView('rooms')}>Rooms</Button>
            <Button size="sm" variant={view === 'buildings' ? 'default' : 'outline'} onClick={() => setView('buildings')}>
              <Building2 className="mr-1 h-3.5 w-3.5" />Building mapping
            </Button>
            <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing}>
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
        <div className="rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
          Gozsdu-only rule: service every 2nd stay night. Every 4th stay night is <strong>Change Room</strong> only when more than one night remains; otherwise it is <strong>towel-only</strong>. Checkout rooms always follow checkout cleaning.
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {view === 'rooms' ? (
          <>
            {renderSection('Checkout rooms', buckets.checkoutRooms, 'checkout', <BedDouble className="h-4 w-4 text-amber-600" />, 'Departure / checkout cleaning')}
            <div className="border-t" />
            {renderSection('Second-day service rooms', buckets.secondDayRooms, 'service', <BedDouble className="h-4 w-4 text-blue-600" />, 'T = towel change · CR = Change Room')}
            <div className="border-t" />
            {renderSection('Other rooms', buckets.otherRooms, 'other', <MapPin className="h-4 w-4 text-slate-600" />, 'No scheduled housekeeping service today')}
            <div className="border-t" />
            {renderSection('No show', buckets.noShowRooms, 'noshow', <UserX className="h-4 w-4 text-red-600" />, 'Reservation no-show; not a stay-over service room')}
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold"><Building2 className="h-4 w-4" />Gozsdu building / apartment mapping</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Create the real building names, then map every apartment to its building. This mapping is stored only for Gozsdu Court Budapest.</p>
                </div>
                <div className="flex gap-1.5">
                  <Badge variant="secondary">{buildings.length} buildings</Badge>
                  <Badge variant="secondary">{buildingMappings.length}/{rooms.length} mapped</Badge>
                </div>
              </div>
              {canManageMap && (
                <div className="mt-3 flex max-w-md gap-2">
                  <Input value={newBuildingName} onChange={event => setNewBuildingName(event.target.value)} placeholder="Building name / address label" onKeyDown={event => { if (event.key === 'Enter') void createBuilding(); }} />
                  <Button onClick={createBuilding} disabled={creatingBuilding || !newBuildingName.trim()}>
                    <Plus className="mr-1 h-4 w-4" />Add
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {rooms.map(room => {
                const mapped = buildingByRoom.get(room.id) || 'unmapped';
                return (
                  <div key={room.id} className="flex items-center gap-2 rounded-lg border bg-card p-2">
                    <div className="min-w-[70px]">
                      <div className="text-sm font-bold">{room.room_number}</div>
                      <div className="text-[9px] text-muted-foreground">{stayLabel(room) ? `Stay ${stayLabel(room)}` : 'Apartment'}</div>
                    </div>
                    <Select value={mapped} onValueChange={value => void mapRoomToBuilding(room, value)} disabled={!canManageMap || mappingBusyRoom === room.id}>
                      <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="Unmapped" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unmapped">Unmapped</SelectItem>
                        {buildings.map(building => <SelectItem key={building.id} value={building.id}>{building.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
            {!canManageMap && <p className="text-xs text-muted-foreground">Building mapping is read-only for your role. Managers and supervisors can edit it.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
