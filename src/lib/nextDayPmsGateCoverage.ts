/**
 * Previo's exact-date daily overview is reservation-based, so a verified
 * snapshot can legitimately contain fewer rows than the physical inventory.
 * The data layer validates freshness/authority first; this UI helper only
 * confirms that the exact rows displayed are the same rows that were verified.
 */
export function isVerifiedSparseTomorrowSnapshot(args: {
  hotelId: string;
  roomCount: number;
  verifiedRowCount: number;
  exactDayRowCount: number;
  authoritative: boolean;
}): boolean {
  return args.authoritative === true
    && !!args.hotelId
    && args.roomCount > 0
    && args.verifiedRowCount > 0
    && args.verifiedRowCount < args.roomCount
    && args.exactDayRowCount === args.verifiedRowCount;
}
