# Cut OpenAI spend: make AI usage sustainable

## What I measured (today, live data)

- **Competitor rate scan is the main cost driver.** 37 active competitor hotels across 3 properties. It runs daily and asks for 60 nights per competitor in 10-night chunks, each chunk a `gpt-4o` request with the **web search tool** (the expensive part), plus a retry on empty answers and a second "fill the blanks" pass. Today alone: **80 scan requests, 2,640 date-questions, 1,262 prices captured** — and that was a partial day. A full daily sweep is roughly 220-350 web-search requests/day.
- **Event hunting is second.** `demand-events-auto` walks **12 months ahead for every market, every day**, with `gpt-4.1` and `search_context_size: "high"` (the most expensive search setting). 6-16 searches/day observed, re-finding events that barely change week to week.
- **Pricing automation calls the AI advisor every 10 minutes.** Two `gpt-4o-mini` calls per hotel evaluation (delta softening + manual-override review). Cheap per call, but ~150-300 calls/day of low value — the deterministic rules already decide the price.
- **Small/irrelevant:** assistant chat (8 messages in 7 days), RM intelligence (0 runs in 7 days), translations, invoice OCR, monthly quotes. Not worth touching.

## The fix

### 1. Competitor scan — same insight, a fraction of the cost
- **Weekly instead of daily** by default (Monday early morning), with the manual "Scan prices" button unchanged for on-demand refresh.
- **Tiered horizon:** next 14 nights scanned on the weekly run; days 15-60 scanned only every other run. Far-out competitor rates barely move.
- **Bigger chunks, fewer requests:** 20 nights per request instead of 10, drop the third "blank fill" pass, keep at most one retry.
- **Cheaper model + search setting:** `gpt-4o-mini` with `search_context_size: "low"` for the routine sweep; keep `gpt-4o` only for the manual button.
- **Skip stale-free work:** a competitor already scanned within the freshness window is skipped entirely.
- Expected: from ~250 search calls/day to ~40 per week for the same decision quality.

### 2. Event hunting — stop re-searching what we already know
- Run **weekly**, not daily.
- Scan **3 months ahead per run** on a rotating window (months 1-3 this week, 4-6 next, etc.) so the 12-month horizon still gets covered monthly.
- `search_context_size: "medium"` instead of "high".
- Skip a market+month that was already searched within 30 days unless someone presses "Find events".

### 3. Pricing automation advisor — off by default
- The AI "softening" call adds no guardrail the deterministic rules don't already enforce, so it becomes **opt-in per property** and is **off by default**.
- The manual-override review keeps working but is **only called when there actually are expired manual holds to judge** (today it is invoked as part of the normal loop), and when the advisor is off it defaults to respecting the manager's price — the current safe fallback.

### 4. A spend guard so this can't happen again
- New `ai_usage_log` row per OpenAI call (function, model, tokens, estimated USD, whether web search was used).
- **Daily budget cap per organisation** (default $5/day, configurable in Admin). When the cap is hit, non-interactive jobs (competitor scan, event sweep, automation advisor) stop for the day; user-initiated actions still run and show a clear "AI budget for today is used up" message.
- **Admin panel: "AI usage & budget"** — spend today/this month, breakdown by feature, and switches for competitor scan frequency, event sweep frequency and the automation advisor.

## Technical notes

- `competitor-rate-scan`: `CHUNK_DAYS` 10 → 20, tiered horizon, model/search-context by trigger (`cron` vs `manual`), remove the second blank-fill pass, freshness skip via `competitor_properties.last_scan_at`. Cron `competitor-rate-scan-daily` → `25 5 * * 1` (weekly), renamed.
- `_shared/eventSearch.ts`: context size `medium`; `demand-events-auto` `MONTHS_AHEAD` 12 → rotating 3-month window, cron → weekly; dedupe against `demand_event_search_runs` within 30 days.
- `revenue-pickup-automation`: `aiScaleDeltas` gated behind new rule column `ai_advisor_enabled` (default `false`); `aiReviewManualOverrides` only invoked when cases exist.
- New table `ai_usage_log` + `ai_budget_settings` (per organisation, GRANTs + RLS scoped to `organization_slug`), a shared `logAiCall()` / `withinBudget()` helper in `_shared/aiBudget.ts` used by every OpenAI call site.
- New `AiUsagePanel.tsx` in the admin area; `AiProviderStatus.tsx` extended to read from `ai_usage_log` instead of only `rm_analysis_runs`.

## Order

1. Competitor scan + event sweep frequency and model changes (immediate, biggest saving).
2. Automation advisor off by default.
3. Usage logging, budget cap and admin panel.
