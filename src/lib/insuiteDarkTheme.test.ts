import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const staff = readFileSync("src/pages/InSuiteStaff.tsx", "utf8");
const component = (name: string) => readFileSync(`src/components/insuite/${name}.tsx`, "utf8");
const files = [staff, ...["InSuiteCommerceConsole", "InSuiteWellnessBoard", "InSuiteRoomQrCodes", "InSuiteAssignedRequests"].map(component)];

describe("In-Suite staff dark theme", () => {
  it("uses the workspace canvas and legible form controls", () => {
    expect(staff).toContain("min-h-screen bg-slate-50 dark:bg-background text-foreground");
    expect(staff).toContain("dark:border-input bg-white dark:bg-card");
    expect(staff).toContain("dark:[color-scheme:dark]");
  });
  it("pairs neutral light surfaces with dark theme surfaces, including portal dialogs", () => {
    for (const source of files) {
      const nonPrint = source.split("\n").filter(line => !line.includes("insuite-qr-card")).join("\n");
      expect(nonPrint).not.toMatch(/\bbg-white(?:\/95)?(?![\w/])(?!(?: dark:bg-card))/);
      expect(nonPrint).not.toMatch(/\btext-slate-500\b(?! dark:text-muted-foreground)/);
      expect(nonPrint).not.toMatch(/\bbg-slate-900\b(?! dark:bg-primary)/);
    }
  });
  it("preserves colored status signals and readable selected tabs", () => {
    expect(staff).toContain("bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground");
    expect(staff).toContain("bg-emerald-100 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-200");
    expect(staff).toContain("bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200");
  });
  it("keeps QR print cards light and guest-facing code untouched", () => {
    const qr = component("InSuiteRoomQrCodes");
    expect(qr).toContain("bg-white text-slate-900 [color-scheme:light]");
    expect(qr).toContain("background: white !important; color: #0f172a !important");
    expect(qr).toContain('text-sm text-slate-600">Scan for room services');
  });
});
