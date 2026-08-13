import { describe, expect, it } from "vitest";
import { assigneeLabel, chipStaffLabel, cleanName } from "./staffNames";

describe("chipStaffLabel", () => {
  it("shows long first names in full", () => {
    expect(chipStaffLabel("Nykipanchuk Kseniia")).toBe("Nykipanchuk");
  });

  it("survives a leading space in the stored profile name", () => {
    // Real data: Svetlana's profile is stored as " Svetlana Sobolieva".
    expect(chipStaffLabel(" Svetlana Sobolieva")).toBe("Svetlana");
  });

  it("collapses double spaces", () => {
    expect(cleanName("Anna   Maria ")).toBe("Anna Maria");
  });

  it("falls back when the name is missing", () => {
    expect(chipStaffLabel(null, "Assigned")).toBe("Assigned");
    expect(chipStaffLabel("   ", "Assigned")).toBe("Assigned");
  });
});

describe("assigneeLabel", () => {
  it("labels an assignee that is missing from the housekeeping list", () => {
    // The profile is not in staffMap (e.g. a manager who cleans, or a profile
    // filtered out by role) — the room must still look assigned.
    expect(assigneeLabel({}, "user-1")).toBe("Assigned");
  });

  it("returns null for an unassigned room", () => {
    expect(assigneeLabel({}, null)).toBeNull();
  });

  it("uses the profile name when it is known", () => {
    expect(assigneeLabel({ "user-1": " Svetlana Sobolieva" }, "user-1")).toBe("Svetlana");
  });
});
