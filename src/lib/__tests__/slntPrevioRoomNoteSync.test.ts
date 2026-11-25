import { describe, expect, it } from "vitest";
import { pickPrevioHousekeepingNote, reconcileSlntPrevioRoomNote } from "../previoHousekeepingNote";

describe("SLNT mapped-unit Previo notes", () => {
  it("imports the housekeeping department only, not reservation/reception text", () => {
    const incoming = pickPrevioHousekeepingNote({
      Note: "Systém - Booking.com Total price 123 EUR Recepce - collect payment Housekeeping - Twin beds separated Kuchyně - breakfast",
      NoteInternal: "collect payment",
    });
    expect(incoming).toBe("Twin beds separated");
    expect(reconcileSlntPrevioRoomNote(null, null, incoming)).toEqual({
      notes: "Twin beds separated", changed: true, managerNotePreserved: false,
    });
  });

  it("refreshes a previous PMS-owned instruction when Previo changes it", () => {
    expect(reconcileSlntPrevioRoomNote("Extra towels", "Extra towels", "Prepare sofa bed")).toEqual({
      notes: "Prepare sofa bed", changed: true, managerNotePreserved: false,
    });
  });

  it("keeps a manager's separate note when Previo changes or removes the PMS note", () => {
    expect(reconcileSlntPrevioRoomNote("Supervisor: change duvet", "Extra towels", "Prepare sofa bed")).toEqual({
      notes: "Supervisor: change duvet", changed: false, managerNotePreserved: true,
    });
    expect(reconcileSlntPrevioRoomNote("Supervisor: change duvet", "Extra towels", null).notes)
      .toBe("Supervisor: change duvet");
  });

  it("preserves guest-service flags while updating and clearing PMS-owned text", () => {
    const before = "[COLLECT_EXTRA_TOWELS] [ROOM_CLEANING] Sofa bed";
    const refreshed = reconcileSlntPrevioRoomNote(before, "Sofa bed", "Twin beds");
    expect(refreshed.notes).toBe("[COLLECT_EXTRA_TOWELS] [ROOM_CLEANING] Twin beds");
    expect(reconcileSlntPrevioRoomNote(refreshed.notes, "Twin beds", null).notes)
      .toBe("[COLLECT_EXTRA_TOWELS] [ROOM_CLEANING]");
  });

  it("does not silently take ownership of existing human notes on first sync", () => {
    const result = reconcileSlntPrevioRoomNote("Make bed for late arrival", null, "Extra towels");
    expect(result.notes).toBe("Make bed for late arrival");
    expect(result.managerNotePreserved).toBe(true);
  });

  it("is idempotent on unchanged PMS notes and rejects OTA-only notes", () => {
    const note = pickPrevioHousekeepingNote({ Note: "Booking.com Commission note Total price 88 EUR" });
    expect(note).toBeNull();
    expect(reconcileSlntPrevioRoomNote("Twin beds", "Twin beds", "Twin beds").changed).toBe(false);
  });
});
