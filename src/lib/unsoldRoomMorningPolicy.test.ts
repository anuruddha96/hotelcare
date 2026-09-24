import { describe, expect, it } from "vitest";
import { classifyUnsoldRoomAfterMorningPms } from "../../supabase/functions/_shared/housekeepingServicePolicy";

describe("unsold room morning housekeeping policy", () => {
  it("turns a late one-night booking into checkout cleaning", () => {
    const result = classifyUnsoldRoomAfterMorningPms({
      hotelId: "gozsdu-court",
      planDate: "2026-09-25",
      kind: "checkout",
      arrivalDate: "2026-09-24",
      departureDate: "2026-09-25",
    });
    expect(result).toMatchObject({
      eligible: true,
      assignmentType: "checkout_cleaning",
      service: "checkout",
    });
  });

  it("applies Gozsdu towel and textile-change rules to late multi-night bookings", () => {
    const towel = classifyUnsoldRoomAfterMorningPms({
      hotelId: "gozsdu-court",
      planDate: "2026-09-26",
      kind: "daily",
      arrivalDate: "2026-09-24",
      departureDate: "2026-09-30",
    });
    expect(towel).toMatchObject({
      eligible: true,
      towelChangeRequired: true,
      linenChangeRequired: false,
      service: "towel_change",
    });

    const change = classifyUnsoldRoomAfterMorningPms({
      hotelId: "gozsdu-court",
      planDate: "2026-09-28",
      kind: "daily",
      arrivalDate: "2026-09-24",
      departureDate: "2026-10-02",
    });
    expect(change).toMatchObject({
      eligible: true,
      towelChangeRequired: false,
      linenChangeRequired: true,
      service: "change_room",
    });
  });

  it("does not release a Gozsdu stay-over when that day has no service due", () => {
    const result = classifyUnsoldRoomAfterMorningPms({
      hotelId: "gozsdu-court",
      planDate: "2026-09-25",
      kind: "daily",
      arrivalDate: "2026-09-24",
      departureDate: "2026-09-29",
    });
    expect(result).toMatchObject({
      eligible: false,
      service: "none",
      reason: "gozsdu_no_service_due",
    });
  });

  it("uses Hotel Memories configured service cycle for a late multi-night booking", () => {
    const result = classifyUnsoldRoomAfterMorningPms({
      hotelId: "memories-budapest",
      planDate: "2026-09-26",
      kind: "daily",
      arrivalDate: "2026-09-24",
      departureDate: "2026-09-30",
      settings: {
        memories_service_cycle: {
          enabled: true,
          towel_first_night: 3,
          towel_repeat_nights: 4,
          change_first_night: 5,
          change_repeat_nights: 5,
          final_night_towel_only: true,
        },
      },
    });
    expect(result).toMatchObject({
      eligible: true,
      assignmentType: "daily_cleaning",
      towelChangeRequired: true,
      linenChangeRequired: false,
      service: "towel_change",
    });
  });

  it("keeps a generic/SLNT late multi-night booking as standard daily work", () => {
    const result = classifyUnsoldRoomAfterMorningPms({
      hotelId: "slnt-group",
      planDate: "2026-09-25",
      kind: "daily",
      arrivalDate: "2026-09-24",
      departureDate: "2026-09-28",
      settings: {},
    });
    expect(result).toMatchObject({
      eligible: true,
      assignmentType: "daily_cleaning",
      towelChangeRequired: false,
      linenChangeRequired: false,
      service: "daily",
    });
  });

  it("supports a future commercial property service-cycle configuration without hard-coding the hotel", () => {
    const result = classifyUnsoldRoomAfterMorningPms({
      hotelId: "future-hotel",
      planDate: "2026-09-26",
      kind: "daily",
      arrivalDate: "2026-09-24",
      departureDate: "2026-10-01",
      settings: {
        housekeeping_service_cycle: {
          enabled: true,
          towel_first_night: 3,
          towel_repeat_nights: 2,
          change_first_night: 5,
          change_repeat_nights: 4,
          final_night_towel_only: true,
        },
      },
    });
    expect(result).toMatchObject({
      eligible: true,
      service: "towel_change",
      towelChangeRequired: true,
      linenChangeRequired: false,
    });
  });
});
