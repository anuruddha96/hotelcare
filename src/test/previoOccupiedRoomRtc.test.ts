import { describe, expect, it } from "vitest";
import {
  xmlInHouseDepartureRoomId,
  hasXmlInHouseConflict,
  clearedCheckoutMetadata,
} from "../../supabase/functions/_shared/checkoutPollIdempotency";

const today = "2026-11-24";
const block = "<reservation><statusId>3</statusId><to>2026-11-24</to><object><objId>2301949</objId><name>Q-101</name></object></reservation>";

describe("Previo same-day occupied checkout reconciliation", () => {
  it("uses explicit XML in-house evidence even without a REST reservation", () => {
    expect(xmlInHouseDepartureRoomId(block, today, "3", today)).toBe(2301949);
  });

  it("never treats an actual checkout, cancellation, waiting list or missing status as in-house", () => {
    for (const status of ["9", "7", "6", "8", "2", ""]) {
      expect(xmlInHouseDepartureRoomId(block, today, status, today)).toBeNull();
    }
  });

  it("requires today's departure and a valid physical room ID", () => {
    expect(xmlInHouseDepartureRoomId(block, "2026-11-23", "3", today)).toBeNull();
    expect(xmlInHouseDepartureRoomId("<object><name>Q-101</name></object>", today, "3", today)).toBeNull();
    expect(xmlInHouseDepartureRoomId("<object><objId>0</objId></object>", today, "3", today)).toBeNull();
  });

  it("blocks contradictory checkout for 101 without blocking real checkout for 203", () => {
    const ids = new Set([2301949]);
    expect(hasXmlInHouseConflict("2301949", ids)).toBe(true);
    expect(hasXmlInHouseConflict(2301967, ids)).toBe(false);
    expect(hasXmlInHouseConflict(null, ids)).toBe(false);
    expect(hasXmlInHouseConflict(2301949, new Set())).toBe(false);
  });

  it("clears every stale RTC marker but preserves the checkout bucket and other room metadata", () => {
    const prior = {
      roomId: 2301949, reservationId: "118195777",
      checkedOutToday: true, readyToClean: true,
      checkedOutAt: "2026-11-24T03:55:02.768Z",
      readyToCleanDate: today, scheduledDepartureToday: true,
      arrivalToday: true,
    };
    expect(clearedCheckoutMetadata(prior)).toEqual({
      ...prior, checkedOutToday: false, readyToClean: false,
      checkedOutAt: null, readyToCleanDate: null,
    });
    expect(prior.readyToClean).toBe(true);
  });
});
