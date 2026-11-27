import { coversRange, ratios, sumMetrics, type AdsBudget, type AdsMetrics, type AdsRow } from "./googleAdsAnalytics";

export type PortfolioAccount = {
  accountId: string;
  currency: string;
  rows: AdsRow[];
  budgets: AdsBudget[];
  coverage: { start_day: string; end_day: string }[];
};
export type VenueAllocation = {
  venueId: string;
  /** Integer basis points; 10000 = 100%. Shared attribution must be explicit. */
  basisPoints: number;
};
export type PortfolioMapping = {
  accountDefaults: ReadonlyMap<string, readonly VenueAllocation[]>;
  campaignOverrides: ReadonlyMap<string, ReadonlyMap<string, readonly VenueAllocation[]>>;
};
type VenueSlice = {
  currency: string;
  venueId: string | null;
  metrics: AdsMetrics;
  dailyBudgetMicros: number;
};
type BudgetSlice = {
  currency: string;
  dailyBudgetMicros: number;
  sharedOrUnmappedDailyBudgetMicros: number;
};
const positiveId = (id: string) => typeof id === "string" && id.length > 0;
const keyOf = (...parts: string[]) => JSON.stringify(parts);

function validateAllocation(items: readonly VenueAllocation[]) {
  const seen = new Set<string>();
  let total = 0;
  for (const item of items) {
    if (!positiveId(item.venueId) || seen.has(item.venueId) || !Number.isInteger(item.basisPoints) || item.basisPoints <= 0 || item.basisPoints > 10000) {
      throw new Error("INVALID_VENUE_ALLOCATION");
    }
    seen.add(item.venueId);
    total += item.basisPoints;
  }
  if (items.length && total !== 10000) throw new Error("INVALID_VENUE_ALLOCATION_TOTAL");
}

function allocationsFor(mapping: PortfolioMapping, accountId: string, campaignId: string) {
  const items = mapping.campaignOverrides.get(accountId)?.get(campaignId) ??
    mapping.accountDefaults.get(accountId) ?? [];
  validateAllocation(items);
  return items;
}

function scaleMetrics(metrics: AdsMetrics, fraction: number): AdsMetrics {
  return {
    costMicros: metrics.costMicros * fraction,
    impressions: metrics.impressions * fraction,
    clicks: metrics.clicks * fraction,
    conversions: metrics.conversions * fraction,
    conversionValue: metrics.conversionValue * fraction,
  };
}

function checkRow(row: AdsRow, start: string, end: string) {
  if (!positiveId(row.campaignId) || row.date < start || row.date > end ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
    ![row.costMicros, row.impressions, row.clicks, row.conversions, row.conversionValue].every(Number.isFinite)) {
    throw new Error("INVALID_PORTFOLIO_ROW");
  }
}

/**
 * Pure aggregation of already authorized reports. Never a permission check.
 * Separate currencies. Account-scoped campaign/budget IDs. The unmapped bucket
 * retains spend without guessing the venue. Fractional allocations are
 * estimates, not measured per-venue conversions or invoice amounts.
 * Current Google daily budgets are attributed only when every reported enabled campaign
 * is fully assigned to the same venue; shared/ambiguous budgets stay separate.
 * Do not present partial coverage as complete or infer zero from absent data.
 */
export function aggregatePortfolio(
  accounts: readonly PortfolioAccount[],
  mapping: PortfolioMapping,
  start: string,
  end: string,
) {
  const dateOk = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (!dateOk(start) || !dateOk(end) || start > end) throw new Error("INVALID_PORTFOLIO_RANGE");
  for (const items of mapping.accountDefaults.values()) validateAllocation(items);
  for (const overrides of mapping.campaignOverrides.values()) {
    for (const items of overrides.values()) validateAllocation(items);
  }
  const seenAccounts = new Set<string>();
  const venueSlices = new Map<string, VenueSlice>();
  const currencyMetrics = new Map<string, AdsMetrics[]>();
  const budgetSlices = new Map<string, BudgetSlice>();
  const accountCoverage: { accountId: string; complete: boolean }[] = [];
  let usesEstimatedAllocation = false;
  function venue(currency: string, venueId: string | null) {
    const key = keyOf(currency, venueId ?? "");
    const value = venueSlices.get(key) ?? { currency, venueId, metrics: sumMetrics([]), dailyBudgetMicros: 0 };
    venueSlices.set(key, value);
    return value;
  }
  for (const account of accounts) {
    if (!positiveId(account.accountId) || seenAccounts.has(account.accountId) || !/^[A-Z]{3}$/.test(account.currency)) {
      throw new Error("INVALID_OR_DUPLICATE_PORTFOLIO_ACCOUNT");
    }
    seenAccounts.add(account.accountId);
    accountCoverage.push({ accountId: account.accountId, complete: coversRange(account.coverage, start, end) });
    const rows = new Set<string>();
    const totals = currencyMetrics.get(account.currency) ?? [];
    currencyMetrics.set(account.currency, totals);
    const budget = budgetSlices.get(account.currency) ?? {
      currency: account.currency, dailyBudgetMicros: 0, sharedOrUnmappedDailyBudgetMicros: 0,
    };
    budgetSlices.set(account.currency, budget);
    for (const row of account.rows) {
      checkRow(row, start, end);
      const key = keyOf(row.campaignId, row.date);
      if (rows.has(key)) throw new Error("DUPLICATE_PORTFOLIO_ROW");
      rows.add(key);
      totals.push(row);
      const allocations = allocationsFor(mapping, account.accountId, row.campaignId);
      if (allocations.length > 1) usesEstimatedAllocation = true;
      if (!allocations.length) {
        const slice = venue(account.currency, null);
        slice.metrics = sumMetrics([slice.metrics, row]);
      } else {
        for (const allocation of allocations) {
          const slice = venue(account.currency, allocation.venueId);
          slice.metrics = sumMetrics([slice.metrics, scaleMetrics(row, allocation.basisPoints / 10000)]);
        }
      }
    }
    const budgets = new Map<string, AdsBudget[]>();
    for (const item of account.budgets) {
      if (!positiveId(item.id) || !positiveId(item.campaignId) || !Number.isSafeInteger(item.amountMicros) || item.amountMicros < 0) {
        throw new Error("INVALID_PORTFOLIO_BUDGET");
      }
      const group = budgets.get(item.id) ?? [];
      if (group.some(b => b.amountMicros !== item.amountMicros || b.period !== item.period)) {
        throw new Error("INCONSISTENT_SHARED_BUDGET");
      }
      group.push(item);
      budgets.set(item.id, group);
    }
    for (const group of budgets.values()) {
      const first = group[0];
      if (first.period !== "DAILY") continue;
      budget.dailyBudgetMicros += first.amountMicros;
      const allocations = group.map(item => allocationsFor(mapping, account.accountId, item.campaignId));
      const firstVenue = allocations[0]?.[0]?.venueId;
      if (firstVenue && allocations.every(items => items.length === 1 && items[0].basisPoints === 10000 && items[0].venueId === firstVenue)) {
        venue(account.currency, firstVenue).dailyBudgetMicros += first.amountMicros;
      } else {
        budget.sharedOrUnmappedDailyBudgetMicros += first.amountMicros;
      }
    }
  }
  return {
    complete: accountCoverage.length > 0 && accountCoverage.every(a => a.complete),
    accountCoverage,
    usesEstimatedAllocation,
    currencies: [...currencyMetrics].map(([currency, rows]) => {
      const metrics = sumMetrics(rows);
      return { metrics, ratios: ratios(metrics), ...budgetSlices.get(currency)! };
    }),
    venues: [...venueSlices.values()].map(slice => ({ ...slice, ratios: ratios(slice.metrics) })),
  };
}
