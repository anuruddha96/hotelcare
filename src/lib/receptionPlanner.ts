// Pure planner layout: one lane per simultaneously occupied physical room.
// Checkout is exclusive, so a checkout and check-in on the same date do not conflict.
export interface PlannerStay {
  id: string;
  check_in_date: string;
  check_out_date: string;
}

export interface PositionedStay<T extends PlannerStay> {
  reservation: T;
  lane: number;
  overlaps: boolean;
}

export function layoutRoomStays<T extends PlannerStay>(stays: T[]): PositionedStay<T>[] {
  const sorted = stays
    .filter((stay) => Boolean(stay.check_in_date && stay.check_out_date && stay.check_out_date > stay.check_in_date))
    .slice()
    .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date) || a.check_out_date.localeCompare(b.check_out_date) || a.id.localeCompare(b.id));

  const laneEnds: string[] = [];
  const positioned: PositionedStay<T>[] = [];
  for (const reservation of sorted) {
    const lane = laneEnds.findIndex((end) => end <= reservation.check_in_date);
    const chosenLane = lane === -1 ? laneEnds.length : lane;
    const overlaps = laneEnds.some((end) => end > reservation.check_in_date);
    laneEnds[chosenLane] = reservation.check_out_date;
    positioned.push({ reservation, lane: chosenLane, overlaps });
  }
  return positioned;
}

export function getRoomLaneCount(stays: PositionedStay<PlannerStay>[]): number {
  return Math.max(1, ...stays.map((stay) => stay.lane + 1));
}
