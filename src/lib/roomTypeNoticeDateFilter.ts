/**
 * Ask PostgREST to return only manager-created notices for the selected
 * business date. JSONB containment filtering is server-side: ordinary
 * room metadata is neither transferred nor parsed for this banner.
 *
 * The caller uses .contains('pms_metadata', filter), translated to JSONB @>.
 */
export function roomTypeNoticeDateFilter(selectedDate: string): {
  roomTypeChangeNotice: { date: string };
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
    throw new Error('Room-type notices require a business date in YYYY-MM-DD format');
  }
  return { roomTypeChangeNotice: { date: selectedDate } };
}
