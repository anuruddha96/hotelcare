import { afterEach, describe, expect, it } from "vitest";
import {
  getRevenueCurrency,
  money,
  setDisplayCurrency,
  setRevenueCurrency,
  toBaseCurrency,
} from "@/lib/revenueCurrency";

describe("revenue currency preference", () => {
  afterEach(() => {
    setRevenueCurrency({ code: "EUR", eurRate: 1, eurRateSource: null, displayCode: "EUR" });
  });

  it("converts a foreign-currency hotel to EUR and converts edited values back to base", () => {
    setRevenueCurrency({ code: "HUF", eurRate: 400, eurRateSource: "manual", displayCode: "HUF" });

    setDisplayCurrency("EUR");

    expect(money(40_000)).toBe("€100");
    expect(toBaseCurrency(100)).toBe(40_000);
  });

  it("keeps the user's display choice when only the exchange rate is refreshed", () => {
    setRevenueCurrency({ code: "HUF", eurRate: 400, eurRateSource: "manual", displayCode: "EUR" });

    setRevenueCurrency({ code: "HUF", eurRate: 395, eurRateSource: "manual" });

    expect(getRevenueCurrency().displayCode).toBe("EUR");
    expect(money(39_500)).toBe("€100");
  });

  it("leaves EUR-base legacy hotels unchanged", () => {
    setRevenueCurrency({ code: "EUR", eurRate: 1, eurRateSource: null, displayCode: "EUR" });

    expect(money(125)).toBe("€125");
    expect(toBaseCurrency(125)).toBe(125);
  });
});
