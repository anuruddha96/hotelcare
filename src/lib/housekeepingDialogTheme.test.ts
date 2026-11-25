import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (name: string) => readFileSync("src/components/dashboard/" + name + ".tsx", "utf8");

describe("housekeeping room dialog theme", () => {
  it("uses theme surfaces for the header, body, essentials, details and note input", () => {
    const hub = source("RoomOperationsQuickHub");
    expect(hub).toContain("overflow-hidden bg-background text-foreground p-0");
    expect(hub).toContain("via-white to-sky-50 dark:bg-none dark:bg-card text-foreground");
    expect(hub).toContain("from-slate-50 to-white dark:border-border dark:bg-none dark:bg-card");
    expect(hub).toContain("bg-white p-2 dark:bg-background dark:text-foreground");
    expect(hub).toContain("bg-white text-sm dark:border-input dark:bg-background dark:text-foreground");
  });
  it("keeps colored status badges while adapting large controls and labels", () => {
    const hub = source("RoomOperationsQuickHub");
    expect(hub).toContain("border-emerald-200 bg-emerald-50 text-emerald-900");
    expect(hub).toContain("bg-amber-950/20");
    expect(hub).toContain("bg-emerald-700 text-white hover:bg-emerald-800");
    expect(hub).toContain("bg-blue-950/30 dark:text-blue-100 dark:hover:bg-blue-950/60");
  });
  it("covers related room dialogs and planned instructions", () => {
    expect(source("RoomPlannedNotesCalendar")).toContain("to-white dark:bg-none dark:bg-card");
    expect(source("RoomAssignmentDialog")).toContain("dark:bg-orange-950/25 dark:hover:bg-orange-950/50");
    expect(source("RoomAssignmentChangeDialog")).toContain("dark:text-orange-200");
    expect(source("WorkingRoomDetailDialog")).toContain("dark:text-yellow-100");
    expect(source("PendingRoomsDialog")).toContain("dark:hover:bg-muted/40");
    expect(source("RoomDetailDialog")).toContain("dark:bg-amber-950/25 dark:border-amber-800");
  });
});
