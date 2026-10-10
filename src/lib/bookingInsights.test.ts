import { describe, it, expect } from "vitest";
import { bookingChangePct, observedCohortIncidence, scheduledLosCoverage, fmtPct } from "./bookingInsights";
describe("Previo booking-insights metrics", () => {
  it("keeps same-window event counts separate from observed cohort incidence", () => {
    expect(observedCohortIncidence({booked_reservations: 100, ever_had_cancelled_nights: 12})).toBe(12);
    expect(observedCohortIncidence({booked_reservations: 0, ever_had_cancelled_nights: 0})).toBeNull();
  });
  it("does not report missing prior history as zero-percent growth", () => {
    expect(bookingChangePct(15,0)).toBeNull();
    expect(bookingChangePct(30,20)).toBe(50);
    expect(bookingChangePct(5,20)).toBe(-75);
  });
  it("shows missing full-stay LOS coverage rather than fabricating it", () => {
    const s={ booked_room_items: 120,known_los_items: 90 } as Parameters<typeof scheduledLosCoverage>[0];
    expect(scheduledLosCoverage(s)).toBe(75);
    expect(scheduledLosCoverage({...s,booked_room_items:0})).toBeNull();
    expect(fmtPct(null)).toBe("—");
  });
});
