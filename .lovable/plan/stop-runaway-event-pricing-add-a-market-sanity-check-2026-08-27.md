# Stop runaway event pricing, add a market sanity check

## What is actually happening

Confirmed from the database for 18 Sep (Deluxe Queen, Hotel Ottofiori):

- The same event ("Ars Sacra Festival") raised the price on nearly every hourly run — 02:52, 04:02, 06:30, 07:22, 07:52, 10:52 — each time +€16 to +€21.
- No new bookings arrived between those runs. The event alone kept paying out, every hour, all day: €601 to €845 in one day.
- Your manual correction of −€300 at 08:52 was undone two hours later.

The reason is the safety caps: for all three properties `max_daily_increase_per_date` is set to **2000** and `maximum_increase` to **5000**. In euros those are not caps at all, so the hourly event step never hits a ceiling and simply compounds. A €165-class room ends up quoted at €845.

## The new pricing rules

**1. An event pays once, bookings pay the rest**

- A stay date receives its event uplift **once per day**, scaled by event impact (low / medium / high), not on every run.
- After that, the date can still rise during the day — but only when **new bookings actually land** for it. Pickup-driven increases stay exactly as they are today.
- The event uplift is re-evaluated the next business day, so a strong event keeps building over days instead of over hours.

**2. Real caps, in the property's own currency**

- Per-date daily ceiling becomes a meaningful number: a percentage of the current price (default 6%) **and** an absolute amount, whichever is smaller.
- Per-move ceiling likewise (default 5% of current price).
- Both stay editable in Automation settings, with the current absurd 2000/5000 values migrated down to sane defaults per property (EUR properties in EUR, SLNT in HUF).

**3. Manual edits win for an hour, then AI decides**

- Any hand-made price change locks that date for **1 hour** (unchanged from today's setting).
- After the hour, automation does not blindly re-raise. It asks the AI advisor with the full picture — your edit and its direction, current price, occupancy, pickup, days out, the event, and market rates — and the advisor answers keep / partially restore / resume normal pricing, with a written reason.
- That reason is stored and shown in the price history, so a re-raise after a manual markdown is always explained.

**4. Market ceiling — warning only**

- Every automated raise is compared to the market median for that date (from the competitor rates we already scrape).
- Nothing is blocked. When the new price lands above the configured multiple of market (default 1.4x), the cell is flagged "above market" in the grid and the history entry says so.

## Fixing today's inflated prices

Prices already inflated by the loop (18, 20, 25 Sep and similar event dates) are still live in Previo. After the rules ship, a one-off repair pass will pull each affected date back to the price it held before the compounding began, respecting the occupancy ladder, and record the correction in the history. You will see the list before it publishes.

## Technical notes

- `supabase/functions/revenue-pickup-automation/index.ts`: gate the event surcharge on a per-date, per-business-day ledger (existing `revenue_pickup_automation_actions` rows with `decision_reason = 'event_demand'`); keep spike/pickup paths unchanged; feed percentage-based caps into `strongDemandStep` and `eventSurcharge`.
- `supabase/functions/_shared/pricingRules.ts`: caps become `min(absolute, percent_of_current)`; add `eventAlreadyAppliedToday`.
- New AI call in the automation function for the post-hold manual-override decision, on the Lovable AI Gateway, with a hard timeout and a safe "keep the manual price" fallback if the model does not answer.
- Market comparison reuses the `market_rates_by_date` RPC; the flag is written on the action row and rendered by `RateStrategyGrid.tsx` / `RateCellHistory.tsx`.
- Migration: add `max_daily_increase_pct`, `max_increase_pct`, `event_uplift_once_per_day`, `market_ceiling_multiple`, `manual_override_ai_enabled` to `revenue_pickup_automation_rules`, and reset the 2000/5000 values.
- `PickupAutomationRules.tsx`: new "Event pricing" and "Market sanity" cards exposing the settings above.
