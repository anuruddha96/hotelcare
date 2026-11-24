import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync("src/components/dashboard/" + file, "utf8");
const boards = ["HotelRoomOverviewLive.tsx", "GozsduCourtRoomOverview.tsx", "HistoricalHotelRoomOverviewSaved.tsx", "HotelFloorMap.tsx"];

describe("housekeeping status colors", () => {
  it.each(boards)("%s retains the original status palette in either theme", file => {
    const palette = source(file).split("const STATUS_COLORS:")[1]?.split("};")[0] ?? "";
    expect(palette).toContain("bg-emerald-");
    expect(palette).toContain("bg-amber-");
    expect(palette).toContain("bg-sky-");
    expect(palette).toContain("bg-red-");
    expect(palette).not.toContain("dark:");
  });
  it("starts with the legend open for every property", () => {
    expect(source("HotelRoomOverviewLive.tsx")).toContain("const [showLegend, setShowLegend] = useState(true)");
    expect(source("GozsduCourtRoomOverview.tsx")).toContain('data-training="room-legend"');
    expect(source("HistoricalHotelRoomOverviewSaved.tsx")).toContain("const [showLegend, setShowLegend] = useState(true)");
    expect(source("MemoriesHistoricalRoomOverview.tsx")).toContain("const [showLegend, setShowLegend] = useState(true)");
  });
});
