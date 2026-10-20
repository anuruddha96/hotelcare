/** SLNT Team B shared pool display helpers. PMS-confirmed RTC is mandatory
 * for beginning checkout cleaning; stayovers and special services are separate.
 */
export type SlntPoolRoom = {
  is_checkout_room: boolean;
  pms_metadata: Record<string, unknown> | null;
};

export function isSlntRtcReady(room: SlntPoolRoom, today: string): boolean {
  if (!room.is_checkout_room) return false;
  const meta = room.pms_metadata ?? {};
  return meta.pmsSyncDate === today &&
    (meta.checkedOutToday === true ||
      (meta.readyToClean === true && meta.readyToCleanDate === today));
}

export function slntWorkSection(room: SlntPoolRoom, today: string):
  'rtc' | 'stayover' | 'waiting' {
  if (!room.is_checkout_room) return 'stayover';
  return isSlntRtcReady(room, today) ? 'rtc' : 'waiting';
}
