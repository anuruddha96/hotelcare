import { describe, expect, it } from "vitest";
import { aggregatePortfolio, type PortfolioAccount, type PortfolioMapping } from "./googleAdsPortfolio";

const start = "2026-11-01", end = "2026-11-02";
const allocation = (venueId: string, basisPoints = 10000) => ({ venueId, basisPoints });
const row = { date: start, campaignId: "1", name: "Search", status: "ENABLED", channel: "SEARCH", costMicros: 10_000_000, impressions: 100, clicks: 10, conversions: 2, conversionValue: 50 };
const budget = { id: "1", name: "Daily", campaignId: "1", campaignName: "Search", period: "DAILY", amountMicros: 5_000_000 };
const account = (accountId: string, currency = "HUF"): PortfolioAccount => ({
  accountId, currency, rows: [row], budgets: [budget], coverage: [{ start_day: start, end_day: end }],
});
const empty: PortfolioMapping = { accountDefaults: new Map(), campaignOverrides: new Map() };

describe("Google Ads Phase 3 portfolio aggregation", () => {
  it("does not collide campaign or budget identifiers across accounts and separates currencies", () => {
    const result = aggregatePortfolio([account("a"), account("b"), account("c", "EUR")], empty, start, end);
    expect(result.currencies.find(c => c.currency === "HUF")).toMatchObject({
      metrics: { costMicros: 20_000_000, clicks: 20 }, dailyBudgetMicros: 10_000_000,
      sharedOrUnmappedDailyBudgetMicros: 10_000_000,
    });
    expect(result.currencies.find(c => c.currency === "EUR")).toMatchObject({
      metrics: { costMicros: 10_000_000 }, dailyBudgetMicros: 5_000_000,
    });
    expect(result.complete).toBe(true);
    expect(result.venues.every(v => v.venueId === null)).toBe(true);
  });

  it("uses explicit campaign overrides rather than inferring a venue from a campaign name", () => {
    const mapping: PortfolioMapping = {
      accountDefaults: new Map([["a", [allocation("hotel")]]]),
      campaignOverrides: new Map([["a", new Map([["1", [allocation("brunch")]]])]]),
    };
    const source = account("a");
    source.rows.push({ ...row, campaignId: "2", costMicros: 3_000_000 });
    source.budgets.push({ ...budget, campaignId: "2", id: "2" });
    const result = aggregatePortfolio([source], mapping, start, end);
    expect(result.venues.find(v => v.venueId === "brunch")).toMatchObject({
      metrics: { costMicros: 10_000_000 }, dailyBudgetMicros: 5_000_000,
    });
    expect(result.venues.find(v => v.venueId === "hotel")).toMatchObject({
      metrics: { costMicros: 3_000_000 }, dailyBudgetMicros: 5_000_000,
    });
  });

  it("keeps explicitly split attribution estimated and does not multiply shared budgets", () => {
    const mapping: PortfolioMapping = {
      accountDefaults: new Map([["a", [allocation("hotel", 6000), allocation("brunch", 4000)]]]),
      campaignOverrides: new Map(),
    };
    const source = account("a");
    source.budgets.push({ ...budget, campaignId: "2" });
    const result = aggregatePortfolio([source], mapping, start, end);
    expect(result.usesEstimatedAllocation).toBe(true);
    expect(result.venues.find(v => v.venueId === "hotel")?.metrics.costMicros).toBe(6_000_000);
    expect(result.venues.find(v => v.venueId === "brunch")?.metrics.costMicros).toBe(4_000_000);
    expect(result.currencies[0]).toMatchObject({ dailyBudgetMicros: 5_000_000, sharedOrUnmappedDailyBudgetMicros: 5_000_000 });
    expect(result.venues.every(v => v.dailyBudgetMicros === 0)).toBe(true);
  });

  it("deduplicates a shared daily budget assigned wholly to one venue", () => {
    const source = account("a");
    source.budgets.push({ ...budget, campaignId: "2" });
    const result = aggregatePortfolio([source], {
      ...empty, accountDefaults: new Map([["a", [allocation("hotel")]]]),
    }, start, end);
    expect(result.venues[0].dailyBudgetMicros).toBe(5_000_000);
    expect(result.currencies[0].sharedOrUnmappedDailyBudgetMicros).toBe(0);
  });

  it("distinguishes an empty verified day from an unsynchronized or absent report", () => {
    const source = { ...account("a"), rows: [], budgets: [] };
    expect(aggregatePortfolio([source], empty, start, end).complete).toBe(true);
    expect(aggregatePortfolio([{ ...source, coverage: [] }], empty, start, end).complete).toBe(false);
    expect(aggregatePortfolio([], empty, start, end).complete).toBe(false);
  });

  it("rejects duplicated rows, accounts, invalid allocations and conflicting shared budget data", () => {
    const source = account("a");
    expect(() => aggregatePortfolio([source, source], empty, start, end)).toThrow("INVALID_OR_DUPLICATE_PORTFOLIO_ACCOUNT");
    expect(() => aggregatePortfolio([{ ...source, rows: [row, row] }], empty, start, end)).toThrow("DUPLICATE_PORTFOLIO_ROW");
    expect(() => aggregatePortfolio([source], {
      ...empty, accountDefaults: new Map([["a", [allocation("hotel", 8000)]]]),
    }, start, end)).toThrow("INVALID_VENUE_ALLOCATION_TOTAL");
    expect(() => aggregatePortfolio([{ ...source, budgets: [budget, { ...budget, amountMicros: 1 }] }], empty, start, end)).toThrow("INCONSISTENT_SHARED_BUDGET");
  });
});
