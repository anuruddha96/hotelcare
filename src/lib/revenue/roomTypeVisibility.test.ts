import { describe, expect, it } from "vitest";
import { activePricingRoomTypes, isTechnicalRoomKind } from "./roomTypeVisibility";

const studio = { pms_room_id: "817111", num_rooms: 2, is_sellable: true, counts_toward_inventory: true };
const triple = { pms_room_id: "817073", num_rooms: 0, is_sellable: true, counts_toward_inventory: true };
const newDoubleTwin = { pms_room_id: "1011049", num_rooms: 6, is_sellable: true, counts_toward_inventory: true };

describe("Previo active pricing room type visibility", () => {
  it("hides each SLNT Technikai/Technical Room even when PMS flags it as sellable", () => {
    const technical = Array.from({ length: 5 }, (_, i) => ({
      name: "Technikai", pms_room_id: `783103:${1002791 + i * 2}`,
      num_rooms: 1, is_sellable: true, counts_toward_inventory: true,
    }));
    const stay = { ...studio, name: "Elisabeth Downtown Studio" };
    expect(activePricingRoomTypes([...technical, stay])).toEqual([stay]);
    expect(isTechnicalRoomKind("Technical Room")).toBe(true);
    expect(isTechnicalRoomKind("Technikai Szoba")).toBe(true);
    expect(isTechnicalRoomKind("  technikai  ")).toBe(true);
    expect(isTechnicalRoomKind("Technical Suite")).toBe(false);
    expect(isTechnicalRoomKind("Technical Room View Apartment")).toBe(false);
  });
  it("hides a physically empty Deluxe Triple category and keeps the newly added 2+1 category", () => {
    expect(activePricingRoomTypes([studio, triple, newDoubleTwin])).toEqual([studio, newDoubleTwin]);
  });
  it("keeps room types with physical inventory even if all dates are sold out", () => {
    // Availability is deliberately NOT an input: 0 rooms left on a date ≠ 0 physical rooms.
    expect(activePricingRoomTypes([newDoubleTwin])).toEqual([newDoubleTwin]);
  });
  it("shows new physical room types even before prices are configured", () => {
    expect(activePricingRoomTypes([{ ...newDoubleTwin, noRatePlanYet: true }])).toHaveLength(1);
  });
  it("excludes non-room products, duplicated PMS inventory groups and unmapped drafts", () => {
    expect(activePricingRoomTypes([
      { pms_room_id: "breakfast", num_rooms: 1, is_sellable: false },
      { pms_room_id: "group-2", num_rooms: 6, counts_toward_inventory: false },
      { pms_room_id: null, num_rooms: 2 },
    ])).toHaveLength(0);
  });
});
