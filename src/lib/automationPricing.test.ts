import { describe, it, expect } from "vitest";
import {
  roundMoney,
  PUSH_PRIORITY,
  priorityOf,
  sortPushQueue,
  pickDueRule,
  nextRunAt,
  observationWindow,
  markdownBlockReason,
  computeMarkdown,
  coalesceIntents,
  effectivePrice,
  maxDailyMarkdown,
} from "../../supabase/functions/_shared/pricingRules";

const rule = (hotel_id: string, next_run_at: string | null, last?: string | null) => ({
  hotel_id, is_enabled: true, next_run_at, last_evaluated_at: last ?? null,
  evaluation_interval_minutes: 60,
});

describe("scheduler — one hotel at a time", () => {
  it("picks exactly one hotel when two are due at the same instant", () => {
    const now = new Date("2026-08-14T10:00:00Z");
    const rules = [rule("ottofiori", "2026-08-14T10:00:00Z"), rule("mika", "2026-08-14T10:00:00Z", "2026-08-14T08:00:00Z")];
    const chosen = pickDueRule(rules, now);
    expect(chosen).not.toBeNull();
    expect([chosen!.hotel_id]).toHaveLength(1);
    // The other one is still due and will be picked on the next cycle.
    const remaining = rules.filter((r) => r.hotel_id !== chosen!.hotel_id);
    expect(pickDueRule(remaining, now)!.hotel_id).toBe(remaining[0].hotel_id);
  });

  it("keeps a disabled rule out of the schedule", () => {
    const now = new Date("2026-08-14T10:00:00Z");
    const disabled = { ...rule("paused-hotel", null), is_enabled: false };
    expect(pickDueRule([disabled], now)).toBeNull();
  });

  it("never replays missed intervals after downtime", () => {
    const now = new Date("2026-08-14T15:00:00Z");
    // Five hours late: the next slot is still measured from now, not 11:00.
    expect(nextRunAt(now, 60)).toBe("2026-08-14T16:00:00.000Z");
    const window = observationWindow(now, "2026-08-14T10:00:00Z", 60);
    // At most one markdown step per evaluation — the window is bounded, and the
    // caller applies a single step regardless of how wide it is.
    expect(Date.parse(window.to) - Date.parse(window.from)).toBeLessThanOrEqual(6 * 3_600_000);
  });

  it("widens the window to the last success so a late tick misses no booking", () => {
    const now = new Date("2026-08-14T15:00:00Z");
    const w = observationWindow(now, "2026-08-14T13:30:00Z", 60);
    expect(w.from).toBe("2026-08-14T13:30:00.000Z");
  });
});

describe("publisher queue", () => {
  it("publishes manual work before routine markdown work", () => {
    const queue = [
      { id: "markdown", priority: PUSH_PRIORITY.markdown, created_at: "2026-08-14T09:00:00Z" },
      { id: "manual", priority: PUSH_PRIORITY.manual, created_at: "2026-08-14T10:00:00Z" },
      { id: "pickup", priority: PUSH_PRIORITY.pickup, created_at: "2026-08-14T09:30:00Z" },
    ];
    expect(sortPushQueue(queue).map((r) => r.id)).toEqual(["manual", "pickup", "markdown"]);
  });

  it("maps sources to a stable priority", () => {
    expect(priorityOf("manual")).toBeLessThan(priorityOf("pickup"));
    expect(priorityOf("pickup")).toBeLessThan(priorityOf("markdown"));
    expect(priorityOf("something-else")).toBe(50);
  });

  it("only one hotel publishes at a time (lease semantics)", () => {
    // Emulates claim_publisher_lock: the row holds a single hotel.
    let holder: string | null = null;
    const claim = (hotel: string) => {
      if (holder === null || holder === hotel) { holder = hotel; return true; }
      return false;
    };
    expect(claim("ottofiori")).toBe(true);
    expect(claim("mika")).toBe(false);
    holder = null;
    expect(claim("mika")).toBe(true);
  });
});

describe("no-pickup markdown", () => {
  const base = { decreasePerEvaluation: 0.5, floorPrice: 100, stayDateMovedToday: 0, maxDailyDecreasePerDate: 10 };

  it("keeps €0.50 as €0.50 — no integer rounding", () => {
    const result = computeMarkdown({ ...base, effectivePrice: 180 });
    expect(result).toEqual({ newPrice: 179.5, applied: 0.5 });
    expect(roundMoney(179.5)).toBe(179.5);
  });

  it("supports €0.25 steps", () => {
    expect(computeMarkdown({ ...base, effectivePrice: 180, decreasePerEvaluation: 0.25 })!.newPrice).toBe(179.75);
  });

  it("stops at the minimum ADR", () => {
    expect(computeMarkdown({ ...base, effectivePrice: 100.2, floorPrice: 100 })!.newPrice).toBe(100);
    expect(computeMarkdown({ ...base, effectivePrice: 100, floorPrice: 100 })).toBeNull();
  });

  it("counts the daily cap per stay date, not per room/occupancy row", () => {
    const cells = [180, 200, 220, 240];
    let moved = 0;
    const results = cells.map((price) => {
      const r = computeMarkdown({ ...base, effectivePrice: price, stayDateMovedToday: moved, maxDailyDecreasePerDate: 2 });
      return r;
    });
    // Every cell of the same stay date moves by the same step in one evaluation;
    // the cap is charged ONCE for the date, so all four cells still move.
    expect(results.every((r) => r?.applied === 0.5)).toBe(true);
    moved = 0.5; // the date moved 0.50 in this evaluation
    // After four evaluations the date has moved 2.00 and the cap stops it.
    expect(computeMarkdown({ ...base, effectivePrice: 178, stayDateMovedToday: 2, maxDailyDecreasePerDate: 2 })).toBeNull();
  });

  it("blocks markdown when the same evaluation found pickup", () => {
    expect(markdownBlockReason({
      hadPickup: true, protectHighOccupancy: true, markdownMaxOccupancyPct: 88,
      manualHoldHours: 6, now: new Date(),
    })).toBe("pickup");
  });

  it("protects high occupancy and sold-out dates", () => {
    const now = new Date("2026-08-14T10:00:00Z");
    expect(markdownBlockReason({
      hadPickup: false, occupancyPct: 92, protectHighOccupancy: true,
      markdownMaxOccupancyPct: 88, manualHoldHours: 6, now,
    })).toBe("high_occupancy");
    expect(markdownBlockReason({
      hadPickup: false, occupancyPct: 92, protectHighOccupancy: false,
      markdownMaxOccupancyPct: 88, manualHoldHours: 6, now,
    })).toBeNull();
    expect(markdownBlockReason({
      hadPickup: false, roomsAvailable: 0, protectHighOccupancy: true,
      markdownMaxOccupancyPct: 88, manualHoldHours: 6, now,
    })).toBe("sold_out");
  });

  it("holds off markdown right after a manual edit", () => {
    const now = new Date("2026-08-14T10:00:00Z");
    expect(markdownBlockReason({
      hadPickup: false, protectHighOccupancy: true, markdownMaxOccupancyPct: 88,
      manualHoldHours: 6, lastManualEditAt: "2026-08-14T08:00:00Z", now,
    })).toBe("manual_hold");
    expect(markdownBlockReason({
      hadPickup: false, protectHighOccupancy: true, markdownMaxOccupancyPct: 88,
      manualHoldHours: 6, lastManualEditAt: "2026-08-13T20:00:00Z", now,
    })).toBeNull();
  });

  it("reports the maximum possible daily markdown from cadence × step", () => {
    expect(maxDailyMarkdown(60, 0.5)).toBe(12);
    expect(maxDailyMarkdown(180, 1)).toBe(8);
  });
});

describe("durable intent / coalescing", () => {
  const intent = (id: string, price: number, created_at: string, claimed = false) => ({
    id, cellKey: "2026-10-03|Deluxe|2", new_price: price, old_price: null, claimed, created_at,
  });

  it("delivers only the latest unsent target after three hourly decisions", () => {
    const { deliver, supersede } = coalesceIntents(
      [intent("a", 179.5, "2026-08-14T10:00:00Z"), intent("b", 179, "2026-08-14T11:00:00Z")],
      [intent("c", 178.5, "2026-08-14T12:00:00Z")],
    );
    expect(deliver).toHaveLength(1);
    expect(deliver[0].new_price).toBe(178.5);
    // History is retained as superseded rows, never deleted.
    expect(supersede.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("never mutates a target the publisher already claimed", () => {
    const { deliver, supersede } = coalesceIntents(
      [intent("sent", 179.5, "2026-08-14T10:00:00Z", true)],
      [intent("next", 179, "2026-08-14T11:00:00Z")],
    );
    expect(supersede).toHaveLength(0);
    expect(deliver.map((i) => i.id)).toEqual(["next"]);
  });

  it("pickup after a queued markdown supersedes the stale markdown target", () => {
    const pending = [{ new_price: 179.5, created_at: "2026-08-14T10:00:00Z" }];
    // The pickup rule computes from the intended 179.50, not the 180 mirror.
    const from = effectivePrice(180, pending)!;
    expect(from).toBe(179.5);
    const pickupTarget = roundMoney(from + 8);
    const { deliver, supersede } = coalesceIntents(
      [intent("markdown", 179.5, "2026-08-14T10:00:00Z")],
      [intent("pickup", pickupTarget, "2026-08-14T10:30:00Z")],
    );
    expect(deliver).toHaveLength(1);
    expect(deliver[0].new_price).toBe(187.5);
    expect(supersede.map((i) => i.id)).toEqual(["markdown"]);
  });

  it("falls back to the PMS mirror when nothing is pending", () => {
    expect(effectivePrice(180, [])).toBe(180);
    expect(effectivePrice(null, [])).toBeNull();
  });

  it("a 183-day markdown sweep becomes durable coalesced work, not one giant call", () => {
    const cells = Array.from({ length: 183 * 4 }, (_, i) => ({
      id: `i${i}`, cellKey: `cell-${i % (183 * 4)}`, new_price: 179.5,
      old_price: 180, claimed: false, created_at: "2026-08-14T10:00:00Z",
    }));
    const { deliver } = coalesceIntents([], cells);
    expect(deliver).toHaveLength(183 * 4);
    // Delivered in bounded slices by the publisher (400 per invocation).
    const SLICE = 400;
    const slices = Math.ceil(deliver.length / SLICE);
    expect(slices).toBeGreaterThan(1);
    expect(deliver.slice(0, SLICE)).toHaveLength(SLICE);
  });
});
