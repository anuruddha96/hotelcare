import { afterEach, describe, expect, it } from "vitest";
import { convert, getRevenueCurrency, setRevenueCurrency, toBaseCurrency } from "./revenueCurrency";

afterEach(() => {
  setRevenueCurrency({ code: "EUR", eurRate: 1, displayCode: "EUR" });
});

describe("editable revenue currency conversion", () => {
  it("round-trips HUF base values through an EUR display", () => {
    setRevenueCurrency({ code: "HUF", eurRate: 400, displayCode: "EUR" });

    expect(convert(40_000)).toBe(100);
    expect(toBaseCurrency(100)).toBe(40_000);
  });

  it("leaves values unchanged when display and base currency match", () => {
    setRevenueCurrency({ code: "HUF", eurRate: 400, displayCode: "HUF" });

    expect(convert(40_000)).toBe(40_000);
    expect(toBaseCurrency(40_000)).toBe(40_000);
  });

  it("refuses EUR conversion when a foreign-currency rate is unavailable", () => {
    setRevenueCurrency({ code: "HUF", eurRate: null, displayCode: "EUR" });

    // setRevenueCurrency falls back to HUF when EUR cannot be trusted.
    expect(convert(40_000)).toBe(40_000);
    expect(toBaseCurrency(40_000)).toBe(40_000);
  });

  it("keeps the selected display currency when only the exchange rate changes", () => {
    setRevenueCurrency({ code: "HUF", eurRate: 400, displayCode: "EUR" });

    setRevenueCurrency({ code: "HUF", eurRate: 395, eurRateSource: "manual" });

    expect(getRevenueCurrency().displayCode).toBe("EUR");
    expect(convert(39_500)).toBe(100);
  });
});
