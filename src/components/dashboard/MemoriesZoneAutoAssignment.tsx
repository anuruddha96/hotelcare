import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, ArrowLeft, Check, Clock, GripVertical, Loader2, MapPin, RefreshCw, Users, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { isRoomEligibleForAutoAssign } from '@/lib/autoAssignRoomEligibility';
import { isPmsRtcToday } from '@/lib/pmsReadiness';
import { assignRoomToStaff } from '@/lib/hkAssignmentDnd';
import {
  type AssignmentPreview,
  type RoomForAssignment,
  type StaffForAssignment,
  autoAssignRooms,
  calculateRoomTime,
  calculateRoomWeight,
  calculateTimeEstimation,
  computeFairnessMetrics,
  formatMinutesToTime,
  moveRoom,
} from '@/lib/roomAssignmentAlgorithm';
import type { HousekeepingSectionTaskTemplate } from '@/lib/housekeepingSectionTasks';

interface MemoriesZoneAutoAssignmentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate: string;
  onAssignmentCreated: (roomCount?: number, staffCount?: number) => void;
}

type ExistingAssignment = {
  id: string;
  room_id: string;
  assigned_to: string;
  status: string;
  ready_to_clean: boolean | null;
};

type Zone = {
  id: string;
  name: string;
  floorNumber: number;
  rooms: RoomForAssignment[];
};

type LiveAreaTask = {
  status: string;
  assignedTo: string | null;
};

type DragItem =
  | { kind: 'staff'; staffId: string; label: string }
  | { kind: 'area'; taskId: string; label: string }
  | { kind: 'room'; roomId: string; fromStaffId: string; label: string }
  | { kind: 'staff-area'; taskId: string; fromStaffId: string; label: string };

type DragGhost = { label: string; x: number; y: number } | null;

const UNMAPPED_ZONE = '__unmapped__';

const isCheckoutLike = (room: RoomForAssignment) =>
  room.is_checkout_room === true || room.pms_metadata?.scheduledDepartureToday === true;

const zoneIdForRoom = (room: RoomForAssignment) => room.housekeeping_section_id || UNMAPPED_ZONE;

function previewForStaff(staff: StaffForAssignment, rooms: RoomForAssignment[]): AssignmentPreview {
  const sorted = [...rooms].sort((a, b) => {
    const checkoutDiff = Number(isCheckoutLike(b)) - Number(isCheckoutLike(a));
    if (checkoutDiff !== 0) return checkoutDiff;
    return a.room_number.localeCompare(b.room_number, undefined, { numeric: true });
  });
  const estimate = calculateTimeEstimation(sorted);
  return {
    staffId: staff.id,
    staffName: staff.full_name,
    rooms: sorted,
    totalWeight: sorted.reduce((sum, room) => sum + calculateRoomWeight(room), 0),
    checkoutCount: sorted.filter(isCheckoutLike).length,
    dailyCount: sorted.filter(room => !isCheckoutLike(room)).length,
    ...estimate,
  };
}

function mergePreviews(
  pieces: AssignmentPreview[],
  staffById: Map<string, StaffForAssignment>,
): AssignmentPreview[] {
  const roomsByStaff = new Map<string, RoomForAssignment[]>();
  for (const piece of pieces) {
    const current = roomsByStaff.get(piece.staffId) || [];
    current.push(...piece.rooms);
    roomsByStaff.set(piece.staffId, current);
  }
  return Array.from(roomsByStaff.entries()).map(([staffId, rooms]) => {
    const staff = staffById.get(staffId) || { id: staffId, full_name: `Staff ${staffId.slice(0, 6)}`, nickname: null };
    return previewForStaff(staff, rooms);
  }).sort((a, b) => a.staffName.localeCompare(b.staffName));
}

export function MemoriesZoneAutoAssignment({
  open,
  onOpenChange,
  selectedDate,
  onAssignmentCreated,
}: MemoriesZoneAutoAssignmentProps) {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<'zones' | 'review'>('zones');
  const [hotelName, setHotelName] = useState('Hotel Memories Budapest');
  const [staff, setStaff] = useState<StaffForAssignment[]>([]);
  const [checkedInStaff, setCheckedInStaff] = useState<Set<string>>(new Set());
  const [zones, setZones] = useState<Zone[]>([]);
  const [sectionTasks, setSectionTasks] = useState<HousekeepingSectionTaskTemplate[]>([]);
  const [liveAreaTasks, setLiveAreaTasks] = useState<Map<string, LiveAreaTask>>(new Map());
  const [zoneStaff, setZoneStaff] = useState<Map<string, Set<string>>>(new Map());
  const [areaZones, setAreaZones] = useState<Map<string, string>>(new Map());
  const [taskOwners, setTaskOwners] = useState<Map<string, string>>(new Map());
  const [existingAssignments, setExistingAssignments] = useState<Map<string, ExistingAssignment>>(new Map());
  const [assignmentPreviews, setAssignmentPreviews] = useState<AssignmentPreview[]>([]);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dragGhost, setDragGhost] = useState<DragGhost>(null);
  const [dragOverZoneId, setDragOverZoneId] = useState<string | null>(null);
  const [dragOverStaffId, setDragOverStaffId] = useState<string | null>(null);

  const staffById = useMemo(() => new Map(staff.map(member => [member.id, member])), [staff]);
  const taskById = useMemo(() => new Map(sectionTasks.map(task => [task.id, task])), [sectionTasks]);

  const tasksByZone = useMemo(() => {
    const grouped = new Map<string, HousekeepingSectionTaskTemplate[]>();
    for (const task of sectionTasks) {
      const zoneId = areaZones.get(task.id) || task.section_id;
      const list = grouped.get(zoneId) || [];
      list.push(task);
      grouped.set(zoneId, list);
    }
    return grouped;
  }, [sectionTasks, areaZones]);

  const areaMinutesByStaff = useMemo(() => {
    const minutes = new Map<string, number>();
    for (const task of sectionTasks) {
      const owner = taskOwners.get(task.id) || liveAreaTasks.get(task.id)?.assignedTo;
      if (!owner) continue;
      minutes.set(owner, (minutes.get(owner) || 0) + Number(task.estimated_duration || 0));
    }
    return minutes;
  }, [sectionTasks, taskOwners, liveAreaTasks]);

  const staffWithWork = useMemo(() => assignmentPreviews.filter(preview =>
    preview.rooms.length > 0 || (areaMinutesByStaff.get(preview.staffId) || 0) > 0
  ), [assignmentPreviews, areaMinutesByStaff]);

  const fairness = useMemo(() => computeFairnessMetrics(assignmentPreviews), [assignmentPreviews]);

  const setGhost = (event: React.DragEvent, label: string) => {
    if (!event.clientX && !event.clientY) return;
    setDragGhost({ label, x: event.clientX, y: event.clientY });
  };

  const clearDrag = () => {
    setDragItem(null);
    setDragGhost(null);
    setDragOverZoneId(null);
    setDragOverStaffId(null);
  };

  const smartSeedZones = (
    sourceZones: Zone[] = zones,
    sourceStaff: StaffForAssignment[] = staff,
    checked: Set<string> = checkedInStaff,
  ) => {
    const available = sourceStaff.filter(member => checked.size === 0 || checked.has(member.id));
    if (available.length === 0) {
      setZoneStaff(new Map());
      return;
    }

    const orderedZones = [...sourceZones].sort((a, b) => {
      const loadA = a.rooms.reduce((sum, room) => sum + calculateRoomTime(room), 0)
        + (tasksByZone.get(a.id) || []).reduce((sum, task) => sum + Number(task.estimated_duration || 0), 0);
      const loadB = b.rooms.reduce((sum, room) => sum + calculateRoomTime(room), 0)
        + (tasksByZone.get(b.id) || []).reduce((sum, task) => sum + Number(task.estimated_duration || 0), 0);
      return loadB - loadA;
    });

    const next = new Map<string, Set<string>>();
    orderedZones.forEach(zone => next.set(zone.id, new Set()));
    const assignedCount = new Map<string, number>();

    available.forEach((member, index) => {
      const target = index < orderedZones.length
        ? orderedZones[index]
        : [...orderedZones].sort((a, b) =>
            (assignedCount.get(a.id) || 0) - (assignedCount.get(b.id) || 0)
            || b.rooms.length - a.rooms.length
          )[0];
      if (!target) return;
      next.get(target.id)!.add(member.id);
      assignedCount.set(target.id, (assignedCount.get(target.id) || 0) + 1);
    });
    setZoneStaff(next);
  };

  const fetchData = async () => {
    if (!open || !profile?.assigned_hotel || !profile?.organization_slug) return;
    setLoading(true);
    try {
      const { data: config } = await supabase
        .from('hotel_configurations')
        .select('hotel_name')
        .eq('hotel_id', profile.assigned_hotel)
        .maybeSingle();
      const resolvedHotelName = config?.hotel_name || 'Hotel Memories Budapest';
      setHotelName(resolvedHotelName);

      const resolvedKeys = await resolveHotelKeys(profile.assigned_hotel);
      const hotelKeys = resolvedKeys.length ? resolvedKeys : [profile.assigned_hotel, resolvedHotelName];

      const { data: staffRows, error: staffError } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .or('role.eq.housekeeping,acts_as_housekeeper.eq.true')
        .in('assigned_hotel', hotelKeys)
        .eq('organization_slug', profile.organization_slug)
        .order('full_name');
      if (staffError) throw staffError;
      let staffList = (staffRows || []) as StaffForAssignment[];

      const { data: attendanceRows } = await supabase
        .from('staff_attendance')
        .select('user_id')
        .eq('work_date', selectedDate)
        .in('status', ['checked_in', 'on_break']);
      const hotelStaffIds = new Set(staffList.map(member => member.id));
      const checked = new Set((attendanceRows || []).map(row => row.user_id).filter(id => hotelStaffIds.has(id)));

      const { data: roomRows, error: roomError } = await supabase
        .from('rooms')
        .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
        .in('hotel', hotelKeys);
      if (roomError) throw roomError;

      const { data: sectionRows, error: sectionError } = await (supabase as any)
        .from('hotel_housekeeping_sections')
        .select('id, name, floor_number, sort_order')
        .eq('hotel_name', resolvedHotelName)
        .eq('is_active', true)
        .order('floor_number')
        .order('sort_order');
      if (sectionError) throw sectionError;

      const sections = (sectionRows || []) as Array<{ id: string; name: string; floor_number: number; sort_order: number }>;
      const sectionIds = sections.map(section => section.id);
      let roomMappings: Array<{ room_id: string; section_id: string }> = [];
      let taskRows: HousekeepingSectionTaskTemplate[] = [];
      if (sectionIds.length > 0) {
        const [mappingResult, taskResult] = await Promise.all([
          (supabase as any).from('hotel_housekeeping_section_rooms').select('room_id, section_id').in('section_id', sectionIds),
          (supabase as any)
            .from('hotel_housekeeping_section_tasks')
            .select('id, section_id, task_name, icon, estimated_duration, auto_assign, is_active, sort_order')
            .in('section_id', sectionIds)
            .eq('is_active', true)
            .eq('auto_assign', true)
            .order('sort_order'),
        ]);
        if (mappingResult.error) throw mappingResult.error;
        if (taskResult.error) throw taskResult.error;
        roomMappings = mappingResult.data || [];
        const sectionById = new Map(sections.map(section => [section.id, section]));
        taskRows = (taskResult.data || []).flatMap((task: any) => {
          const section = sectionById.get(task.section_id);
          return section ? [{ ...task, section_name: section.name, floor_number: section.floor_number }] : [];
        });
      }

      const roomSection = new Map(roomMappings.map(mapping => [mapping.room_id, mapping.section_id]));
      const roomIds = (roomRows || []).map(room => room.id);
      let assignmentRows: ExistingAssignment[] = [];
      if (roomIds.length > 0) {
        const { data, error } = await supabase
          .from('room_assignments')
          .select('id, room_id, assigned_to, status, ready_to_clean')
          .eq('assignment_date', selectedDate)
          .in('room_id', roomIds);
        if (error) throw error;
        assignmentRows = (data || []) as ExistingAssignment[];
      }

      const ownerIds = Array.from(new Set(assignmentRows.map(row => row.assigned_to).filter(Boolean)));
      const missingOwnerIds = ownerIds.filter(id => !staffList.some(member => member.id === id));
      if (missingOwnerIds.length > 0) {
        const { data: ownerProfiles } = await supabase
          .from('profiles')
          .select('id, full_name, nickname')
          .in('id', missingOwnerIds)
          .eq('organization_slug', profile.organization_slug);
        if (ownerProfiles?.length) staffList = [...staffList, ...(ownerProfiles as StaffForAssignment[])];
      }

      const activeMap = new Map(assignmentRows
        .filter(row => ['assigned', 'in_progress', 'dnd_pending_retry'].includes(row.status))
        .map(row => [row.room_id, row]));
      const completedIds = new Set(assignmentRows.filter(row => row.status === 'completed').map(row => row.room_id));

      const enrichedRooms = (roomRows || [])
        .filter(room => isRoomEligibleForAutoAssign(room as RoomForAssignment, {
          hasActiveAssignment: activeMap.has(room.id),
          hasCompletedAssignment: completedIds.has(room.id),
        }))
        .map(room => {
          const sectionId = roomSection.get(room.id) || null;
          const section = sections.find(candidate => candidate.id === sectionId);
          return {
            ...room,
            ready_to_clean: activeMap.get(room.id)?.ready_to_clean ?? false,
            housekeeping_section_id: sectionId,
            housekeeping_section_name: section?.name || null,
          } as RoomForAssignment;
        });

      const zoneRows: Zone[] = sections.map(section => ({
        id: section.id,
        name: section.name,
        floorNumber: section.floor_number,
        rooms: enrichedRooms.filter(room => room.housekeeping_section_id === section.id),
      })).filter(zone => zone.rooms.length > 0 || taskRows.some(task => task.section_id === zone.id));
      const unmapped = enrichedRooms.filter(room => !room.housekeeping_section_id);
      if (unmapped.length > 0) {
        zoneRows.push({ id: UNMAPPED_ZONE, name: 'Needs mapping', floorNumber: 99, rooms: unmapped });
      }

      let liveTaskMap = new Map<string, LiveAreaTask>();
      if (taskRows.length > 0) {
        const { data: liveRows } = await (supabase as any)
          .from('general_tasks')
          .select('housekeeping_section_task_id, status, assigned_to')
          .eq('hotel', resolvedHotelName)
          .eq('assigned_date', selectedDate)
          .in('housekeeping_section_task_id', taskRows.map(task => task.id));
        liveTaskMap = new Map((liveRows || []).map((row: any) => [
          row.housekeeping_section_task_id,
          { status: row.status as string, assignedTo: row.assigned_to as string | null },
        ]));
      }

      const initialAreaZones = new Map(taskRows.map(task => [task.id, task.section_id]));
      const existingZoneStaff = new Map<string, Set<string>>();
      zoneRows.forEach(zone => existingZoneStaff.set(zone.id, new Set()));
      for (const room of enrichedRooms) {
        const assignment = activeMap.get(room.id);
        if (!assignment?.assigned_to) continue;
        const zoneId = zoneIdForRoom(room);
        if (!existingZoneStaff.has(zoneId)) existingZoneStaff.set(zoneId, new Set());
        existingZoneStaff.get(zoneId)!.add(assignment.assigned_to);
      }

      setStaff(staffList);
      setCheckedInStaff(checked);
      setZones(zoneRows);
      setSectionTasks(taskRows);
      setLiveAreaTasks(liveTaskMap);
      setAreaZones(initialAreaZones);
      setExistingAssignments(activeMap);
      setTaskOwners(new Map());
      setAssignmentPreviews([]);
      setStep('zones');

      const hasExistingZoneOwners = Array.from(existingZoneStaff.values()).some(ids => ids.size > 0);
      if (hasExistingZoneOwners) {
        setZoneStaff(existingZoneStaff);
      } else {
        // Seed a useful starting suggestion. Managers can drag staff to change it.
        const available = staffList.filter(member => checked.size === 0 || checked.has(member.id));
        const ordered = [...zoneRows].sort((a, b) =>
          b.rooms.reduce((sum, room) => sum + calculateRoomTime(room), 0)
          - a.rooms.reduce((sum, room) => sum + calculateRoomTime(room), 0)
        );
        const seeded = new Map<string, Set<string>>();
        ordered.forEach(zone => seeded.set(zone.id, new Set()));
        available.forEach((member, index) => {
          if (!ordered.length) return;
          const target = index < ordered.length
            ? ordered[index]
            : [...ordered].sort((a, b) => (seeded.get(a.id)?.size || 0) - (seeded.get(b.id)?.size || 0))[0];
          seeded.get(target.id)!.add(member.id);
        });
        setZoneStaff(seeded);
      }
    } catch (error) {
      console.error('[MemoriesZoneAutoAssignment] load failed:', error);
      toast.error('Could not load Hotel Memories zone assignment data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedDate, profile?.assigned_hotel]);

  const addStaffToZone = (zoneId: string, staffId: string) => {
    setZoneStaff(previous => {
      const next = new Map(previous);
      const members = new Set(next.get(zoneId) || []);
      members.add(staffId);
      next.set(zoneId, members);
      return next;
    });
  };

  const removeStaffFromZone = (zoneId: string, staffId: string) => {
    setZoneStaff(previous => {
      const next = new Map(previous);
      const members = new Set(next.get(zoneId) || []);
      members.delete(staffId);
      next.set(zoneId, members);
      return next;
    });
  };

  const moveAreaToZone = (taskId: string, zoneId: string) => {
    const live = liveAreaTasks.get(taskId);
    if (live && live.status !== 'assigned') {
      toast.warning('This public-area task has already started and cannot be moved.');
      return;
    }
    setAreaZones(previous => new Map(previous).set(taskId, zoneId));
  };

  const handleZoneDrop = (zoneId: string, event: React.DragEvent) => {
    event.preventDefault();
    if (!dragItem) return;
    if (dragItem.kind === 'staff') addStaffToZone(zoneId, dragItem.staffId);
    if (dragItem.kind === 'area') moveAreaToZone(dragItem.taskId, zoneId);
    clearDrag();
  };

  const generateZonePlan = () => {
    const problems: string[] = [];
    for (const zone of zones) {
      const hasWork = zone.rooms.some(room => existingAssignments.get(room.id)?.status !== 'in_progress')
        || (tasksByZone.get(zone.id) || []).some(task => liveAreaTasks.get(task.id)?.status === 'assigned' || !liveAreaTasks.has(task.id));
      if (hasWork && (zoneStaff.get(zone.id)?.size || 0) === 0) problems.push(zone.name);
    }
    if (problems.length > 0) {
      toast.error(`Add at least one housekeeper to: ${problems.join(', ')}`);
      return;
    }

    const localStaffById = new Map(staff.map(member => [member.id, member]));
    const pieces: AssignmentPreview[] = [];

    // Work zone-by-zone. A room can only be considered by staff explicitly placed
    // in that zone, so locality is a hard rule rather than a scoring preference.
    for (const zone of zones) {
      const fixedRooms = zone.rooms.filter(room => existingAssignments.get(room.id)?.status === 'in_progress');
      const plannableRooms = zone.rooms.filter(room => existingAssignments.get(room.id)?.status !== 'in_progress');
      const candidateIds = Array.from(zoneStaff.get(zone.id) || []);
      const candidates = candidateIds.map(id => localStaffById.get(id)).filter(Boolean) as StaffForAssignment[];

      if (plannableRooms.length > 0 && candidates.length > 0) {
        pieces.push(...autoAssignRooms(plannableRooms, candidates, undefined, undefined, {
          hotelName,
          floorPenaltyMultiplier: 2.2,
          floorOwnershipBonus: 420,
        }));
      }

      for (const room of fixedRooms) {
        const ownerId = existingAssignments.get(room.id)?.assigned_to;
        if (!ownerId) continue;
        if (!localStaffById.has(ownerId)) {
          localStaffById.set(ownerId, { id: ownerId, full_name: `Staff ${ownerId.slice(0, 6)}`, nickname: null });
        }
        pieces.push(previewForStaff(localStaffById.get(ownerId)!, [room]));
      }
    }

    const merged = mergePreviews(pieces, localStaffById);
    const roomLoad = new Map(merged.map(preview => [preview.staffId, preview.estimatedMinutes]));
    const extraLoad = new Map<string, number>();
    const owners = new Map<string, string>();

    for (const task of [...sectionTasks].sort((a, b) => b.estimated_duration - a.estimated_duration)) {
      const live = liveAreaTasks.get(task.id);
      if (live && live.status !== 'assigned' && live.assignedTo) {
        owners.set(task.id, live.assignedTo);
        extraLoad.set(live.assignedTo, (extraLoad.get(live.assignedTo) || 0) + Number(task.estimated_duration || 0));
        continue;
      }
      const zoneId = areaZones.get(task.id) || task.section_id;
      const candidates = Array.from(zoneStaff.get(zoneId) || []);
      if (candidates.length === 0) continue;
      const owner = candidates.sort((a, b) =>
        ((roomLoad.get(a) || 0) + (extraLoad.get(a) || 0))
        - ((roomLoad.get(b) || 0) + (extraLoad.get(b) || 0))
      )[0];
      owners.set(task.id, owner);
      extraLoad.set(owner, (extraLoad.get(owner) || 0) + Number(task.estimated_duration || 0));
    }

    // Include area-only staff cards in review.
    const previewIds = new Set(merged.map(preview => preview.staffId));
    for (const ownerId of owners.values()) {
      if (previewIds.has(ownerId)) continue;
      const member = localStaffById.get(ownerId);
      if (member) merged.push(previewForStaff(member, []));
    }

    setTaskOwners(owners);
    setAssignmentPreviews(merged.sort((a, b) => a.staffName.localeCompare(b.staffName)));
    setStep('review');
  };

  const isStaffAllowedForRoom = (room: RoomForAssignment, staffId: string) =>
    zoneStaff.get(zoneIdForRoom(room))?.has(staffId) === true;

  const moveRoomToStaff = (roomId: string, fromStaffId: string, toStaffId: string) => {
    if (fromStaffId === toStaffId) return;
    const source = assignmentPreviews.find(preview => preview.staffId === fromStaffId);
    const room = source?.rooms.find(candidate => candidate.id === roomId);
    if (!room) return;
    if (existingAssignments.get(room.id)?.status === 'in_progress') {
      toast.warning(`Room ${room.room_number} is already being cleaned and is locked to its current housekeeper.`);
      return;
    }
    if (!isStaffAllowedForRoom(room, toStaffId)) {
      const zone = zones.find(candidate => candidate.id === zoneIdForRoom(room));
      const target = staffById.get(toStaffId)?.full_name || 'that housekeeper';
      toast.warning(`${target} is not assigned to ${zone?.name || 'this zone'}. Add them to the zone first.`);
      return;
    }
    setAssignmentPreviews(previous => moveRoom(previous, roomId, fromStaffId, toStaffId));
  };

  const moveTaskToStaff = (taskId: string, toStaffId: string) => {
    const task = taskById.get(taskId);
    if (!task) return;
    const live = liveAreaTasks.get(taskId);
    if (live && live.status !== 'assigned') {
      toast.warning(`${task.task_name} has already started and cannot be reassigned.`);
      return;
    }
    const zoneId = areaZones.get(taskId) || task.section_id;
    if (!zoneStaff.get(zoneId)?.has(toStaffId)) {
      const zone = zones.find(candidate => candidate.id === zoneId);
      toast.warning(`This public area belongs to ${zone?.name || 'another zone'}. Add the housekeeper to that zone first.`);
      return;
    }
    setTaskOwners(previous => new Map(previous).set(taskId, toStaffId));
  };

  const handleStaffDrop = (toStaffId: string, event: React.DragEvent) => {
    event.preventDefault();
    if (!dragItem) return;
    if (dragItem.kind === 'room') moveRoomToStaff(dragItem.roomId, dragItem.fromStaffId, toStaffId);
    if (dragItem.kind === 'staff-area') moveTaskToStaff(dragItem.taskId, toStaffId);
    clearDrag();
  };

  const savePlan = async () => {
    if (!user?.id || !profile?.organization_slug) return;
    setSaving(true);
    try {
      const finalRooms = assignmentPreviews.flatMap(preview => preview.rooms.map(room => ({ room, staffId: preview.staffId })));
      for (const { room, staffId } of finalRooms) {
        const current = existingAssignments.get(room.id);
        if (current?.status === 'in_progress') continue;
        if (current?.assigned_to === staffId) continue;
        const checkout = isCheckoutLike(room);
        await assignRoomToStaff({
          roomId: room.id,
          staffId,
          assignmentDate: selectedDate,
          assignedBy: user.id,
          organizationSlug: profile.organization_slug,
          isCheckoutRoom: checkout,
          readyToClean: checkout ? (room.ready_to_clean === true || isPmsRtcToday(room.pms_metadata as any)) : true,
          priority: checkout ? 1 : 2,
        });
      }

      const movableTasks = sectionTasks.filter(task => {
        const live = liveAreaTasks.get(task.id);
        return !live || live.status === 'assigned';
      }).flatMap(task => {
        const owner = taskOwners.get(task.id);
        return owner ? [{ section_task_id: task.id, assigned_to: owner }] : [];
      });
      if (movableTasks.length > 0) {
        const { error } = await (supabase as any).rpc('assign_housekeeping_section_tasks', {
          p_hotel_name: hotelName,
          p_assigned_date: selectedDate,
          p_assignments: movableTasks,
        });
        if (error) throw error;
      }

      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
      const roomCount = finalRooms.length;
      const activeStaffCount = new Set([
        ...finalRooms.map(entry => entry.staffId),
        ...Array.from(taskOwners.values()),
      ]).size;
      toast.success(`Hotel Memories: ${roomCount} rooms and ${movableTasks.length} public-area tasks assigned by zone.`);
      onAssignmentCreated(roomCount, activeStaffCount);
      onOpenChange(false);
    } catch (error) {
      console.error('[MemoriesZoneAutoAssignment] save failed:', error);
      toast.error('Could not save the zone assignment. No unrelated rooms were changed.');
    } finally {
      setSaving(false);
    }
  };

  const roomCount = zones.reduce((sum, zone) => sum + zone.rooms.length, 0);
  const checkoutCount = zones.reduce((sum, zone) => sum + zone.rooms.filter(isCheckoutLike).length, 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[94vh] w-full max-w-[98vw] flex-col gap-3 p-3 sm:max-w-[96vw] sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <Wand2 className="h-5 w-5" />
              Hotel Memories · Zone Auto Assign
              <Badge className="bg-emerald-600">Memories only</Badge>
              <Badge variant="outline">{selectedDate}</Badge>
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex min-h-[45vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {step === 'zones' ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-lg border bg-muted/30 p-3 text-center"><div className="text-xl font-bold">{roomCount}</div><div className="text-xs text-muted-foreground">rooms today</div></div>
                    <div className="rounded-lg border bg-muted/30 p-3 text-center"><div className="text-xl font-bold text-amber-600">{checkoutCount}</div><div className="text-xs text-muted-foreground">checkouts</div></div>
                    <div className="rounded-lg border bg-muted/30 p-3 text-center"><div className="text-xl font-bold">{zones.length}</div><div className="text-xs text-muted-foreground">zones</div></div>
                    <div className="rounded-lg border bg-muted/30 p-3 text-center"><div className="text-xl font-bold text-emerald-600">{sectionTasks.length}</div><div className="text-xs text-muted-foreground">mapped public areas</div></div>
                  </div>

                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
                    <strong>Zone rule is hard:</strong> rooms are distributed only to housekeepers placed in that zone. A housekeeper can be added to more than one zone only when you deliberately want them to cover both. Public-area work follows the same zone rule.
                  </div>

                  <div className="sticky top-0 z-20 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2"><Users className="h-4 w-4" /><span className="text-sm font-semibold">Housekeepers · drag into zones</span></div>
                      <Button size="sm" variant="outline" onClick={() => smartSeedZones()}><RefreshCw className="mr-1 h-3.5 w-3.5" />Smart zone suggestion</Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {staff.map(member => (
                        <div
                          key={member.id}
                          draggable
                          onDragStart={() => setDragItem({ kind: 'staff', staffId: member.id, label: member.full_name })}
                          onDrag={event => setGhost(event, member.full_name)}
                          onDragEnd={clearDrag}
                          className="flex cursor-grab items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium shadow-sm active:cursor-grabbing"
                        >
                          <GripVertical className="h-3 w-3 text-muted-foreground" />{member.full_name}
                          {checkedInStaff.has(member.id) && <span className="text-[9px] font-bold text-emerald-600">● IN</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {zones.sort((a, b) => a.floorNumber - b.floorNumber || a.name.localeCompare(b.name)).map(zone => {
                      const members = Array.from(zoneStaff.get(zone.id) || []);
                      const tasks = tasksByZone.get(zone.id) || [];
                      const isUnmapped = zone.id === UNMAPPED_ZONE;
                      return (
                        <div
                          key={zone.id}
                          onDragOver={event => { event.preventDefault(); setDragOverZoneId(zone.id); if (dragGhost) setGhost(event, dragGhost.label); }}
                          onDragLeave={() => setDragOverZoneId(current => current === zone.id ? null : current)}
                          onDrop={event => handleZoneDrop(zone.id, event)}
                          className={`rounded-xl border-2 p-3 transition ${dragOverZoneId === zone.id ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : isUnmapped ? 'border-red-300 bg-red-50/40' : 'border-border bg-card'}`}
                        >
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <div><div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /><h3 className="font-semibold">{zone.name}</h3>{isUnmapped && <Badge variant="destructive">mapping required</Badge>}</div><p className="text-xs text-muted-foreground">Floor {zone.floorNumber} · {zone.rooms.length} rooms · {tasks.length} public-area tasks</p></div>
                            <span className="text-xs font-medium text-muted-foreground">{formatMinutesToTime(zone.rooms.reduce((sum, room) => sum + calculateRoomTime(room), 0))}</span>
                          </div>

                          <div className="mb-2 min-h-10 rounded-lg border border-dashed bg-muted/20 p-2">
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Housekeepers in this zone</div>
                            <div className="flex flex-wrap gap-1.5">
                              {members.map(staffId => {
                                const member = staffById.get(staffId);
                                if (!member) return null;
                                return <span key={staffId} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{member.full_name}<button type="button" onClick={() => removeStaffFromZone(zone.id, staffId)} className="rounded-full p-0.5 hover:bg-primary/10" aria-label={`Remove ${member.full_name} from ${zone.name}`}><X className="h-3 w-3" /></button></span>;
                              })}
                              {members.length === 0 && <span className="text-xs text-muted-foreground">Drop housekeeper here</span>}
                            </div>
                            <div className="mt-2 sm:hidden">
                              <Select onValueChange={value => addStaffToZone(zone.id, value)}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Add housekeeper" /></SelectTrigger>
                                <SelectContent>{staff.map(member => <SelectItem key={member.id} value={member.id}>{member.full_name}</SelectItem>)}</SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="mb-2">
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Rooms</div>
                            <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                              {zone.rooms.map(room => {
                                const active = existingAssignments.get(room.id);
                                return <span key={room.id} className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${isCheckoutLike(room) ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>{room.room_number}{active?.status === 'in_progress' ? ' 🔒' : ''}{room.towel_change_required && !isCheckoutLike(room) ? ' T' : ''}{room.linen_change_required && !isCheckoutLike(room) ? ' C' : ''}</span>;
                              })}
                            </div>
                          </div>

                          <div>
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Public-area work · drag between zones</div>
                            <div className="flex flex-wrap gap-1.5">
                              {tasks.map(task => {
                                const live = liveAreaTasks.get(task.id);
                                const locked = !!live && live.status !== 'assigned';
                                return (
                                  <div
                                    key={task.id}
                                    draggable={!locked}
                                    onDragStart={() => !locked && setDragItem({ kind: 'area', taskId: task.id, label: task.task_name })}
                                    onDrag={event => !locked && setGhost(event, task.task_name)}
                                    onDragEnd={clearDrag}
                                    className={`inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-900 ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'}`}
                                    title={locked ? `Already ${live?.status}` : 'Drag this public area to another zone for today'}
                                  >
                                    <span>{task.icon || '🧹'}</span>{task.task_name}<span className="opacity-60">{task.estimated_duration}m</span>{locked && <span>🔒</span>}
                                  </div>
                                );
                              })}
                              {tasks.length === 0 && <span className="text-xs text-muted-foreground">No recurring public-area work mapped here.</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 p-3">
                    <div><h3 className="font-semibold">Zone-safe assignment preview</h3><p className="text-xs text-muted-foreground">Drag a room or public-area chip to another housekeeper. The chip remains visible across cards, and invalid cross-zone drops are blocked.</p></div>
                    <div className="flex gap-2 text-xs"><Badge variant="outline">CO ±{fairness.checkoutDiff}</Badge><Badge variant="outline">Time spread {fairness.timeSpreadMinutes}m</Badge></div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {assignmentPreviews.map(preview => {
                      const ownedTasks = sectionTasks.filter(task => taskOwners.get(task.id) === preview.staffId || (!taskOwners.has(task.id) && liveAreaTasks.get(task.id)?.assignedTo === preview.staffId));
                      const areaMinutes = ownedTasks.reduce((sum, task) => sum + Number(task.estimated_duration || 0), 0);
                      const totalMinutes = preview.totalWithBreak + areaMinutes;
                      const isOver = totalMinutes > 480;
                      return (
                        <div
                          key={preview.staffId}
                          onDragOver={event => { event.preventDefault(); setDragOverStaffId(preview.staffId); if (dragGhost) setGhost(event, dragGhost.label); }}
                          onDragLeave={() => setDragOverStaffId(current => current === preview.staffId ? null : current)}
                          onDrop={event => handleStaffDrop(preview.staffId, event)}
                          className={`rounded-xl border-2 bg-card transition ${dragOverStaffId === preview.staffId ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-200' : isOver ? 'border-red-300' : 'border-border'}`}
                        >
                          <div className="border-b bg-muted/30 p-3">
                            <div className="flex items-center justify-between gap-2"><span className="font-semibold">{preview.staffName}</span><Badge variant={isOver ? 'destructive' : 'outline'}>{formatMinutesToTime(totalMinutes)}</Badge></div>
                            <div className="mt-1 text-xs text-muted-foreground">{preview.checkoutCount} checkout · {preview.dailyCount} daily · {ownedTasks.length} public areas</div>
                          </div>
                          <div className="min-h-36 space-y-2 p-3">
                            <div><div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Rooms</div><div className="flex flex-wrap gap-1.5">
                              {preview.rooms.map(room => {
                                const locked = existingAssignments.get(room.id)?.status === 'in_progress';
                                return (
                                  <div
                                    key={room.id}
                                    draggable={!locked}
                                    onDragStart={() => !locked && setDragItem({ kind: 'room', roomId: room.id, fromStaffId: preview.staffId, label: `Room ${room.room_number}` })}
                                    onDrag={event => !locked && setGhost(event, `Room ${room.room_number}`)}
                                    onDragEnd={clearDrag}
                                    className={`rounded border px-2 py-1 text-xs font-semibold shadow-sm ${isCheckoutLike(room) ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-blue-200 bg-blue-50 text-blue-900'} ${locked ? 'cursor-not-allowed opacity-70' : 'cursor-grab active:cursor-grabbing'}`}
                                  >
                                    {room.room_number}{locked ? ' 🔒' : ''}{room.towel_change_required && !isCheckoutLike(room) ? ' T' : ''}{room.linen_change_required && !isCheckoutLike(room) ? ' C' : ''}
                                  </div>
                                );
                              })}
                              {preview.rooms.length === 0 && <span className="text-xs text-muted-foreground">Drop zone-compatible work here.</span>}
                            </div></div>
                            <div><div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Public areas</div><div className="flex flex-wrap gap-1.5">
                              {ownedTasks.map(task => {
                                const live = liveAreaTasks.get(task.id);
                                const locked = !!live && live.status !== 'assigned';
                                return <div key={task.id} draggable={!locked} onDragStart={() => !locked && setDragItem({ kind: 'staff-area', taskId: task.id, fromStaffId: preview.staffId, label: task.task_name })} onDrag={event => !locked && setGhost(event, task.task_name)} onDragEnd={clearDrag} className={`rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-900 ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'}`}>{task.icon || '🧹'} {task.task_name} · {task.estimated_duration}m{locked ? ' 🔒' : ''}</div>;
                              })}
                            </div></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {staffWithWork.some(preview => preview.totalWithBreak + (areaMinutesByStaff.get(preview.staffId) || 0) > 480) && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900"><AlertTriangle className="mt-0.5 h-4 w-4" /><span>At least one housekeeper exceeds an 8-hour workload. Move work or add another housekeeper to the relevant zone before saving.</span></div>
                  )}
                </div>
              )}
            </div>
          )}

          {!loading && (
            <DialogFooter className="flex-shrink-0 gap-2 border-t pt-3">
              {step === 'zones' ? (
                <>
                  <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                  <Button onClick={generateZonePlan}><Wand2 className="mr-2 h-4 w-4" />Generate zone plan</Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setStep('zones')}><ArrowLeft className="mr-2 h-4 w-4" />Zone setup</Button>
                  <Button variant="outline" onClick={generateZonePlan}><RefreshCw className="mr-2 h-4 w-4" />Regenerate</Button>
                  <Button onClick={savePlan} disabled={saving || staffWithWork.some(preview => preview.totalWithBreak + (areaMinutesByStaff.get(preview.staffId) || 0) > 480)}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Save zone assignment
                  </Button>
                </>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {dragGhost && (
        <div
          className="pointer-events-none fixed z-[9999] rounded-lg border-2 border-primary bg-background px-3 py-2 text-sm font-semibold shadow-2xl"
          style={{ left: dragGhost.x + 14, top: dragGhost.y + 14 }}
          aria-hidden
        >
          {dragGhost.label}
        </div>
      )}
    </>
  );
}
