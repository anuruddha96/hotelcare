import { describe, it, expect } from "vitest";
import { errorMessage } from "@/lib/errorMessage";

describe("errorMessage", () => {
  it("never renders [object Object]", () => {
    expect(errorMessage({ code: "23505", details: null })).not.toContain("[object Object]");
    expect(errorMessage({})).toBe("Something went wrong. Please try again.");
    expect(errorMessage("[object Object]")).toBe("Something went wrong. Please try again.");
  });

  it("prefers the human sentence a function returns", () => {
    expect(errorMessage({ msg: "Another hotel is being evaluated", error: "busy" }))
      .toBe("Another hotel is being evaluated");
    expect(errorMessage(new Error("Previo reservation refresh failed")))
      .toBe("Previo reservation refresh failed");
    expect(errorMessage({ error: { message: "boom" } })).toBe("boom");
  });
});
