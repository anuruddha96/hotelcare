import { describe, expect, it } from "vitest";
import { breakfastAuthUrl, breakfastReturnPathFromSearch, safeBreakfastReturnPath } from "./breakfastAuth";

describe("breakfast auth return paths", () => {
  it("preserves valid BV destinations", () => {
    expect(safeBreakfastReturnPath("/bb/org/rdhotels?tab=rooms")).toBe("/bb/org/rdhotels?tab=rooms");
    expect(breakfastAuthUrl("/bb/mika-code")).toBe("/bb/auth?returnTo=%2Fbb%2Fmika-code");
    expect(breakfastReturnPathFromSearch("?returnTo=%2Fbb%2Forg%2Frdhotels")).toBe("/bb/org/rdhotels");
  });

  it("rejects external, malformed, and recursive auth destinations", () => {
    expect(safeBreakfastReturnPath("https://example.com/bb")).toBe("/bb");
    expect(safeBreakfastReturnPath("//example.com/bb")).toBe("/bb");
    expect(safeBreakfastReturnPath("/bb-malicious")).toBe("/bb");
    expect(safeBreakfastReturnPath("/bb/auth?returnTo=/bb/auth")).toBe("/bb");
  });
});
