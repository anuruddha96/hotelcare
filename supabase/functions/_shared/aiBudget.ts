// Shared AI spend guard.
//
// Every paid OpenAI call the app makes should ask this module two questions:
//   1. Are we still inside the organisation's budget? (`checkAiBudget`)
//   2. What did that call cost?                       (`logAiUsage`)
//
// Costs are estimates, not invoices — enough to see which feature is spending
// and to stop a runaway loop before it empties the account.

type Admin = {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
};

/** USD per 1M tokens, input/output. Rough public list prices. */
const TOKEN_PRICES: Record<string, { in: number; out: number }> = {
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
};

/** USD per web-search tool call, by search context size. */
const SEARCH_PRICES: Record<string, number> = { low: 0.025, medium: 0.0275, high: 0.03 };

export function estimateAiCost(opts: {
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  webSearches?: number;
  searchContext?: "low" | "medium" | "high";
}): number {
  const price = TOKEN_PRICES[String(opts.model ?? "")] ?? TOKEN_PRICES["gpt-4o-mini"];
  const tokens =
    ((opts.inputTokens ?? 0) / 1_000_000) * price.in +
    ((opts.outputTokens ?? 0) / 1_000_000) * price.out;
  const search = (opts.webSearches ?? 0) * (SEARCH_PRICES[opts.searchContext ?? "medium"] ?? 0.0275);
  return Number((tokens + search).toFixed(5));
}

export interface BudgetState {
  allowed: boolean;
  reason: string | null;
  spendToday: number;
  spendMonth: number;
  dailyBudget: number;
  monthlyBudget: number;
}

/**
 * Is this organisation still allowed to spend on AI today? Failing open would
 * defeat the point of a cap, so a broken lookup blocks scheduled work and lets
 * on-demand work through (a human is waiting for it).
 */
export async function checkAiBudget(
  admin: Admin,
  organizationSlug: string | null,
  opts: { scheduled?: boolean } = {},
): Promise<BudgetState> {
  const fallback: BudgetState = {
    allowed: !opts.scheduled,
    reason: opts.scheduled ? "AI budget could not be read; scheduled run skipped." : null,
    spendToday: 0, spendMonth: 0, dailyBudget: 0, monthlyBudget: 0,
  };
  try {
    const { data, error } = await admin.rpc("ai_spend_snapshot", { _org: organizationSlug });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) return fallback;
    const spendToday = Number(row.spend_today ?? 0);
    const spendMonth = Number(row.spend_month ?? 0);
    const dailyBudget = Number(row.daily_budget ?? 0);
    const monthlyBudget = Number(row.monthly_budget ?? 0);
    const overDaily = dailyBudget > 0 && spendToday >= dailyBudget;
    const overMonthly = monthlyBudget > 0 && spendMonth >= monthlyBudget;
    return {
      allowed: !overDaily && !overMonthly,
      reason: overDaily
        ? `Daily AI budget reached ($${spendToday.toFixed(2)} of $${dailyBudget.toFixed(2)}).`
        : overMonthly
          ? `Monthly AI budget reached ($${spendMonth.toFixed(2)} of $${monthlyBudget.toFixed(2)}).`
          : null,
      spendToday, spendMonth, dailyBudget, monthlyBudget,
    };
  } catch {
    return fallback;
  }
}

/** Are the automatic sweeps switched on for this organisation? */
export async function aiFeatureEnabled(
  admin: Admin,
  organizationSlug: string | null,
  column: "competitor_scan_enabled" | "event_sweep_enabled",
): Promise<boolean> {
  if (!organizationSlug) return true;
  try {
    const { data } = await admin
      .from("ai_budget_settings")
      .select(column)
      .eq("organization_slug", organizationSlug)
      .maybeSingle();
    if (!data) return true; // no row yet = defaults, which are on
    return Boolean((data as Record<string, unknown>)[column]);
  } catch {
    return true;
  }
}

/** Record what a call cost. Never throws: logging must not break a feature. */
export async function logAiUsage(
  admin: Admin,
  entry: {
    organizationSlug?: string | null;
    hotelId?: string | null;
    functionName: string;
    model?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    webSearches?: number;
    searchContext?: "low" | "medium" | "high";
    ok?: boolean;
    error?: string | null;
    costUsd?: number;
  },
): Promise<void> {
  try {
    await admin.from("ai_usage_log").insert({
      organization_slug: entry.organizationSlug ?? null,
      hotel_id: entry.hotelId ?? null,
      function_name: entry.functionName,
      model: entry.model ?? null,
      input_tokens: entry.inputTokens ?? 0,
      output_tokens: entry.outputTokens ?? 0,
      web_searches: entry.webSearches ?? 0,
      estimated_cost_usd: entry.costUsd ?? estimateAiCost(entry),
      ok: entry.ok ?? true,
      error: entry.error ?? null,
    });
  } catch (e) {
    console.error("logAiUsage failed", e);
  }
}
