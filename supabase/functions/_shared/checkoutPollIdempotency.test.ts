import { describe, expect, it } from "vitest";
import { needsCheckoutRoomWrite, checkoutAssignmentsNeedingRelease } from "./checkoutPollIdempotency";

const confirmed = {
  is_checkout_room: true,
  checkout_time: "2026-10-09T08:00:00.000Z",
  pms_metadata: {
    checkedOutToday: true,
    readyToClean: true,
    checkedOutAt: "2026-10-09T07:59:00.000Z",
    reservationId: "r-123",
  },
};
describe("Previo checkout poll idempotency", () => {
  it("does not refresh timestamps or WAL for an already verified same-day checkout", () => {
    expect(needsCheckoutRoomWrite(confirmed, "2026-10-09", "r-123")).toBe(false);
  });
  it("does not re-dirty a room cleaned after its verified checkout", () => {
    expect(needsCheckoutRoomWrite(confirmed, "2026-10-09", "r-123")).toBe(false);
  });
  it("does persist an initial physical checkout", () => {
    expect(needsCheckoutRoomWrite({...confirmed,is_checkout_room:false}, "2026-10-09", "r-123")).toBe(true);
  });
  it("does persist incomplete checkout metadata or missing checkout time", () => {
    expect(needsCheckoutRoomWrite({...confirmed,checkout_time:null}, "2026-10-09", "r-123")).toBe(true);
    expect(needsCheckoutRoomWrite({...confirmed,pms_metadata:{readyToClean:false}}, "2026-10-09", "r-123")).toBe(true);
  });
  it("does persist a new day's departure and new reservation turnover", () => {
    expect(needsCheckoutRoomWrite(confirmed, "2026-10-10", "r-123")).toBe(true);
    expect(needsCheckoutRoomWrite(confirmed, "2026-10-09", "r-456")).toBe(true);
  });
  it("uses Budapest business day around midnight UTC", () => {
    const sameBudapestDay = {...confirmed,pms_metadata:{...confirmed.pms_metadata,checkedOutAt:"2026-10-08T23:30:00Z"}};
    expect(needsCheckoutRoomWrite(sameBudapestDay,"2026-10-09","r-123")).toBe(false);
  });
  it("updates only held/not-yet-RTC assignments", () => {
    const base = {assignment_type:"checkout_cleaning",ready_to_clean:true,pms_hold:false,pms_hold_reason:null,pms_hold_event_id:null};
    expect(checkoutAssignmentsNeedingRelease([
      {id:"ready",...base}, {id:"pending",...base,ready_to_clean:false},
      {id:"held",...base,pms_hold:true}, {id:"daily",...base,assignment_type:"daily_cleaning"},
    ])).toEqual(["pending","held"]);
  });
});
