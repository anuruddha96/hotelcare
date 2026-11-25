export type SlntRoomChipMode = 'assign' | 'manage';

interface SlntRoomChipBehaviorInput {
  isSlntTenant: boolean;
  assignedTo?: string | null;
  roomStatus?: string | null;
}

/**
 * SLNT keeps tap-to-assign for genuinely unassigned, available units.
 * Once a unit has an assignment (or is blocked Out of Service), the chip
 * becomes a room-management entry point instead of another assignment toggle.
 */
export function getSlntRoomChipMode({
  isSlntTenant,
  assignedTo,
  roomStatus,
}: SlntRoomChipBehaviorInput): SlntRoomChipMode {
  if (!isSlntTenant) return 'assign';
  if (roomStatus === 'out_of_order') return 'manage';
  return assignedTo ? 'manage' : 'assign';
}

/**
 * Out-of-service is a hard assignment lock for SLNT only. Other tenants keep
 * their existing behavior and can adopt their own service-status rules.
 */
export function canAssignSlntRoom(
  isSlntTenant: boolean,
  roomStatus?: string | null,
): boolean {
  return !(isSlntTenant && roomStatus === 'out_of_order');
}
