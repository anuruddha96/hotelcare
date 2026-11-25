import { describe, expect, it } from "vitest";
import { findDraftsToSupersede, rateDraftCellKey, type ActiveRateDraftRef } from "./rateDraftPagination";

const drafts = (count: number): ActiveRateDraftRef[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `draft-${String(i).padStart(5, "0")}`,
    stay_date: "2026-10-10",
    room_type_name: `Room ${i}`,
    occupancy: 2,
  }));

describe("bulk revenue draft supersession", () => {
  it("collects matching drafts from every page beyond the 1,000-row API cap", async () => {
    const existing = drafts(1_250);
    const incoming = new Set([rateDraftCellKey(existing[12]), rateDraftCellKey(existing[1_124])]);
    const windows: Array<[number, number]> = [];
    const ids = await findDraftsToSupersede(async (from, to) => {
      windows.push([from, to]);
      // Simulates the 1,000-result PostgREST maxRows setting.
      return { data: existing.slice(from, Math.min(to + 1, from + 1_000)), error: null };
    }, incoming);
    expect(windows).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    expect(ids).toEqual([existing[12].id, existing[1_124].id]);
  });

  it("does not treat an interrupted page read as an empty result", async () => {
    const existing = drafts(700);
    await expect(findDraftsToSupersede(async (from, to) => {
      if (from >= 500) return { data: null, error: { message: "database read timed out" } };
      return { data: existing.slice(from, to + 1), error: null };
    }, new Set([rateDraftCellKey(existing[600])]))).rejects.toMatchObject({
      message: "database read timed out",
    });
  });

  it("does not change or skip rows while enumerating the pages", async () => {
    const existing = drafts(1_001);
    const initialLength = existing.length;
    const keys = new Set(existing.map(rateDraftCellKey));
    const ids = await findDraftsToSupersede(
      async (from, to) => ({ data: existing.slice(from, to + 1), error: null }), keys,
    );
    expect(ids).toHaveLength(1_001);
    expect(existing).toHaveLength(initialLength);
    expect(new Set(ids).size).toBe(1_001);
  });

  it("rejects a page size above the PostgREST ceiling", async () => {
    await expect(findDraftsToSupersede(async () => ({ data: [], error: null }), new Set(), 2_000))
      .rejects.toThrow("Invalid active-draft page size");
  });
});
