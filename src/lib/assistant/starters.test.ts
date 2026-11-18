import { describe, expect, it } from "vitest";
import { rolePlaceholderExamples, starterPrompts } from "./starters";

describe("Mira role-aware onboarding", () => {
  it("offers voice/typewriter-compatible maintenance and DND workflows to authorized front office", () => {
    const examples = rolePlaceholderExamples("reception");
    expect(examples.some((text) => text.includes("room 205"))).toBe(true);
    expect(examples.some((text) => text.includes("DND photos"))).toBe(true);
    expect(examples.some((text) => /revenue dates/i.test(text))).toBe(false);
    expect(starterPrompts("reception", null, false).some((item) => item.label === "Create repair ticket")).toBe(true);
  });

  it("protects revenue prompts from general managers while surfacing them to executives", () => {
    const manager = starterPrompts("manager", null, false);
    const executive = starterPrompts("top_management", null, true);
    expect(manager.every((item) => !/revenue|pricing|rates/i.test(item.prompt))).toBe(true);
    expect(executive.some((item) => /revenue/i.test(item.prompt))).toBe(true);
    expect(rolePlaceholderExamples("manager").every((value) => !/revenue/i.test(value))).toBe(true);
  });

  it("keeps housekeeping suggestions relevant, rather than presenting a staff accusation", () => {
    const examples = rolePlaceholderExamples("housekeeping_manager");
    expect(examples.some((text) => text.includes("DND photos"))).toBe(true);
    expect(examples.some((text) => text.includes("workload"))).toBe(true);
    expect(examples.every((text) => !/slow employee|lazy housekeeper/i.test(text))).toBe(true);
  });

  it("prioritizes schedule planning for front/back office managers", () => {
    for (const role of ["reception_manager", "back_office_manager"]) {
      expect(starterPrompts(role, null, false)[0].prompt).toMatch(/next month/i);
    }
  });

  it("shows a bounded set of quick questions", () => {
    for (const role of ["admin", "top_management", "manager", "reception", "housekeeping_manager"]) {
      expect(starterPrompts(role, "housekeeping", role === "admin").length).toBeLessThanOrEqual(5);
    }
  });
});
