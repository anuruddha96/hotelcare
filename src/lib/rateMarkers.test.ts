import { describe, it, expect } from "vitest";
import { indexCellMarkers, dayMarkers, markerOrigin, type CellMarkerRow } from "@/lib/rateMarkers";
import { cellKey } from "@/lib/rateAudit";

/** 2026-08-14 07:49 Budapest = 05:49Z (CEST, UTC+2). */
const TODAY_0749 = "2026-08-14T05:49:47.834Z";
const TODAY_0600 = "2026-08-14T04:00:00.000Z";
const YESTERDAY = "2026-08-13T15:00:00.000Z";
const NOW = Date.parse("2026-08-14T05:55:00.000Z");

function row(over: Partial<CellMarkerRow> = {}): CellMarkerRow {
  return {
    stay_date: "2026-08-14",
    room_type_name: "Deluxe Queen Room",
    occupancy: 2,
    source: "previo_confirmed",
    performed_at: TODAY_0749,
    performed_by: "5d310c7f-1192-4543-8c2c-bb18f69fdd43",
    confirmation_status: "confirmed",
    old_rate_eur: 201,
    new_rate_eur: 200,
    requested_price: 200,
    ...over,
  };
}

const KEY = cellKey("2026-08-14", "Deluxe Queen Room", 2);

describe("durable rate markers", () => {
  it("a manual confirmed change survives reload as a blue cell and date dot", () => {
    const cells = indexCellMarkers([row()]);
    expect(cells.get(KEY)?.origin).toBe("team");
    expect(dayMarkers(cells, NOW).get("2026-08-14")?.origin).toBe("team");
  });

  it("keeps the cell when requested_price is missing or malformed", () => {
    const cells = indexCellMarkers([row({ requested_price: null })]);
    expect(cells.get(KEY)?.origin).toBe("team");
    expect(cells.get(KEY)?.requested).toBeNull();
  });

  it("skips a blank/invalid occupancy row without losing the good ones", () => {
    const cells = indexCellMarkers([
      row({ occupancy: null as unknown as number, room_type_name: "Economy Double Room" }),
      row(),
    ]);
    expect(cells.size).toBe(1);
    expect(cells.get(KEY)?.origin).toBe("team");
  });

  it("newest valid event wins when automation and manual touch the same date", () => {
    const cells = indexCellMarkers([
      row({ source: "previo_automation_confirmed", performed_at: TODAY_0600 }),
      row({ source: "previo_confirmed", performed_at: TODAY_0749 }),
    ]);
    expect(cells.get(KEY)?.origin).toBe("team");
    expect(dayMarkers(cells, NOW).get("2026-08-14")?.origin).toBe("team");
  });

  it("automation wins when it is the newer change", () => {
    const cells = indexCellMarkers([
      row({ source: "previo_confirmed", performed_at: TODAY_0600 }),
      row({ source: "push_automation", performed_at: TODAY_0749 }),
    ]);
    expect(cells.get(KEY)?.origin).toBe("automation");
  });

  it("Budapest midnight clears the date dot but keeps the cell marker", () => {
    const cells = indexCellMarkers([row({ performed_at: YESTERDAY })]);
    expect(cells.get(KEY)?.origin).toBe("team");
    expect(dayMarkers(cells, NOW).get("2026-08-14")).toBeUndefined();
  });

  it("maps the persisted confirmed manual source to team", () => {
    expect(markerOrigin("previo_confirmed", "confirmed")).toBe("team");
    expect(markerOrigin("push", null)).toBe("team");
    expect(markerOrigin("previo_confirmed", "different")).toBe("failed");
  });
});
