import { describe, expect, it } from "vitest";
import {
  addDays, bookingWhen, facilityLabel, fillWord, firstUsefulDay, freeSlots, hotelDayLabel, hotelTime, hotelToday,
  priceLabel, slotRange, wellnessWords, WELLNESS_WORDS, type WellnessResource,
} from "./wellness";

describe("hotel-time formatting", () => {
  it("shows Budapest time whatever the browser zone", () => {
    expect(hotelTime("2026-11-18T09:00:00Z")).toBe("10:00"); // CET, UTC+1
    expect(hotelTime("2026-07-18T08:00:00Z")).toBe("10:00"); // CEST, UTC+2
    expect(slotRange("2026-11-18T09:00:00Z", "2026-11-18T10:00:00Z")).toBe("10:00–11:00");
  });

  it("handles the spring DST change", () => {
    // 29 March 2026: clocks jump 02:00 -> 03:00 in Budapest.
    expect(hotelTime("2026-03-29T00:30:00Z")).toBe("01:30");
    expect(hotelTime("2026-03-29T01:30:00Z")).toBe("03:30");
  });

  it("labels hotel dates without drifting a day", () => {
    expect(hotelDayLabel("2026-11-18")).toBe("Wed 18 Nov");
    expect(hotelDayLabel("2026-11-18", "hu-HU")).toMatch(/nov/i);
    expect(bookingWhen("2026-11-18T22:30:00Z", "2026-11-18T23:30:00Z")).toBe("Wed 18 Nov, 23:30–00:30");
  });

  it("knows the hotel's today and adds days across month ends", () => {
    expect(hotelToday(new Date("2026-11-17T23:30:00Z"))).toBe("2026-11-18");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
  });
});

const resource = (days: WellnessResource["days"]): WellnessResource => ({
  id: "r1", kind: "jacuzzi", name: "Jacuzzi", description: "", image_url: null, slot_minutes: 60, max_guests: 2,
  opens_at: "09:00", closes_at: "21:00", weekdays: [1, 2, 3, 4, 5, 6, 7], max_per_day: 1, price: 0, currency: "HUF",
  is_active: true, sort_order: 1, days,
});

describe("slot helpers", () => {
  it("picks the first day that still has a free slot", () => {
    const r = resource([
      { date: "2026-11-18", open: true, slots: [{ starts_at: "a", ends_at: "b", status: "booked" }] },
      { date: "2026-11-19", open: true, slots: [{ starts_at: "c", ends_at: "d", status: "free" }] },
    ]);
    expect(firstUsefulDay(r)).toBe("2026-11-19");
    expect(freeSlots(r.days![1])).toHaveLength(1);
    expect(firstUsefulDay(resource([{ date: "2026-11-18", open: false, slots: [] }]))).toBe("2026-11-18");
    expect(firstUsefulDay(resource([]))).toBeNull();
  });

  it("shows free facilities as free, not as zero money", () => {
    expect(priceLabel(0, "HUF", "Free")).toBe("Free");
    expect(priceLabel(15000, "HUF", "Free")).toMatch(/15/);
  });
});

describe("words", () => {
  it("has every phrase in all six languages", () => {
    const keys = Object.keys(WELLNESS_WORDS.en).sort();
    for (const words of Object.values(WELLNESS_WORDS)) expect(Object.keys(words).sort()).toEqual(keys);
  });

  it("falls back to English and fills placeholders", () => {
    expect(wellnessWords("xx").title).toBe("Jacuzzi & sauna");
    expect(fillWord(wellnessWords("en").upTo, { n: 2 })).toBe("Up to 2 guests");
    expect(facilityLabel("jacuzzi", "de")).toBe("Whirlpool");
    expect(facilityLabel("sauna", "hu")).toBe("Szauna");
  });
});
