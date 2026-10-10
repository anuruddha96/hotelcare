/** Presentation-only booking classification; financial facts always come from Previo. */
const OTA_CHANNELS = ["booking", "expedia", "agoda", "airbnb", "hotelbeds", "hrs", "trivago", "ota", "hostelworld", "despegar", "tripadvisor"];
export const isDirectChannel = (source: string | null | undefined) =>
  !OTA_CHANNELS.some((token) => (source ?? "").toLowerCase().includes(token));

export function movementRoomNights(row: { rooms: { nights: number }[] }): number {
  return row.rooms.reduce((sum, room) => sum + room.nights, 0);
}
/** Room-night-weighted ADR, not stay nights or total reservation room count. */
export function movementAdr(row: { rooms: { nights: number }[]; value: number }): number | null {
  const nights = movementRoomNights(row);
  return nights > 0 && Number.isFinite(row.value) && row.value > 0 ? row.value / nights : null;
}
export function movementGoalDelta(adr: number | null, goal: number | null): number | null {
  return adr === null || goal === null || goal <= 0 ? null : adr - goal;
}
