import { describe, it, expect } from "vitest";
import { parsePrevioReservationNote, looksLikePrevioReservationNote } from "./previoReservationNote";

const enc = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Note from a real Booking.com XML reservation as stored by Previo.
const RAW = enc(
  `Recepce - VCC</br></br>Systém - <span classcontainer-1>Partner <span classvalue-1>Booking.com XML</span></span><br><span classcontainer-2>Total price <span classvalue-2>300.19 EUR</span></span><br><span classcontainer-3>Price per room <span classvalue-3>300.19 EUR</span></span><br><span classcontainer-4>Commission <span classvalue-4>66.51 EUR</span></span><br><span classcontainer-5>Created <span classvalue-5>2026-06-26 124823</span></span><br><span classcontainer-6>Meals <span classvalue-6>breakfast</span></span><br><span classcontainer-7>Partner&amp;039;s room name <span classvalue-7>Deluxe Queen Room - General - Breakfast included (Mobile(App) Rate (ID 0))</span></span><br><span classcontainer-8>Note <span classvalue-8>Special requestssmoking preference Non-SmokingCommission note This is the total commission amount calculated by Booking.com (66.51 EUR)Payment description payment_on_Booking.com (Payout type Virtual credit card)</span></span><br><span classcontainer-9>Comment <span classvalue-9>You have received a virtual credit card for this reservation.You may charge it as of 2026-11-09.</span></span><br><span classcontainer-12>Note <span classvalue-12>Breakfast is included in the room rate.Lunch costs EUR 30 per person per night.Dinner costs EUR 30 per person per night. Children and Extra Bed Policy Children of any age are allowed. You haven&amp;039;t added any cots. You haven&amp;039;t added any extra beds. The maximum number of guests is 3. Deposit Policy No prepayment is needed. Cancellation Policy The guest can cancel free of charge until 7 days before arrival. The guest will be charged the cost of the first night if they cancel in the 7 days before arrival. If the guest doesnt show up they will be charged the total price of the reservation.</span></span><br><span classcontainer-14>Payment <span classvalue-14>300.19 EUR (ota). Calculated amount 300.19 EUR. Payment - Virtual Credit Card. Needs to be charged from Virtual Credit Card.</span></span>`,
);

describe("parsePrevioReservationNote", () => {
  const p = parsePrevioReservationNote(RAW);

  it("detects Previo notes but not plain text", () => {
    expect(looksLikePrevioReservationNote(RAW)).toBe(true);
    expect(looksLikePrevioReservationNote("Late arrival around 23:00")).toBe(false);
  });

  it("extracts booking facts", () => {
    expect(p.isStructured).toBe(true);
    expect(p.receptionNote).toBe("VCC");
    expect(p.booking).toMatchObject({
      channel: "Booking.com",
      totalPrice: "300.19 EUR",
      pricePerRoom: "300.19 EUR",
      commission: "66.51 EUR",
      createdAt: "2026-06-26 12:48",
      meals: "Breakfast included",
      roomName: "Deluxe Queen Room",
    });
    expect(p.booking.rateName).toContain("Mobile(App) Rate");
  });

  it("extracts guest preferences and payment", () => {
    expect(p.guest.smoking).toBe("Non-smoking");
    expect(p.guest.requests).toEqual([]);
    expect(p.payment.method).toBe("Virtual credit card");
    expect(p.payment.collectedBy).toBe("OTA");
    expect(p.payment.chargeableFrom).toBe("2026-11-09");
  });

  it("extracts policies", () => {
    expect(p.policies.cancellation).toMatch(/^The guest can cancel free of charge until 7 days/);
    expect(p.policies.deposit).toBe("No prepayment is needed");
    expect(p.policies.children).toMatch(/maximum number of guests is 3$/);
    expect(p.policies.meals).toContain("Lunch costs EUR 30");
    expect(p.plainText).not.toMatch(/<span|classvalue/);
  });

  it("keeps real guest requests", () => {
    const r = parsePrevioReservationNote(enc(`Systém - <span classcontainer-8>Note <span classvalue-8>Special requests We arrive late, around 23:00.smoking preference Non-SmokingCommission note x (1 EUR)</span></span>`));
    expect(r.guest.requests).toEqual(["We arrive late, around 23:00"]);
    expect(r.guest.smoking).toBe("Non-smoking");
  });
});

// What the reservation importer actually stores: the XML entities are already
// decoded once, so the markup is literal and apostrophes arrive as "&039;".
const STORED = `Recepce - VCC</br></br>Systém - <span classcontainer-1>Partner <span classvalue-1>Booking.com XML</span></span><br><span classcontainer-2>Total price <span classvalue-2>300.19 EUR</span></span><br><span classcontainer-6>Meals <span classvalue-6>breakfast</span></span><br><span classcontainer-7>Partner&039;s room name <span classvalue-7>Deluxe Queen Room - General - Breakfast included (Mobile(App) Rate (ID 0))</span></span><br><span classcontainer-8>Note <span classvalue-8>Special requestssmoking preference Non-SmokingCommission note This is the total commission amount calculated by Booking.com (66.51 EUR)Payment description payment_on_Booking.com (Payout type Virtual credit card)</span></span><br><span classcontainer-9>Comment <span classvalue-9>You have received a virtual credit card for this reservation.You may charge it as of 2026-11-09.</span></span><br><span classcontainer-12>Note <span classvalue-12>Children and Extra Bed Policy You haven&039;t added any cots. Deposit Policy No prepayment is needed.</span></span><br><span classcontainer-14>Payment <span classvalue-14>300.19 EUR (ota). Calculated amount 300.19 EUR. Payment - Virtual Credit Card. Needs to be charged from Virtual Credit Card.</span></span>`;

describe("stored (already decoded) Previo notes", () => {
  const p = parsePrevioReservationNote(STORED);

  it("parses the literal-markup form shown on the reservation page", () => {
    expect(p.isStructured).toBe(true);
    expect(p.receptionNote).toBe("VCC");
    expect(p.booking).toMatchObject({ channel: "Booking.com", totalPrice: "300.19 EUR", meals: "Breakfast included", roomName: "Deluxe Queen Room" });
    expect(p.payment).toMatchObject({ method: "Virtual credit card", collectedBy: "OTA", chargeableFrom: "2026-11-09" });
    expect(p.policies.children).toBe("You haven't added any cots");
    expect(p.extras).toEqual([]);
  });

  it("never leaves markup or entities in the readable text", () => {
    expect(p.plainText).not.toMatch(/<|>|classcontainer|classvalue|&0?39;|&amp;/);
    expect(JSON.stringify({ ...p, plainText: "" })).not.toMatch(/<span|classvalue|&039;/);
  });

  it("also accepts properly quoted class attributes", () => {
    const quoted = parsePrevioReservationNote(`Systém - <span class="container-1">Partner <span class="value-1">Expedia XML</span></span><br><span class="container-2">Total price <span class="value-2">120.00 EUR</span></span>`);
    expect(quoted.booking).toMatchObject({ channel: "Expedia", totalPrice: "120.00 EUR" });
  });
});

describe("unknown labels are kept, not hidden", () => {
  const p = parsePrevioReservationNote(`Systém - <span classcontainer-1>Partner <span classvalue-1>Szallas.hu</span></span><br><span classcontainer-20>Arrival time <span classvalue-20>between 22:00 and 23:00</span></span><br><span classcontainer-21>Company invoice <span classvalue-21>Kovacs Kft., HU12345678</span></span><br><span classcontainer-22>Empty <span classvalue-22></span></span>`);

  it("returns blocks this parser does not know as extras", () => {
    expect(p.isStructured).toBe(true);
    expect(p.extras).toEqual([
      { label: "Arrival time", value: "between 22:00 and 23:00" },
      { label: "Company invoice", value: "Kovacs Kft., HU12345678" },
    ]);
  });
});

describe("summarizeReservationNote", () => {
  it("returns a plain note unchanged", async () => {
    const { summarizeReservationNote } = await import("./previoReservationNote");
    expect(summarizeReservationNote("  Late arrival around 23:00 ")).toBe("Late arrival around 23:00");
    expect(summarizeReservationNote("")).toBeNull();
    expect(summarizeReservationNote(null)).toBeNull();
  });

  it("reduces a Booking.com note to what reception must act on", async () => {
    const { summarizeReservationNote } = await import("./previoReservationNote");
    const summary = summarizeReservationNote(STORED)!;
    expect(summary).toBe("VCC · Non-smoking · Virtual credit card (chargeable from 2026-11-09)");
    expect(summary).not.toMatch(/Commission|Cancellation|<span/);
  });

  it("keeps guest requests and unknown details", async () => {
    const { summarizeReservationNote } = await import("./previoReservationNote");
    const summary = summarizeReservationNote(`Systém - <span classcontainer-8>Note <span classvalue-8>Special requests We arrive late, around 23:00.smoking preference Non-Smoking</span></span><br><span classcontainer-20>Arrival time <span classvalue-20>after 22:00</span></span>`);
    expect(summary).toBe("We arrive late, around 23:00 · Non-smoking · Arrival time: after 22:00");
  });

  it("returns nothing for a Previo note with only booking boilerplate", async () => {
    const { summarizeReservationNote } = await import("./previoReservationNote");
    expect(summarizeReservationNote(`Systém - <span classcontainer-1>Partner <span classvalue-1>Booking.com XML</span></span><br><span classcontainer-2>Total price <span classvalue-2>300.19 EUR</span></span>`)).toBeNull();
  });

  it("falls back to readable text when the markup cannot be structured", async () => {
    const { summarizeReservationNote } = await import("./previoReservationNote");
    expect(summarizeReservationNote("Recepce - call guest<br>before arrival")).toBe("Recepce - call guest\nbefore arrival");
  });
});
