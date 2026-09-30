import { supabase } from '@/integrations/supabase/client';
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

export async function loadActiveSlntTeamRoomIds(
  organizationSlug: string,
  hotelId: string,
  teamCode = SLNT_TEAM_B_CODE,
): Promise<string[]> {
  const { data: team, error: teamError } = await (supabase as any)
    .from('housekeeping_teams')
    .select('id,assignment_mode,is_active')
    .eq('organization_slug', organizationSlug)
    .eq('hotel_id', hotelId)
    .eq('code', teamCode)
    .eq('is_active', true)
    .maybeSingle();
  if (teamError) throw teamError;
  if (!team?.id) throw new Error(`SLNT housekeeping team ${teamCode} is not configured.`);

  const { data: mappings, error: mappingError } = await (supabase as any)
    .from('housekeeping_team_rooms')
    .select('room_id')
    .eq('team_id', team.id)
    .eq('is_active', true);
  if (mappingError) throw mappingError;

  const roomIds = Array.from(new Set(
    (mappings || []).map((row: any) => String(row.room_id || '')).filter(Boolean),
  ));
  if (roomIds.length === 0) throw new Error(`SLNT housekeeping team ${teamCode} has no active room mapping.`);
  return roomIds;
}

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
