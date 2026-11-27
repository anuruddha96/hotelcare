import { describe, expect, it } from "vitest";
import { christmasGiftDay, christmasGiftEligibility, christmasGiftStorageKey, getChristmasGiftCopy, christmasGiftCopy } from "./christmasGift";

describe("Christmas 2026 gift", () => {
  const at = (iso: string) => new Date(iso);
  it("starts the exact rehearsal account at Budapest midnight on November 28", () => {
    expect(christmasGiftEligibility("anuruddha_000", at("2026-11-27T22:59:59Z"))).toBeNull();
    expect(christmasGiftEligibility("anuruddha_000", at("2026-11-27T23:00:00Z"))).toBe("2026-11-28");
    expect(christmasGiftEligibility("anu_000", at("2026-11-28T07:00:00Z"))).toBeNull();
    expect(christmasGiftEligibility("other", at("2026-12-24T12:00:00Z"))).toBeNull();
  });
  it("allows all signed-in profiles on Christmas Day only", () => {
    for (const nickname of ["other", "anuruddha_000", undefined]) {
      expect(christmasGiftEligibility(nickname, at("2026-12-24T23:00:00Z"))).toBe("2026-12-25");
      expect(christmasGiftEligibility(nickname, at("2026-12-25T22:59:59Z"))).toBe("2026-12-25");
      expect(christmasGiftEligibility(nickname, at("2026-12-25T23:00:00Z"))).toBeNull();
      expect(christmasGiftEligibility(nickname, at("2027-12-25T08:00:00Z"))).toBeNull();
    }
  });
  it("uses a separate dismissal key per account and Budapest calendar day", () => {
    expect(christmasGiftDay(at("2026-11-28T23:01:00Z"))).toBe("2026-11-29");
    expect(christmasGiftStorageKey("a", "2026-11-28")).not.toBe(christmasGiftStorageKey("b", "2026-11-28"));
    expect(christmasGiftStorageKey("a", "2026-11-28")).not.toBe(christmasGiftStorageKey("a", "2026-11-29"));
  });
  it("has complete localized copy for all nine interface languages", () => {
    const languages = ["en","hu","es","vi","mn","az","tl","uk","ru"];
    expect(Object.keys(christmasGiftCopy).sort()).toEqual(languages.sort());
    for (const language of languages) {
      expect(Object.values(getChristmasGiftCopy(language)).every(Boolean)).toBe(true);
      if (language !== "en") expect(getChristmasGiftCopy(language).note).not.toBe(christmasGiftCopy.en.note);
    }
    expect(getChristmasGiftCopy("hu-HU")).toBe(christmasGiftCopy.hu);
    expect(getChristmasGiftCopy("unknown")).toBe(christmasGiftCopy.en);
  });
});
