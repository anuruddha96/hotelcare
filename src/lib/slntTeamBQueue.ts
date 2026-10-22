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

/** SLNT-only visual ordering. RTC waiting always stays at the bottom; due
 * ready-to-clean checkouts precede towel/linen due stayovers, then ordinary daily work.
 * The server independently enforces RTC and tenant/claim permissions. */
export type SlntTeamBDisplayGroup = 'towel' | 'rtc' | 'due' | 'optional' | 'waiting';
export type SlntTeamBCardRoom = SlntPoolRoom & {
  towel_change_required: boolean;
  linen_change_required: boolean;
  is_optional: boolean;
};
export const SLNT_TEAM_B_DISPLAY_ORDER: readonly SlntTeamBDisplayGroup[] =
  ['rtc', 'towel', 'due', 'optional', 'waiting'];

export function slntTeamBDisplayGroup(room: SlntTeamBCardRoom, today: string): SlntTeamBDisplayGroup {
  if (room.is_checkout_room) return isSlntRtcReady(room, today) ? 'rtc' : 'waiting';
  if (room.is_optional) return 'optional';
  if (room.towel_change_required || room.linen_change_required) return 'towel';
  return 'due';
}
