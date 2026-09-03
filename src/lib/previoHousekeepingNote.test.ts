import { describe, expect, it } from "vitest";
import {
  extractHousekeepingSectionsFromRawNote,
  pickPrevioHousekeepingNote,
} from "./previoHousekeepingNote";

describe("Previo housekeeping note parsing", () => {
  it("keeps only the housekeeping tab from a multi-department Previo note", () => {
    const raw =
      "Systém - Booking.com Total price 123 EUR Recepce - .36 eur (Mannan) Housekeeping - SofaBed we stay 3";
    expect(extractHousekeepingSectionsFromRawNote(raw)).toBe("SofaBed we stay 3");
  });

  it("prefers the labelled housekeeping tab over NoteInternal reception text", () => {
    const raw =
      "Systém - Booking.com Total price 123 EUR Recepce - .36 eur (Mannan) Housekeeping - SofaBed we stay 3";
    expect(
      pickPrevioHousekeepingNote({
        Note: raw,
        NoteOta: raw,
        NoteInternal: ".36 eur (Mannan)",
      }),
    ).toBe("SofaBed we stay 3");
  });

  it("does not leak a reception note when there is no housekeeping tab", () => {
    const raw = "Systém - Booking.com Total price 123 EUR Recepce - .36 eur (Mannan)";
    expect(
      pickPrevioHousekeepingNote({
        Note: raw,
        NoteInternal: ".36 eur (Mannan)",
      }),
    ).toBeNull();
  });

  it("accepts an explicitly labelled housekeeping internal note", () => {
    expect(
      pickPrevioHousekeepingNote({
        Note: "Systém - Booking.com Total price 123 EUR Recepce - late arrival",
        NoteInternal: "Housekeeping: Twin beds separated",
      }),
    ).toBe("Twin beds separated");
  });

  it("keeps compatibility with a dedicated unlabelled internal note", () => {
    expect(
      pickPrevioHousekeepingNote({
        Note: "Booking.com Commission note Total price 123 EUR",
        NoteInternal: "Baby cot please",
      }),
    ).toBe("Baby cot please");
  });

  it("accepts a plain housekeeping note when no department labels are present", () => {
    expect(extractHousekeepingSectionsFromRawNote("SofaBed please prepare")).toBe(
      "SofaBed please prepare",
    );
  });
});
