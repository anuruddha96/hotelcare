import { GOZSDU_COURT_HOTEL_ID } from './gozsdu-housekeeping';

const MIKA_DOWNTOWN_HOTEL_ID = 'mika-downtown';

/**
 * The planner's data layer has already validated the complete previous-day
 * roster and every omission for these two properties. Do not reintroduce a
 * blanket room-count requirement in the UI after that validation succeeds.
 * A changed or incomplete exact-date dataset must still fail closed.
 */
export function isVerifiedSparseTomorrowSnapshot(args: {
  hotelId: string;
  roomCount: number;
  verifiedRowCount: number;
  exactDayRowCount: number;
  authoritative: boolean;
}): boolean {
  return (args.hotelId === GOZSDU_COURT_HOTEL_ID || args.hotelId === MIKA_DOWNTOWN_HOTEL_ID)
    && args.authoritative === true
    && args.roomCount > 0
    && args.verifiedRowCount > 0
    && args.verifiedRowCount < args.roomCount
    && args.exactDayRowCount === args.verifiedRowCount;
}
