import { supabase } from '@/integrations/supabase/client';
import {
  isUnsoldPlanningRoom,
  nextDayRoomMatchTokens,
  type DailyOverviewWorkRow,
} from '@/lib/nextDayHousekeepingSnapshot';

export const SLNT_TEAM_B_CODE = 'team-b';

export type TeamWorkloadRoom = {
  id: string;
  room_number?: string | null;
  is_checkout_room?: boolean | null;
  pms_metadata?: Record<string, unknown> | null;
};

export type TeamWorkloadSummary = {
  confirmedCheckoutCount: number;
  dailyCount: number;
  unsoldCount: number;
  totalCount: number;
};

export type ActiveSlntTeamScope = {
  teamId: string;
  roomIds: string[];
};

export async function loadActiveSlntTeamScope(
  organizationSlug: string,
  hotelId: string,
  teamCode = SLNT_TEAM_B_CODE,
): Promise<ActiveSlntTeamScope> {
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
  return { teamId: String(team.id), roomIds };
}

export async function loadActiveSlntTeamRoomIds(
  organizationSlug: string,
  hotelId: string,
  teamCode = SLNT_TEAM_B_CODE,
): Promise<string[]> {
  return (await loadActiveSlntTeamScope(organizationSlug, hotelId, teamCode)).roomIds;
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
 * Team B filtering must use strong room identities only. Numeric aliases are
 * useful inside the generic room resolver, but they are unsafe for SLNT's
 * portfolio-wide feed because property/address numbers can collide with room
 * names (for example "Klauzal utca 11" and "St King 11 – Room 1").
 */
function strongRoomMatchTokens(value: unknown): string[] {
  return nextDayRoomMatchTokens(value)
    .filter(token => token.startsWith('full:') || token.startsWith('unit:'));
}

/**
 * The SLNT Previo snapshots are portfolio-wide and include Team A apartments.
 * Keep only rows that can resolve to one of the explicitly mapped Team B room
 * identities before asking the generic workload builder to classify them.
 */
export function filterSnapshotRowsToMappedRooms<T extends DailyOverviewWorkRow>(
  rows: T[],
  rooms: Array<Pick<TeamWorkloadRoom, 'room_number' | 'pms_metadata'>>,
): T[] {
  const allowedTokens = new Set(
    rooms.flatMap(room => [
      room.room_number,
      room.pms_metadata?.source_name,
    ].flatMap(value => strongRoomMatchTokens(value))),
  );
  if (allowedTokens.size === 0) return [];

  return rows.filter(row => {
    const tokens = [row.room_number, row.room_label]
      .flatMap(value => strongRoomMatchTokens(value));
    return tokens.some(token => allowedTokens.has(token));
  });
}

export function slntTeamBPropertyKey(roomNumber: string): string {
  const label = roomNumber.trim();
  if (/^Silver Rooms\s+/i.test(label)) return 'Silver Rooms';
  if (/^WR Pension\s+/i.test(label)) return 'WR Pension';
  if (/^St King 11\s*[–-]\s*Room\s+/i.test(label)) return 'St King 11';
  if (/^K4\s*[–-]\s*Room\s+/i.test(label)) return 'K4';
  return label;
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
