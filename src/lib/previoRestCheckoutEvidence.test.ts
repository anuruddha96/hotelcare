import { describe, expect, it } from "vitest";
import { verifiedGozsduRestCheckouts } from "../../supabase/functions/_shared/previoRestCheckoutEvidence";
const d = "2026-09-23";
const roster = new Map([[1856755, "1BBALC-3002"]]);
const mapped = new Set([1856755]);
const old = { roomId: 1856755, roomName: "1BBALC-3002", arrivalDate: "2026-09-20", departureDate: d, statusId: 3, reservationId: "outgoing" };
const incoming = { roomId: 1856755, roomName: "1BBALC-3002", arrivalDate: d, departureDate: "2026-09-27", statusId: 2, reservationId: "incoming" };
const verify = (records: unknown[], occupied = new Set<number>()) =>
  verifiedGozsduRestCheckouts({ reservations: records }, d, roster, mapped, occupied);
describe("Gozsdu checkout reconciliation with Previo REST", () => {
  it("does not mistake the Previo cleaning table's scheduled 09:49 departure and 15:00 arrival for actual check-out", () => {
    expect(verify([{ ...old, departureTime: "09:49" }, incoming]).checkouts).toEqual([]);
  });
  it("releases only a physically mapped same-day reservation with completed checkout status", () => {
    expect(verify([incoming, { ...old, statusId: 6 }]).checkouts)
      .toEqual([{objId: 1856755,roomName:"1BBALC-3002",reservationId:"outgoing"}]);
  });
  it("accepts an explicit actual check-out timestamp even if status is cached, but never a scheduled time", () => {
    expect(verify([{...old, checkedOutAt: "2026-09-23T09:49:00+02:00"}]).checkouts).toHaveLength(1);
    expect(verify([{...old, departureTime: "2026-09-23T09:49:00+02:00"}]).checkouts).toHaveLength(0);
  });
  it("preserves extensions, future departures, unknown IDs and mismatched names", () => {
    expect(verify([{...old, statusId:6}],new Set([1856755])).checkouts).toHaveLength(0);
    expect(verify([{...old, departureDate:"2026-09-24", statusId:6}]).checkouts).toHaveLength(0);
    expect(verify([{...old,roomId:999,statusId:6}]).checkouts).toHaveLength(0);
    expect(verify([{...old,roomName:"OTHER-3002",statusId:6}]).checkouts).toHaveLength(0);
  });
  it("does not apply multiroom booking-wide checkout to an individual apartment", () => {
    expect(verify([{...old,statusId:6,rooms:[{roomId:1856755},{roomId:1856763}]}]).checkouts).toHaveLength(0);
  });
});
