import { describe, expect, it } from "vitest";
import {
  addDays,
  backoffSeconds,
  classifyStatus,
  coalesceOutbox,
  compressCells,
  extractTaskIds,
  extractWarnings,
  formatRate,
  fullSyncCells,
  type OutboxRow,
} from "../../../supabase/functions/_shared/channexAri";

const PROP = "prop-1";
const MAP: Record<string, string> = {
  "twin": "cx-room-twin",
  "dbl": "cx-room-dbl",
  "twin-bar": "cx-rp-twin-bar",
  "twin-bb": "cx-rp-twin-bb",
  "dbl-bar": "cx-rp-dbl-bar",
  "dbl-bb": "cx-rp-dbl-bb",
};
const idFor = (id: string) => MAP[id];

/** What the database triggers write when reception saves a range. */
function rows(kind: OutboxRow["kind"], target: string, from: string, to: string, fields: Record<string, unknown>, start = 1): OutboxRow[] {
  const out: OutboxRow[] = [];
  let d = from;
  let id = start;
  while (d <= to) {
    out.push({ id: id++, kind, target_id: target, date: d, fields });
    d = addDays(d, 1);
  }
  return out;
}

function batch(all: OutboxRow[], kind: OutboxRow["kind"]) {
  const cells = coalesceOutbox(all).get(kind) ?? [];
  return compressCells(kind, cells, PROP, idFor);
}

describe("Channex certification scenarios produce one request per kind", () => {
  it("test 2: single date, single rate", () => {
    const { values } = batch(rows("restrictions", "twin-bar", "2027-11-22", "2027-11-22", { rate: "333.00" }), "restrictions");
    expect(values).toEqual([
      { property_id: PROP, rate_plan_id: "cx-rp-twin-bar", date_from: "2027-11-22", date_to: "2027-11-22", rate: "333.00" },
    ]);
  });

  it("test 3: three single-date rates are one request with three values", () => {
    const all = [
      ...rows("restrictions", "twin-bar", "2027-11-21", "2027-11-21", { rate: "333.00" }, 1),
      ...rows("restrictions", "dbl-bar", "2027-11-25", "2027-11-25", { rate: "444.00" }, 2),
      ...rows("restrictions", "dbl-bb", "2027-11-29", "2027-11-29", { rate: "456.23" }, 3),
    ];
    const { values, unmapped } = batch(all, "restrictions");
    expect(unmapped).toEqual([]);
    expect(values).toHaveLength(3);
    expect(values.map((v) => (v as { rate: string }).rate).sort()).toEqual(["333.00", "444.00", "456.23"]);
  });

  it("test 4: date ranges are compressed, not sent per day", () => {
    const all = [
      ...rows("restrictions", "twin-bar", "2027-11-01", "2027-11-10", { rate: "241.00" }, 1),
      ...rows("restrictions", "dbl-bar", "2027-11-10", "2027-11-16", { rate: "312.66" }, 100),
      ...rows("restrictions", "dbl-bb", "2027-11-01", "2027-11-20", { rate: "111.00" }, 200),
    ];
    const { values } = batch(all, "restrictions");
    expect(values).toHaveLength(3);
    expect(values).toContainEqual({ property_id: PROP, rate_plan_id: "cx-rp-dbl-bb", date_from: "2027-11-01", date_to: "2027-11-20", rate: "111.00" });
  });

  it("test 7: mixed restriction sets keep only the fields that were set", () => {
    const all = [
      ...rows("restrictions", "twin-bar", "2027-11-01", "2027-11-10", { closed_to_arrival: true, closed_to_departure: false, max_stay: 4, min_stay_arrival: 1 }, 1),
      ...rows("restrictions", "twin-bb", "2027-11-12", "2027-11-16", { closed_to_arrival: false, closed_to_departure: true, min_stay_arrival: 6 }, 100),
      ...rows("restrictions", "dbl-bar", "2027-11-10", "2027-11-16", { closed_to_arrival: true, min_stay_arrival: 2 }, 200),
      ...rows("restrictions", "dbl-bb", "2027-11-01", "2027-11-20", { min_stay_arrival: 10 }, 300),
    ];
    const { values } = batch(all, "restrictions");
    expect(values).toHaveLength(4);
    const dblBb = values.find((v) => (v as { rate_plan_id: string }).rate_plan_id === "cx-rp-dbl-bb")!;
    expect(dblBb).toEqual({ property_id: PROP, rate_plan_id: "cx-rp-dbl-bb", date_from: "2027-11-01", date_to: "2027-11-20", min_stay_arrival: 10 });
  });

  it("test 8: half-year rate + restrictions is one value per rate plan", () => {
    const all = [
      ...rows("restrictions", "twin-bar", "2027-12-01", "2028-05-01", { rate: "432.00", closed_to_arrival: false, closed_to_departure: false, min_stay_arrival: 2 }, 1),
      ...rows("restrictions", "dbl-bar", "2027-12-01", "2028-05-01", { rate: "342.00", min_stay_arrival: 3 }, 1000),
    ];
    const { values } = batch(all, "restrictions");
    expect(values).toHaveLength(2);
    expect(values[0]).toMatchObject({ date_from: "2027-12-01", date_to: "2028-05-01" });
  });

  it("tests 9-10: availability from bookings compresses per room type", () => {
    const all = [
      ...rows("availability", "twin", "2027-11-10", "2027-11-16", { availability: 3 }, 1),
      ...rows("availability", "dbl", "2027-11-17", "2027-11-24", { availability: 4 }, 100),
    ];
    const { values } = batch(all, "availability");
    expect(values).toEqual([
      { property_id: PROP, date_from: "2027-11-17", date_to: "2027-11-24", room_type_id: "cx-room-dbl", availability: 4 },
      { property_id: PROP, date_from: "2027-11-10", date_to: "2027-11-16", room_type_id: "cx-room-twin", availability: 3 },
    ]);
  });
});

describe("coalescing and safety", () => {
  it("later edits win field by field and earlier unsent fields survive", () => {
    const all: OutboxRow[] = [
      { id: 1, kind: "restrictions", target_id: "twin-bar", date: "2027-11-23", fields: { rate: "200.00", min_stay_arrival: 2 } },
      { id: 2, kind: "restrictions", target_id: "twin-bar", date: "2027-11-23", fields: { min_stay_arrival: 3 } },
    ];
    const { values } = batch(all, "restrictions");
    expect(values).toEqual([
      { property_id: PROP, rate_plan_id: "cx-rp-twin-bar", date_from: "2027-11-23", date_to: "2027-11-23", rate: "200.00", min_stay_arrival: 3 },
    ]);
  });

  it("does not merge ranges across a gap or a different value", () => {
    const all = [
      ...rows("availability", "twin", "2027-11-01", "2027-11-02", { availability: 5 }, 1),
      ...rows("availability", "twin", "2027-11-04", "2027-11-04", { availability: 5 }, 10),
      ...rows("availability", "twin", "2027-11-05", "2027-11-05", { availability: 4 }, 20),
    ];
    expect(batch(all, "availability").values).toHaveLength(3);
  });

  it("reports unmapped targets instead of sending them", () => {
    const { values, unmapped } = batch(rows("restrictions", "unknown", "2027-11-01", "2027-11-01", { rate: 10 }), "restrictions");
    expect(values).toEqual([]);
    expect(unmapped).toEqual(["unknown"]);
  });

  it("rejects invalid values", () => {
    expect(() => batch(rows("availability", "twin", "2027-11-01", "2027-11-01", { availability: -1 }), "availability")).toThrow();
    expect(() => formatRate("12.345")).toThrow();
    expect(formatRate(456.23)).toBe("456.23");
    expect(formatRate("100")).toBe("100.00");
  });
});

describe("full sync", () => {
  it("covers 500 days for every target and stays compact", () => {
    const stored = new Map<string, Record<string, unknown>>([
      ["twin-bar|2026-12-24", { rate: "180.00" }],
      ["twin-bar|2026-12-25", { rate: "180.00", stop_sell: true }],
    ]);
    const cells = fullSyncCells("restrictions", ["twin-bar", "dbl-bb"], "2026-11-13", 500, stored, (t) => ({
      rate: t === "twin-bar" ? "100.00" : "120.00", min_stay_arrival: 1, max_stay: 0,
      closed_to_arrival: false, closed_to_departure: false, stop_sell: false,
    }));
    expect(cells).toHaveLength(1000);
    const { values } = compressCells("restrictions", cells, PROP, idFor);
    const last = addDays("2026-11-13", 499);
    expect(values.filter((v) => (v as { rate_plan_id: string }).rate_plan_id === "cx-rp-dbl-bb")).toEqual([
      expect.objectContaining({ date_from: "2026-11-13", date_to: last, rate: "120.00" }),
    ]);
    expect(values.filter((v) => (v as { rate_plan_id: string }).rate_plan_id === "cx-rp-twin-bar")).toHaveLength(4);
  });
});

describe("response handling", () => {
  it("classifies statuses and backs off", () => {
    expect(classifyStatus(200)).toBe("ok");
    expect(classifyStatus(429)).toBe("retry");
    expect(classifyStatus(503)).toBe("retry");
    expect(classifyStatus(null)).toBe("retry");
    expect(classifyStatus(422)).toBe("fail");
    expect(backoffSeconds(1)).toBe(15);
    expect(backoffSeconds(3)).toBe(60);
    expect(backoffSeconds(20)).toBe(900);
    expect(backoffSeconds(1, "42")).toBe(42);
  });

  it("extracts task ids and warnings", () => {
    const body = { data: [{ id: "03854d5e-5234-43e9-b673-803e91bfe640", type: "task" }], meta: { message: "Success", warnings: [{ date: "x" }] } };
    expect(extractTaskIds(body)).toEqual(["03854d5e-5234-43e9-b673-803e91bfe640"]);
    expect(extractWarnings(body)).toHaveLength(1);
    expect(extractTaskIds({})).toEqual([]);
  });
});
