export const SLNT_TEAM_B_CODE = 'team-b';
export const SLNT_TEAM_B_NAME = 'Team B';
export const SLNT_TEAM_B_EXPECTED_ROOM_COUNT = 46;

const TEAM_B_EXACT_ROOMS = new Set([
  'Be Local Budapest Apartment',
  'Dorothilux Apartment',
  'Giselle Apartment',
]);

/**
 * Mirrors the validated Team B workbook mapping without coupling runtime logic
 * to generated room UUIDs. The database migration resolves these labels against
 * the live SLNT room registry and fails if the total is not exactly 46.
 */
export function isSlntTeamBRoomNumber(roomNumber?: string | null): boolean {
  const value = (roomNumber || '').trim();
  if (!value) return false;
  if (TEAM_B_EXACT_ROOMS.has(value)) return true;
  if (/^WR Pension 10[1-6]$/.test(value)) return true;
  if (/^St King 11\s*[–-]\s*Room [1-9]$/.test(value)) return true;
  if (/^K4\s*[–-]\s*Room [1-7]$/.test(value)) return true;
  if (/^Silver Rooms (?:[1-9]|1\d|2[01])$/.test(value)) return true;
  return false;
}

export type SlntTeamTaskStatus = 'queued' | 'claimed' | 'cancelled';

export type SlntTeamTaskSummary = {
  total: number;
  queued: number;
  claimed: number;
  cancelled: number;
};

export function summarizeSlntTeamTasks(
  tasks: Array<{ status: SlntTeamTaskStatus }>,
): SlntTeamTaskSummary {
  return tasks.reduce<SlntTeamTaskSummary>((summary, task) => {
    summary.total += 1;
    summary[task.status] += 1;
    return summary;
  }, { total: 0, queued: 0, claimed: 0, cancelled: 0 });
}
