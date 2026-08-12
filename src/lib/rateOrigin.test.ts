import { describe, it, expect } from "vitest";
import { cellOriginEvents, distinctOrigins, countByOrigin } from "./rateOrigin";
import type { RateAuditRow } from "./rateAudit";
import type { AutomationAction } from "@/hooks/usePickupAutomationActions";

const now = Date.parse("2026-08-12T09:00:00Z");
const ago = (h: number) => new Date(now - h * 3600_000).toISOString();

const audit = (source: string, at: string): RateAuditRow => ({
  id: `${source}-${at}`, stay_date: "2026-08-12", action: "set", source,
  old_rate_eur: 100, new_rate_eur: 110, delta_eur: 10, notes: null,
  performed_at: at, performed_by: null, payload: { room_type_name: "Deluxe", occupancy: 2 },
});

const auto = (at: string): AutomationAction => ({
  id: at, stay_date: "2026-08-12", room_type_name: "Deluxe", occupancy: 2,
  old_price: 100, new_price: 108, increase_amount: 8, pickup_sequence: 1,
  reservation_id: "1", pickup_at: at, status: "pushed", created_at: at,
});

describe("cellOriginEvents", () => {
  it("puts the newest change first, so a manual edit beats older automation", () => {
    const events = cellOriginEvents([audit("previo_confirmed", ago(1))], [auto(ago(48))], now);
    expect(events[0].origin).toBe("team");
    expect(events.map((e) => e.origin)).toEqual(["team", "automation"]);
  });

  it("keeps automation first when it is the most recent", () => {
    const events = cellOriginEvents([audit("previo_confirmed", ago(30))], [auto(ago(2))], now);
    expect(events[0].origin).toBe("automation");
  });

  it("maps sources to the right colour groups", () => {
    const events = cellOriginEvents(
      [audit("previo_external", ago(3)), audit("previo_different", ago(4))], [], now,
    );
    expect(events.map((e) => e.origin)).toEqual(["previo", "failed"]);
  });

  it("drops anything older than the 7-day window", () => {
    expect(cellOriginEvents([audit("previo_confirmed", ago(24 * 9))], [], now)).toHaveLength(0);
  });

  it("shows at most two distinct dots", () => {
    const events = cellOriginEvents(
      [audit("previo_confirmed", ago(1)), audit("previo_external", ago(2))], [auto(ago(3))], now,
    );
    expect(distinctOrigins(events)).toEqual(["team", "previo"]);
    expect(countByOrigin(events)).toEqual([
      { origin: "team", count: 1 }, { origin: "automation", count: 1 }, { origin: "previo", count: 1 },
    ]);
  });
});
