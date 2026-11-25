/**
 * Portfolio ranking uses the same full-month, EUR-converted KPIs displayed on
 * each hotel card. Each of occupancy, ADR and RevPAR contributes one equally
 * weighted ordinal position. Lowest sum of positions performs best.
 *
 * Missing/invalid metrics are never ranked as zero-performing hotels.
 * A hotel leading BOTH ADR and RevPAR always takes first place, even when
 * its occupancy rank is lower. RevPAR, ADR and occupancy break remaining ties.
 */
export type HotelPerformanceMetrics = {
  hotel_id: string;
  occ: number | null;
  adr: number | null;
  revpar: number | null;
};

export type RankedHotel<T extends HotelPerformanceMetrics> = T & {
  rank: number | null;
  rankPoints: number | null;
};

const METRICS = ["occ", "adr", "revpar"] as const;

export function rankHotelsByPerformance<T extends HotelPerformanceMetrics>(
  hotels: readonly T[],
): Array<RankedHotel<T>> {
  const eligible = hotels.filter((hotel) =>
    METRICS.every((metric) => {
      const value = hotel[metric];
      return typeof value === "number" && Number.isFinite(value) && value >= 0;
    }),
  );

  const highestAdr = Math.max(...eligible.map((hotel) => hotel.adr as number));
  const highestRevpar = Math.max(...eligible.map((hotel) => hotel.revpar as number));
  const leadsBothRevenueMetrics = (hotel: RankedHotel<T>): boolean =>
    hotel.rankPoints !== null && hotel.adr === highestAdr && hotel.revpar === highestRevpar;

  const scored: Array<RankedHotel<T>> = hotels.map((hotel) => ({
    ...hotel,
    rank: null,
    rankPoints: eligible.includes(hotel)
      ? METRICS.reduce((sum, metric) => (
          sum + 1 + eligible.filter((other) => (other[metric] as number) > (hotel[metric] as number)).length
        ), 0)
      : null,
  }));

  scored.sort((a, b) => {
    // Explicit portfolio rule: a hotel leading both key revenue KPIs is #1.
    if (leadsBothRevenueMetrics(a) !== leadsBothRevenueMetrics(b)) {
      return leadsBothRevenueMetrics(a) ? -1 : 1;
    }
    if (a.rankPoints === null) return b.rankPoints === null ? a.hotel_id.localeCompare(b.hotel_id) : 1;
    if (b.rankPoints === null) return -1;
    return a.rankPoints - b.rankPoints
      || (b.revpar as number) - (a.revpar as number)
      || (b.adr as number) - (a.adr as number)
      || (b.occ as number) - (a.occ as number)
      || a.hotel_id.localeCompare(b.hotel_id);
  });

  return scored.map((hotel, index) => ({
    ...hotel,
    rank: hotel.rankPoints === null ? null : index + 1,
  }));
}
