import { isUnsoldPlanningRoom } from '@/lib/nextDayHousekeepingSnapshot';

export const SLNT_TEAM_B_CODE = 'team-b';

export type TeamWorkloadRoom = {
  id: string;
  is_checkout_room?: boolean | null;
  pms_metadata?: Record<string, unknown> | null;
};

export type TeamWorkloadSummary = {
  confirmedCheckoutCount: number;
  dailyCount: number;
  unsoldCount: number;
  totalCount: number;
};

/**
 * Fail closed: when no explicit room mapping is supplied, no rooms are returned.
 * SLNT Team B is a unit-level mapping because both Previo accounts also contain
 * apartments handled by other cleaning teams.
 */
export function filterRoomsToMappedTeam<T extends { id: string }>(
  rooms: T[],
  mappedRoomIds: Iterable<string>,
): T[] {
  const allowed = new Set(mappedRoomIds);
  if (allowed.size === 0) return [];
  return rooms.filter(room => allowed.has(room.id));
}

/**
 * Keep provisional/unbooked rooms available for worst-case planning without
 * reporting them as confirmed checkouts.
 */
export function summarizeTeamWorkload(rooms: TeamWorkloadRoom[]): TeamWorkloadSummary {
  let confirmedCheckoutCount = 0;
  let dailyCount = 0;
  let unsoldCount = 0;

  for (const room of rooms) {
    if (isUnsoldPlanningRoom(room as any)) {
      unsoldCount += 1;
    } else if (room.is_checkout_room === true) {
      confirmedCheckoutCount += 1;
    } else {
      dailyCount += 1;
    }
  }

  return {
    confirmedCheckoutCount,
    dailyCount,
    unsoldCount,
    totalCount: rooms.length,
  };
}
