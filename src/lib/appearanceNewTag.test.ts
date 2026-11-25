import { describe, expect, it } from "vitest";
import { APPEARANCE_TAG_START, APPEARANCE_TAG_END, isAppearanceTagActive } from "./appearanceNewTag";

describe("appearance new tag", () => {
  it("appears for exactly one week in Budapest local time", () => {
    expect(APPEARANCE_TAG_END - APPEARANCE_TAG_START).toBe(7 * 24 * 60 * 60 * 1000);
    expect(isAppearanceTagActive(APPEARANCE_TAG_START - 1)).toBe(false);
    expect(isAppearanceTagActive(APPEARANCE_TAG_START)).toBe(true);
    expect(isAppearanceTagActive(APPEARANCE_TAG_END - 1)).toBe(true);
    expect(isAppearanceTagActive(APPEARANCE_TAG_END)).toBe(false);
    expect(isAppearanceTagActive(Date.parse("2027-11-25T12:00:00Z"))).toBe(false);
  });
});
