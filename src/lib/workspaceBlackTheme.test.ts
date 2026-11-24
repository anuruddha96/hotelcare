import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/index.css", "utf8");
const dark = css.split("  .dark {")[1]?.split("\n  }")[0] ?? "";
const light = css.split("  :root {")[1]?.split("\n  }")[0] ?? "";

describe("workspace dark appearance", () => {
  it("uses pure black canvas and neutral elevated surfaces", () => {
    expect(dark).toContain("--background: 0 0% 0%;");
    for (const token of ["card", "popover", "secondary", "muted", "accent", "border", "input", "sidebar-background", "foreground", "muted-foreground"]) {
      expect(dark).toMatch(new RegExp("--" + token + ": 0 0% \\d+%;"));
    }
    expect(dark).toContain("--foreground: 0 0% 96%;");
  });
  it("keeps the light canvas and branded accent", () => {
    expect(light).toContain("--background: 0 0% 100%;");
    expect(dark).toContain("--primary: 200 76% 58%;");
  });
});
