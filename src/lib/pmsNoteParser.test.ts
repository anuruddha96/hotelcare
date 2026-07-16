import { describe, it, expect } from "vitest";
import { parsePmsNote, summarizePmsNote, looksLikePmsNote } from "./pmsNoteParser";

const SAMPLE = `Recepce - &lt;b&gt;VCC 72.27eur RDO-2026-2532 kabeer&lt;br /&gt;Breakfast in&lt;/b&gt;&lt;/br&gt;&lt;/br&gt;Systém - &lt;span classcontainer-1&gt;Partner &lt;span classvalue-1&gt;Booking.com XML&lt;/span&gt;&lt;/span&gt;&lt;br&gt;&lt;span classcontainer-2&gt;Total price &lt;span classvalue-2&gt;72.27 EUR&lt;/span&gt;&lt;/span&gt;&lt;br&gt;&lt;span classcontainer-6&gt;Meals &lt;span classvalue-6&gt;breakfast&lt;/span&gt;&lt;/span&gt;&lt;br&gt;&lt;span classcontainer-7&gt;Partner&amp;039;s room name &lt;span classvalue-7&gt;Deluxe Double or Twin Room - General - Breakfast included (Mobile(App) Rate (ID 0))&lt;/span&gt;&lt;/span&gt;&lt;br&gt;&lt;span classcontainer-8&gt;Note &lt;span classvalue-8&gt;Special requestssmoking preference Non-SmokingCommission note This is the total commission amount calculated by Booking.com (16.06 EUR)Payment description payment_on_Booking.com (Payout type Virtual credit card)&lt;/span&gt;&lt;/span&gt;&lt;br&gt;&lt;span classcontainer-9&gt;Comment &lt;span classvalue-9&gt;You have received a virtual credit card for this reservation.&lt;/span&gt;&lt;/span&gt;&lt;br&gt;&lt;span classcontainer-12&gt;Note &lt;span classvalue-12&gt;Breakfast is included in the room rate. Children and Extra Bed Policy Children of any age are allowed. You haven&amp;039;t added any extra beds. The maximum number of cots is 1. The maximum number of guests is 2.  Cancellation Policy The guest can cancel free of charge until 7 days before arrival.&lt;/span&gt;&lt;/span&gt;&lt;br&gt;&lt;span classcontainer-14&gt;Payment &lt;span classvalue-14&gt;72.27 EUR (ota). Payment - Virtual Credit Card. Needs to be charged from Virtual Credit Card.&lt;/span&gt;&lt;/span&gt;`;

describe("pmsNoteParser", () => {
  it("returns empty result for null/empty note without crashing", () => {
    expect(parsePmsNote(null).hasStructuredContent).toBe(false);
    expect(parsePmsNote("").hasStructuredContent).toBe(false);
    expect(parsePmsNote("   ").hasStructuredContent).toBe(false);
  });

  it("detects PMS-shaped notes vs plain manager text", () => {
    expect(looksLikePmsNote(null)).toBe(false);
    expect(looksLikePmsNote("please leave extra towels")).toBe(false);
    expect(looksLikePmsNote(SAMPLE)).toBe(true);
  });

  it("extracts structured fields from the user's Booking.com sample", () => {
    const parsed = parsePmsNote(SAMPLE);
    expect(parsed.hasStructuredContent).toBe(true);
    expect(parsed.smoking).toBe("Non-smoking");
    expect(parsed.meals).toBe("Breakfast");
    expect(parsed.extras.guestsMax).toBe(2);
    expect(parsed.extras.babyCotMax).toBe(1);
    // "Deluxe Double or Twin Room" is a Booking.com category — not a guest
    // preference — so no bed arrangement should be inferred here.
    expect(parsed.bedArrangement).toBeNull();
  });

  it("strips VCC / commission / cancellation noise from summary output", () => {
    const summary = summarizePmsNote(SAMPLE);
    expect(summary).not.toMatch(/VCC|Virtual Credit|Commission|Cancellation|72\.27|RDO-2026|Booking\.com XML/i);
    expect(summary).toMatch(/Non-smoking/);
    expect(summary).toMatch(/Breakfast/);
    expect(summary).toMatch(/Max guests: 2/);
  });

  it("infers Twin Beds Separated when guest explicitly requests it", () => {
    const note = "Note Special requeststwin beds separated please";
    const parsed = parsePmsNote(note);
    expect(parsed.bedArrangement).toBe("Twin Beds Separated");
  });

  it("infers Baby Bed when Booking.com special request mentions crib", () => {
    const note = "Special requests baby cot needed for infant";
    const parsed = parsePmsNote(note);
    expect(parsed.bedArrangement).toBe("Baby Bed");
  });

  it("captures late arrival as a special request bullet", () => {
    const note = "Special requests late arrival around 23:30";
    const parsed = parsePmsNote(note);
    expect(parsed.specialRequests.some((r) => /late arrival/i.test(r))).toBe(true);
  });

  it("leaves plain manager notes untouched (no structured content)", () => {
    const note = "please leave extra towels and shampoo";
    const parsed = parsePmsNote(note);
    expect(parsed.hasStructuredContent).toBe(false);
    expect(parsed.raw).toBe(note);
  });
});
