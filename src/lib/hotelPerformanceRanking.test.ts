import { describe, expect, it } from "vitest";
import { rankHotelsByPerformance } from "./hotelPerformanceRanking";

describe("rankHotelsByPerformance", () => {
  const hotels = [
    { hotel_id: "ottofiori", occ: 84, adr: 127, revpar: 106 },
    { hotel_id: "gozsdu", occ: 89, adr: 144, revpar: 124 },
    { hotel_id: "mika", occ: 86, adr: 142, revpar: 122 },
    { hotel_id: "memories", occ: 87, adr: 131, revpar: 113 },
  ];

  it("ranks the screenshot's four hotels by combined performance, not the active hotel first", () => {
    const ranked = rankHotelsByPerformance(hotels);
    expect(ranked.map(({ hotel_id, rank }) => [hotel_id, rank])).toEqual([
      ["gozsdu", 1], ["mika", 2], ["memories", 3], ["ottofiori", 4],
    ]);
    expect(hotels[0].hotel_id).toBe("ottofiori"); // input order untouched
  });

  it("weights occupancy, ADR and RevPAR as equal ordinal positions", () => {
    const ranked = rankHotelsByPerformance([
      { hotel_id: "high-occ", occ: 98, adr: 90, revpar: 88 },
      { hotel_id: "all-round", occ: 92, adr: 145, revpar: 130 },
      { hotel_id: "high-adr", occ: 50, adr: 160, revpar: 80 },
    ]);
    expect(ranked[0].hotel_id).toBe("all-round");
    expect(ranked.map((hotel) => hotel.rank)).toEqual([1, 2, 3]);
  });

  it("breaks equal composite scores with RevPAR first", () => {
    const ranked = rankHotelsByPerformance([
      { hotel_id: "a", occ: 90, adr: 150, revpar: 100 },
      { hotel_id: "b", occ: 85, adr: 140, revpar: 110 },
    ]);
    // a leads on occupancy and ADR, b leads on RevPAR.
    expect(ranked.map((hotel) => hotel.hotel_id)).toEqual(["a", "b"]);
    const actualTie = rankHotelsByPerformance([
      { hotel_id: "a", occ: 90, adr: 100, revpar: 120 },
      { hotel_id: "b", occ: 80, adr: 110, revpar: 130 },
      { hotel_id: "c", occ: 70, adr: 90, revpar: 100 },
    ]);
    expect(actualTie.map((hotel) => hotel.hotel_id)).toEqual(["b", "a", "c"]);
  });

  it("does not award a rank for missing conversion or reconciliation data", () => {
    const ranked = rankHotelsByPerformance([
      { hotel_id: "missing-fx", occ: 97, adr: null, revpar: null },
      { hotel_id: "valid", occ: 80, adr: 120, revpar: 96 },
      { hotel_id: "missing-month", occ: null, adr: null, revpar: null },
    ]);
    expect(ranked[0]).toMatchObject({ hotel_id: "valid", rank: 1 });
    expect(ranked.slice(1).map((hotel) => hotel.rank)).toEqual([null, null]);
  });
});
