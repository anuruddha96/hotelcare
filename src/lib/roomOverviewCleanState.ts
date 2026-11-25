export type RoomCleanStateLike = {
  status?: string | null;
  last_cleaned_at?: string | null;
  pms_metadata?: Record<string, any> | null;
};

/**
 * A room is visually clean for the selected work date when HotelCare recorded
 * a cleaning that day, or a same-day PMS refresh explicitly confirmed the
 * current room status as clean. The latter avoids presenting fresh Previo Clean
 * rooms as amber/dirty while preserving last_cleaned_at as the real cleaning
 * timestamp rather than rewriting it during every sync.
 */
export function isRoomCleanForSelectedDate(room: RoomCleanStateLike, selectedDate: string): boolean {
  if (room.status !== 'clean') return false;

  const cleanedToday = !!room.last_cleaned_at
    && new Date(room.last_cleaned_at).toISOString().slice(0, 10) === selectedDate;
  const pmsConfirmedToday = room.pms_metadata?.pmsSyncDate === selectedDate
    || room.pms_metadata?.lastPmsRefreshDate === selectedDate;

  return cleanedToday || pmsConfirmedToday;
}
