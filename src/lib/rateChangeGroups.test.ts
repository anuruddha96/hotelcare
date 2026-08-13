import { describe, it, expect } from "vitest";
import { classifyDraft, groupCellChanges } from "@/lib/rateChangeGroups";
import type { RateAuditRow } from "@/lib/rateAudit";

const NOW = Date.parse("2026-08-13T20:00:00Z");

const audit = (o: Partial<RateAuditRow>): RateAuditRow => ({
  id: Math.random().toString(36).slice(2),
  stay_date: "2026-09-29",
  action: "price",
  source: "day-tool",
  old_rate_eur: 165,
  new_rate_eur: 163,
  delta_eur: -2,
  notes: null,
  performed_at: "2026-08-13T11:27:26Z",
  performed_by: "u1",
  payload: { room_type_name: "Deluxe Queen Room", occupancy: 1 },
  ...o,
});

describe("classifyDraft", () => {
  it("treats a plain fresh draft as unsent", () => {
    expect(classifyDraft({ new_price: 161, status: "draft", created_at: "2026-08-13T19:55:00Z" }, NOW)).toBe("unsent");
  });
  it("treats a failed draft as history", () => {
    expect(classifyDraft({ new_price: 161, status: "failed", created_at: "2026-08-13T19:55:00Z" }, NOW)).toBe("terminal");
  });
  it("treats a confirmed push as history", () => {
    expect(classifyDraft({ new_price: 163, status: "pushed", confirmation_status: "confirmed" }, NOW)).toBe("terminal");
  });
  it("keeps a fresh in-flight push separate from an unsent draft", () => {
    expect(classifyDraft({ new_price: 163, status: "pushed", confirmation_status: "sending", updated_at: "2026-08-13T19:50:00Z" }, NOW)).toBe("inflight");
  });
  it("retires a draft the publisher claimed hours ago", () => {
    // The real Ottofiori row: status=draft, confirmation_status=sending, 14:27.
    expect(classifyDraft({ new_price: 161, status: "draft", confirmation_status: "sending", created_at: "2026-08-13T14:27:26Z", updated_at: "2026-08-13T14:27:26Z" }, NOW)).toBe("terminal");
  });
});

describe("groupCellChanges", () => {
  const names = new Map([["u1", "Nuwan"]]);

  it("folds draft → push → confirmed into one change with the final status", () => {
    const rows = [
      audit({ id: "a", source: "day-tool", performed_at: "2026-08-13T11:27:26Z" }),
      audit({ id: "b", source: "push", performed_at: "2026-08-13T11:27:30Z", payload: { room_type_name: "Deluxe Queen Room", occupancy: 1, draft_id: "d1" } as never }),
      audit({ id: "c", source: "previo_confirmed", performed_at: "2026-08-13T11:28:50Z", payload: { room_type_name: "Deluxe Queen Room", occupancy: 1, confirmation_status: "confirmed", requested_price: 163, actual_previo_price: 163, push_run_id: "p1" } }),
    ];
    const groups = groupCellChanges(rows, [], names);
    expect(groups).toHaveLength(1);
    expect(groups[0].phase).toBe("confirmed");
    expect(groups[0].stages).toBe(3);
    expect(groups[0].old).toBe(165);
    expect(groups[0].next).toBe(163);
    expect(groups[0].who).toBe("Nuwan");
  });

  it("keeps two edits to the same price hours apart separate", () => {
    const rows = [
      audit({ id: "a", source: "bulk-editor", new_rate_eur: 161, performed_at: "2026-08-13T12:14:52Z" }),
      audit({ id: "b", source: "bulk-editor", new_rate_eur: 161, performed_at: "2026-08-13T14:27:26Z" }),
    ];
    expect(groupCellChanges(rows, [], names)).toHaveLength(2);
  });

  it("reports a refused automation attempt as failed, not waiting", () => {
    const groups = groupCellChanges([], [{
      id: "x", stay_date: "2026-09-29", room_type_name: "Deluxe Queen Room", occupancy: 1,
      old_price: 168, new_price: 186, increase_amount: 18, pickup_sequence: 1,
      reservation_id: "114427661", pickup_at: null, status: "failed", created_at: "2026-08-12T07:45:03Z",
    }], names);
    expect(groups[0].phase).toBe("failed");
    expect(groups[0].automation).toBe(true);
  });
});
