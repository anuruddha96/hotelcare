import { supabase } from '@/integrations/supabase/client';
import { isRoomEligibleForAutoAssign } from '@/lib/autoAssignRoomEligibility';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { fetchVerifiedGozsduAutoAssignRooms } from '@/lib/gozsduVerifiedAutoAssign';
import { resolveCanonicalHotelId, resolveHotelKeys } from '@/lib/hotelKeys';
import {
  loadExistingNextDayPlan,
  type NextDayPlanItem,
} from '@/lib/nextDayAutoAssignBridge';
import {
  calculateRoomWeight,
  calculateTimeEstimation,
  type AssignmentPreview,
  type RoomForAssignment,
} from '@/lib/roomAssignmentAlgorithm';

const ACTIONABLE_CARRY_FORWARD_STATUSES = new Set(['approved', 'releasing']);
const ACTIVE_ASSIGNMENT_STATUSES = new Set(['assigned', 'in_progress', 'dnd_pending_retry']);

export type CarryForwardSeedResult = {
  seeded: boolean;
  preservedExistingDraft: boolean;
  planId: string | null;
  roomCount: number;
  reason: 'seeded' | 'existing-draft' | 'no-plan' | 'non-actionable' | 'no-eligible-rooms';
};

export function isActionableCurrentDayCarryForwardStatus(status: string | null | undefined): boolean {
  return !!status && ACTIONABLE_CARRY_FORWARD_STATUSES.has(status);
}

export function currentDayAutoAssignDraftKey(
  organizationSlug: string | null | undefined,
  hotel: string | null | undefined,
  date: string,
): string {
  return `auto_assignment_v3_${organizationSlug || 'unknown'}_${hotel || 'unknown'}_${date}`;
}

export function currentDayCarryForwardMarkerKey(
  organizationSlug: string | null | undefined,
  hotel: string | null | undefined,
  date: string,
): string {
  return `hk_carry_forward_v1_${organizationSlug || 'unknown'}_${hotel || 'unknown'}_${date}`;
}

export function clearCurrentDayCarryForwardDraft(args: {
  organizationSlug: string | null | undefined;
  assignedHotel: string | null | undefined;
  selectedDate: string;
}) {
  if (typeof window === 'undefined') return;
  try {
    const draftKey = currentDayAutoAssignDraftKey(
      args.organizationSlug,
      args.assignedHotel,
      args.selectedDate,
    );
    const markerKey = currentDayCarryForwardMarkerKey(
      args.organizationSlug,
      args.assignedHotel,
      args.selectedDate,
    );
    // The v3 key is also used by ordinary same-day Auto Assign drafts. Never
    // delete a manager's unrelated local work just because no carry-forward is
    // needed. Only remove the draft when our own explicit marker owns it.
    if (window.localStorage.getItem(markerKey)) {
      window.localStorage.removeItem(draftKey);
    }
    window.localStorage.removeItem(markerKey);
  } catch {
    // Browser storage is best-effort only. The live DB rows remain authoritative.
  }
}

function isCheckoutLike(room: RoomForAssignment): boolean {
  return room.is_checkout_room === true || room.pms_metadata?.scheduledDepartureToday === true;
}

function buildPreview(staffId: string, staffName: string, rooms: RoomForAssignment[]): AssignmentPreview {
  const sorted = [...rooms].sort((a, b) =>
    Number(isCheckoutLike(b)) - Number(isCheckoutLike(a))
    || (a.floor_number ?? 0) - (b.floor_number ?? 0)
    || String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true }),
  );
  const estimate = calculateTimeEstimation(sorted);
  return {
    staffId,
    staffName,
    rooms: sorted,
    totalWeight: sorted.reduce((sum, room) => sum + calculateRoomWeight(room), 0),
    checkoutCount: sorted.filter(isCheckoutLike).length,
    dailyCount: sorted.filter(room => !isCheckoutLike(room)).length,
    ...estimate,
  };
}

export function selectCarryForwardPrimaryItems(args: {
  planStatus: string | null | undefined;
  items: NextDayPlanItem[];
  eligibleRoomIds: Set<string>;
  completedRoomIds?: Set<string>;
}): NextDayPlanItem[] {
  if (!isActionableCurrentDayCarryForwardStatus(args.planStatus)) return [];
  const completed = args.completedRoomIds || new Set<string>();
  return args.items.filter(item =>
    item.source !== 'shared'
    && item.recommendation_context?.assignment_role !== 'shared'
    && args.eligibleRoomIds.has(item.room_id)
    && !completed.has(item.room_id),
  );
}

/**
 * Carry yesterday's approved plan into today's normal Auto Assign editor.
 *
 * This deliberately seeds only a client-side preview. It never publishes a room
 * assignment and never bypasses the morning release worker. The existing live
 * Auto Assign confirmation path remains responsible for DB writes, so managers
 * can review PMS/staff changes before applying anything.
 *
 * If morning release/manual work has already created only part of the day's live
 * rows, those live owners take precedence room-by-room while the still-approved
 * plan fills the remaining eligible rooms. This prevents a single early manual
 * assignment from hiding the rest of yesterday's approved plan.
 */
export async function seedCurrentDayCarryForwardDraft(args: {
  organizationSlug: string;
  assignedHotel: string;
  selectedDate: string;
}): Promise<CarryForwardSeedResult> {
  const canonicalHotelId = await resolveCanonicalHotelId(args.assignedHotel);
  if (!canonicalHotelId) {
    return { seeded: false, preservedExistingDraft: false, planId: null, roomCount: 0, reason: 'no-plan' };
  }

  const saved = await loadExistingNextDayPlan({
    organizationSlug: args.organizationSlug,
    hotelId: canonicalHotelId,
    selectedDate: args.selectedDate,
  });
  if (!saved.plan) {
    return { seeded: false, preservedExistingDraft: false, planId: null, roomCount: 0, reason: 'no-plan' };
  }
  if (!isActionableCurrentDayCarryForwardStatus(saved.plan.status)) {
    return {
      seeded: false,
      preservedExistingDraft: false,
      planId: saved.plan.id,
      roomCount: 0,
      reason: 'non-actionable',
    };
  }

  const draftKey = currentDayAutoAssignDraftKey(
    args.organizationSlug,
    args.assignedHotel,
    args.selectedDate,
  );
  const markerKey = currentDayCarryForwardMarkerKey(
    args.organizationSlug,
    args.assignedHotel,
    args.selectedDate,
  );

  if (typeof window !== 'undefined') {
    try {
      const existingDraft = window.localStorage.getItem(draftKey);
      const seededPlanId = window.localStorage.getItem(markerKey);
      // Once this plan has seeded the editor, preserve the manager's later local
      // edits across close/reopen instead of overwriting them with yesterday's
      // original snapshot.
      if (existingDraft && seededPlanId === saved.plan.id) {
        return {
          seeded: false,
          preservedExistingDraft: true,
          planId: saved.plan.id,
          roomCount: 0,
          reason: 'existing-draft',
        };
      }
    } catch {
      // Continue and rebuild from the persisted approved plan.
    }
  }

  const resolvedKeys = await resolveHotelKeys(args.assignedHotel);
  const hotelKeys = Array.from(new Set([
    canonicalHotelId,
    args.assignedHotel,
    ...resolvedKeys,
  ].filter(Boolean)));

  const { data: roomRows, error: roomError } = await supabase
    .from('rooms')
    .select('id, room_number, hotel, floor_number, room_size_sqm, room_capacity, is_checkout_room, pms_metadata, status, towel_change_required, linen_change_required, wing, elevator_proximity, room_category, bed_configuration, notes, checkout_time')
    .eq('organization_slug', args.organizationSlug)
    .in('hotel', hotelKeys);
  if (roomError) throw roomError;

  let currentRooms = (roomRows || []) as RoomForAssignment[];
  if (isGozsduCourtHotel(canonicalHotelId) || isGozsduCourtHotel(args.assignedHotel)) {
    currentRooms = await fetchVerifiedGozsduAutoAssignRooms(
      currentRooms,
      args.organizationSlug,
      args.selectedDate,
    );
  }

  const roomIds = currentRooms.map(room => room.id);
  const completedRoomIds = new Set<string>();
  const activeOwnerByRoom = new Map<string, string>();
  if (roomIds.length > 0) {
    const { data: assignmentRows, error: assignmentError } = await supabase
      .from('room_assignments')
      .select('room_id,status,assigned_to')
      .eq('assignment_date', args.selectedDate)
      .in('room_id', roomIds);
    if (assignmentError) throw assignmentError;
    for (const row of assignmentRows || []) {
      if (row.status === 'completed') completedRoomIds.add(row.room_id);
      else if (row.assigned_to && ACTIVE_ASSIGNMENT_STATUSES.has(row.status)) {
        activeOwnerByRoom.set(row.room_id, row.assigned_to);
      }
    }
  }

  const eligibleRooms = currentRooms.filter(room => isRoomEligibleForAutoAssign(room, {
    hasActiveAssignment: activeOwnerByRoom.has(room.id),
    hasCompletedAssignment: completedRoomIds.has(room.id),
  }));
  const eligibleById = new Map(eligibleRooms.map(room => [room.id, room]));
  const primaryItems = selectCarryForwardPrimaryItems({
    planStatus: saved.plan.status,
    items: saved.items,
    eligibleRoomIds: new Set(eligibleById.keys()),
    completedRoomIds,
  });

  if (primaryItems.length === 0) {
    return {
      seeded: false,
      preservedExistingDraft: false,
      planId: saved.plan.id,
      roomCount: 0,
      reason: 'no-eligible-rooms',
    };
  }

  const resolvedOwnerByRoom = new Map(primaryItems.map(item => [
    item.room_id,
    activeOwnerByRoom.get(item.room_id) || item.assigned_to,
  ]));
  const ownerIds = Array.from(new Set([
    ...saved.staffIds,
    ...resolvedOwnerByRoom.values(),
  ].filter(Boolean)));
  const { data: staffRows, error: staffError } = ownerIds.length
    ? await supabase
      .from('profiles')
      .select('id,full_name,nickname')
      .eq('organization_slug', args.organizationSlug)
      .in('id', ownerIds)
    : { data: [], error: null };
  if (staffError) throw staffError;

  const staffNames = new Map((staffRows || []).map(staff => [
    staff.id,
    String(staff.nickname || staff.full_name || 'Housekeeper'),
  ]));
  const grouped = new Map<string, RoomForAssignment[]>();
  for (const item of primaryItems) {
    const room = eligibleById.get(item.room_id);
    const ownerId = resolvedOwnerByRoom.get(item.room_id);
    if (!room || !ownerId) continue;
    if (!grouped.has(ownerId)) grouped.set(ownerId, []);
    grouped.get(ownerId)!.push(room);
  }

  const previews = Array.from(grouped.entries()).map(([staffId, rooms]) =>
    buildPreview(staffId, staffNames.get(staffId) || 'Housekeeper', rooms),
  );
  const managerLockedRooms = new Set(primaryItems
    .filter(item => item.source === 'manager' || item.recommendation_context?.manager_changed === true)
    .map(item => item.room_id));
  // A live room owner is newer than yesterday's plan. Lock it in the preview so
  // ordinary regeneration cannot silently move it. Explicitly removing that
  // cleaner from the staff pool still releases not-started locks via the
  // existing Auto Assign staff-availability logic.
  for (const roomId of activeOwnerByRoom.keys()) managerLockedRooms.add(roomId);

  const draft = {
    staffIds: ownerIds,
    previews,
    excludedRoomIds: [],
    maintenanceHoldRoomIds: [],
    savedAt: Date.now(),
    lockedRoomIds: Array.from(managerLockedRooms),
  };

  if (typeof window === 'undefined') {
    return {
      seeded: false,
      preservedExistingDraft: false,
      planId: saved.plan.id,
      roomCount: primaryItems.length,
      reason: 'no-plan',
    };
  }

  window.localStorage.setItem(draftKey, JSON.stringify(draft));
  window.localStorage.setItem(markerKey, saved.plan.id);

  return {
    seeded: true,
    preservedExistingDraft: false,
    planId: saved.plan.id,
    roomCount: primaryItems.length,
    reason: 'seeded',
  };
}
