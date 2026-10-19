/**
 * A room-type-change notice is a rare manager action. Most rooms UPDATE events
 * are frequent PMS/RTC state writes and must not refetch an entire hotel's roster.
 *
 * A known notice room must still refresh when its notice is removed or amended.
 * The caller also runs a visibility-aware fallback poll for missed Realtime events.
 */
type RoomChangeRow = {
  id?: string | null;
  hotel?: string | null;
  pms_metadata?: unknown;
};

export type RoomTypeChangeEvent = {
  new?: RoomChangeRow | null;
  old?: RoomChangeRow | null;
};

function containsNoticeForDate(metadata: unknown, selectedDate: string): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const notice = (metadata as Record<string, unknown>).roomTypeChangeNotice;
  if (!notice || typeof notice !== 'object' || Array.isArray(notice)) return false;
  const { date, to } = notice as Record<string, unknown>;
  return date === selectedDate && (to === 'checkout' || to === 'daily');
}

export function shouldRefreshRoomTypeNotices(
  event: RoomTypeChangeEvent,
  hotelKeys: readonly string[],
  selectedDate: string,
  currentNoticeRoomIds: ReadonlySet<string>,
): boolean {
  const next = event.new ?? null;
  const previous = event.old ?? null;
  const hotel = next?.hotel ?? previous?.hotel;
  // Realtime can send incomplete old rows (replica identity DEFAULT), but the
  // updated row's hotel is always expected for an authorized table UPDATE.
  if (!hotel || !hotelKeys.includes(hotel)) return false;

  const roomId = next?.id ?? previous?.id;
  if (roomId && currentNoticeRoomIds.has(roomId)) return true;
  return containsNoticeForDate(next?.pms_metadata, selectedDate) ||
    containsNoticeForDate(previous?.pms_metadata, selectedDate);
}
