import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const grid = readFileSync("src/components/revenue/RateStrategyGrid.tsx", "utf8");

function luminance(hex: string): number {
  const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

describe("dark rate calendar visual hierarchy", () => {
  it("uses a stronger weekend header with matching Friday/Saturday and a quieter Sunday body", () => {
    expect(grid).toContain('weekendTone === "friday" || weekendTone === "saturday"');
    expect(grid).toContain('dayBg(d, i, "header")');
    expect(grid).toContain('bg-sky-200/85 dark:bg-[#234968]');
    expect(grid).toContain('bg-sky-200/85 dark:bg-[#172e43]');
    expect(grid).toContain('bg-sky-100/65 dark:bg-[#1a242e]');
  });
  it("keeps near-white text readable on the chosen dark surfaces", () => {
    for (const bg of ["101010", "202020", "234968", "172e43", "253747", "1a242e", "1d252c"]) {
      expect(contrast("f5f5f5", bg), bg).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast("fee2e2", "502525")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("fef3c7", "4d3d1c")).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps clear group boundaries, date selection, and original event color families", () => {
    expect(grid).toContain("dark:border-t-[#4a4a4a]");
    expect(grid).toContain("dark:border-b-[#272727]");
    expect(grid).toContain("dark:!bg-primary/20 ring-1 ring-inset ring-primary");
    expect(grid).toContain("bg-red-500/15 text-red-700 dark:bg-[#502525]");
    expect(grid).toContain("bg-amber-400/15 text-amber-800 dark:bg-[#4d3d1c]");
  });
});
