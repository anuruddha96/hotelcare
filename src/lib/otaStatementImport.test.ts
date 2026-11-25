import { describe, expect, it } from "vitest";
import {
  checkStatementRow, parseAmount, parseDay, parseStatementRows, statementTotals, summariseStatements,
  toStatementCheckRow, type StatementCheckRow,
} from "./otaStatementImport";

describe("parseAmount", () => {
  it.each([
    ["1061.47", 1061.47],
    ["1,061.47", 1061.47],
    ["1.061,47", 1061.47],
    ["1061,47", 1061.47],
    ["1,061", 1061],
    [427.25, 427.25],
    ["€ 72.27", 72.27],
    ["", null],
    ["n/a", null],
  ])("%s -> %s", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });
});

describe("parseDay", () => {
  it.each([
    ["2026-08-23", "2026-08-23"],
    ["2026-07-06T21:57:34", "2026-07-06"],
    ["Oct 5, 2026", "2026-10-05"],
    ["Sep 30, 2026", "2026-09-30"],
    ["2026. szept. 21.", "2026-09-21"],
    ["2026. okt. 3.", "2026-10-03"],
    ["2026.10.20.", "2026-10-20"],
    [46315, "2026-10-20"],
    ["not a date", null],
  ])("%s -> %s", (input, expected) => {
    expect(parseDay(input)).toBe(expected);
  });
});

const BDC_HEADER = [
  "Reservation number", "Invoice number", "Booked on", "Arrival", "Departure", "Booker name", "Guest name",
  "Rooms", "Persons", "Room nights", "Commission %", "Original amount", "Final amount", "Commission amount",
  "Status", "Guest request", "Currency", "Hotel id", "Property name", "City", "Country",
];

describe("Booking.com reservation statement", () => {
  const rows: unknown[][] = [
    BDC_HEADER,
    [5000000001, 1666000001, "2026-07-07T01:19:03", "2026-09-24", "2026-10-01", "A. Guest", "A. Guest", 1, 4, 7, "23.00", 1857.6, 1857.6, 427.25, "OK", null, "EUR", 185220, "Hotel", "Budapest", "Hungary"],
    [5000000002, 1666000001, "2026-08-10T16:28:40", "2026-09-24", "2026-10-03", "B. Guest", "B. Guest", 1, 3, 0, 23, 1805.4, 0, 0, "CANCELLED", null, "EUR", 185220, "Hotel", "Budapest", "Hungary"],
    [5000000003, 1666000001, "2026-09-25T21:38:45", "2026-10-26", "2026-10-29", "C. Guest", "C. Guest", 1, 2, 3, 18, 300, 300, 54, "OK", null, "EUR", 272495, "Hotel 2", "Budapest", "Hungary"],
    ["Total", null, null, null, null, null, null, null, null, 10, null, null, 2157.6, 481.25],
  ];

  it("reads codes, dates and amounts, never names, and skips totals rows", () => {
    const res = parseStatementRows(rows, "statement.xlsx");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = res.statement;
    expect(s.channel).toBe("booking_com");
    expect(s.lines).toHaveLength(3);
    expect(s.skippedRows).toBe(1);
    expect(s.listingRefs).toEqual(["185220", "272495"]);
    expect(s.period).toBe("2026-10-01");
    expect(s.lines[0]).toMatchObject({
      ota_reservation_code: "5000000001", booked_at: "2026-07-07T01:19:03", check_in: "2026-09-24", check_out: "2026-10-01",
      room_nights: 7, commission_pct: 23, gross_amount: 1857.6, commission_amount: 427.25, status: "OK", listing_ref: "185220",
    });
    expect(JSON.stringify(s.lines)).not.toMatch(/Guest/);
    const totals = statementTotals(s.lines);
    expect(totals).toMatchObject({ lines: 3, cancelled: 1 });
    expect(totals.commission).toBeCloseTo(481.25, 2);
  });
});

describe("Agoda earnings report", () => {
  it("reads the English export, the payout date and the commission", () => {
    const rows: unknown[][] = [
      ["2026.10.20. Agoda Hotel"],
      ["Booking ID", "Lead guest name", "Check-in", "Check-out", "Booking status", "Currency", "Reference sell inclusive", "Owed to Agoda", "Payout amount", "Invoice"],
      [710000459, "A. Guest", "Oct 5, 2026", "Oct 6, 2026", "Departed", "EUR", 73.72, 0, 55.29, "INV-1"],
      [710000460, "B. Guest", "Oct 7, 2026", "Oct 9, 2026", "Departed", "EUR", 200, 30, 0, "INV-2"],
    ];
    const res = parseStatementRows(rows, "agoda.xlsx");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.statement.channel).toBe("agoda");
    expect(res.statement.period).toBe("2026-10-20");
    expect(res.statement.lines[0]).toMatchObject({ ota_reservation_code: "710000459", gross_amount: 73.72, payout_amount: 55.29, commission_amount: 18.43, commission_pct: 25, check_in: "2026-10-05" });
    // Hotel-collect booking: the hotel owes the commission
    expect(res.statement.lines[1].commission_amount).toBe(30);
  });

  it("reads the Hungarian headers", () => {
    const rows: unknown[][] = [
      [null],
      ["Foglalási azonosító", "A fővendég neve", "Bejelentkezés", "Kijelentkezés", "A foglalás státusza", "Pénznem", "Inkluzív értékesítési refenciaár", "Tartozás az Agoda felé", "Kifizetés összege", "Invoice"],
      [704586339, "A. Guest", "2026. szept. 21.", "2026. szept. 22.", "Elhagyta a szállodát\n", "EUR", 110.97, 0, 83.23, "INV-3"],
    ];
    const res = parseStatementRows(rows, "agoda_2026-09.xlsx");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.statement.period).toBe("2026-09-01");
    expect(res.statement.lines[0]).toMatchObject({ check_in: "2026-09-21", status: "Elhagyta a szállodát", commission_amount: 27.74 });
  });

  it("rejects files it does not recognise", () => {
    expect(parseStatementRows([["Date", "Amount"], ["2026-10-01", 5]])).toEqual({ ok: false, error: "unrecognised" });
    expect(parseStatementRows([])).toEqual({ ok: false, error: "empty" });
  });
});

describe("statement check", () => {
  const base: StatementCheckRow = toStatementCheckRow({
    channel_key: "booking_com", listing_ref: "185220", statement_period: "2026-10-01", ota_reservation_code: "5000000001",
    status: "OK", statement_gross: 1000, statement_commission: 180, statement_pct: 18, currency: "EUR",
    in_pms: true, note_commission: 180, terms_pct: 18, expected_commission: 180,
  });

  it("accepts a match within €1 or 1%", () => {
    expect(checkStatementRow({ ...base, statement_commission: 181.5 }).status).toBe("ok");
    expect(checkStatementRow(base)).toMatchObject({ status: "ok", referenceKind: "note", difference: 0 });
  });

  it("flags differences, wrong rates, missing bookings and charged cancellations", () => {
    expect(checkStatementRow({ ...base, statement_commission: 230, statement_pct: 23, note_commission: 180 }).status).toBe("differs");
    expect(checkStatementRow({ ...base, statement_pct: 23, terms_pct: 18 }).status).toBe("rate_differs");
    expect(checkStatementRow({ ...base, in_pms: false }).status).toBe("not_in_pms");
    expect(checkStatementRow({ ...base, status: "CANCELLED", statement_commission: 20 }).status).toBe("cancelled_charged");
    expect(checkStatementRow({ ...base, status: "CANCELLED", statement_commission: 0 }).status).toBe("no_charge");
    expect(checkStatementRow({ ...base, note_commission: null, expected_commission: null }).status).toBe("no_reference");
  });

  it("falls back to the contract terms when there is no note", () => {
    const r = checkStatementRow({ ...base, channel_key: "agoda", note_commission: null, expected_commission: 175 });
    expect(r).toMatchObject({ referenceKind: "terms", difference: 5, status: "differs" });
  });

  it("summarises per statement", () => {
    const list = summariseStatements([
      base,
      { ...base, ota_reservation_code: "5000000002", statement_commission: 230 },
      { ...base, ota_reservation_code: "5000000003", in_pms: false },
      { ...base, statement_period: "2026-09-01" },
    ]);
    expect(list.map((s) => s.statement_period)).toEqual(["2026-10-01", "2026-09-01"]);
    expect(list[0]).toMatchObject({ lines: 3, flagged: 1, notInPms: 1, charged: 590 });
  });
});
