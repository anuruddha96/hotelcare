# Ottofiori pickup fix + an events-aware demand engine

## 1. Why Ottofiori shows no pickup (verified)

Two separate things are true today:

- **There genuinely were no new bookings today.** Ottofiori has 0 room-nights created today (yesterday: 49). So the "new bookings" side of pickup is correctly empty.
- **The losses are invisible.** Previo's pick-up report shows **-25** for today, but the `revenue_cancelled_nights` table is **completely empty for every property**. The sync tries four different spellings of the Previo cancelled/no-show filter and all of them come back with nothing — the property config has recorded "no working variant" for status 7 and 8 on Ottofiori, Gozsdu, Mika and Memories. Result: pickup can never go negative, so a day that lost 25 room-nights reads as a flat 0.

### Fix

1. **Disappearance-based losses (primary, no Previo dependency).** Every sync already replaces the full booking-night set for the horizon. Before replacing, diff the incoming set against the stored one: any `reservation + room + stay date` that was there before and is gone now is a lost room-night. Write those into `revenue_cancelled_nights` with the sync timestamp as the loss time. This reproduces Previo's -25 without needing the status filter to work.
2. **Keep the Previo status probe as a second source**, and add the two remaining spellings Previo uses (`<statusIds>7,8</statusIds>` and a `dateCanc` range query). When it does return rows, they win over the diff (more accurate cancellation timestamp).
3. **Surface it in the UI**: the pickup row already colours negative values blue; add a "-25 lost" figure to the pickup summary and the day detail so a losing day is never displayed as "no movement".

## 2. Automation tuned to how you want to sell

Ottofiori today runs: near-term window 30 days, strong-demand increase €30, high-occupancy gate 40%, min ADR €80, auto-publish on.

Changes:

- **0-14 days = "sell it now" window.** A new immediate window (default 14 days, configurable) where the goal is conversion: no increases unless the day is genuinely tight, markdown allowed every cycle down to the floor price, and a slightly larger step so a stale day actually moves. Sold-out and short-window guards stay in place.
- **15+ days = protect and build rate.** Increases only from real evidence: pickup in the window, or the new demand-spike signal below.
- **Demand-spike detection (your 5-10% rule).** For every stay date beyond the immediate window, compare occupancy now against occupancy N days ago (from the daily snapshots). A rise of 5% or more with no matching rise across the rest of the month is flagged as a spike. A spike (a) shows as a badge on the day, (b) triggers an event lookup for that date, and (c) unlocks a bounded increase.
- **Event surcharge.** A day with a confirmed high-impact event gets an extra surcharge on top of the normal step, capped by the existing max-increase and min/max price limits. Default is **suggest, do not auto-apply** — you approve it from the calendar; a per-property switch can make it automatic.

## 3. Events calendar

A proper events system replacing the empty `market_events` table:

- **Location is configurable**: country + city per property (Budapest as the default for the existing hotels), so any city in the world works.
- **Manual entry**: title, date or date range, category, venue, expected impact, notes, and a **"repeats every year"** flag. Recurring events are automatically projected onto future years and shown in the calendar.
- **AI search on demand**: pick a month, press "Find events", and the assistant returns real demand-driving events for that city (concerts, festivals, sport, conferences, public holidays, school breaks) with impact and confidence. Results land in a review list — you tick the ones to keep, so nothing invented ever reaches pricing. Runs against your OpenAI key, which is already configured.
- **Access**: currently admin-only in practice; opens up to **top management** (read plus manage), still isolated per organisation.

## 4. Where you see it

In the **Rate & pickup calendar**, the Demand row becomes predictive rather than descriptive:

- an event chip on any date that has one (with a repeat marker for annual events),
- a spike badge when occupancy is running ahead of pace,
- the demand cell tooltip explains *why*: "Occupancy +7% in 5 days · Sziget Festival (high impact) · rate held below event pricing".
- A new **Events** panel next to the calendar lists the month's events, allows manual add/edit/delete, and hosts the "Find events with AI" button and the city selector.

Pricing decisions caused by an event or spike say so in the cell history, in the same plain language as the existing automation reasons.

## Technical notes

- `previo-revenue-sync`: pre-replacement diff to derive lost room-nights; two extra cancel-filter spellings; write losses to `revenue_cancelled_nights`.
- New table `demand_events` (org + hotel scoped, city/country, `recurs_annually`, `source` manual/ai, `confidence`, `approved`), with grants for `authenticated` and `service_role`, RLS limited to admin and top management within the organisation. `market_events` stays as the raw AI cache.
- New edge function `demand-events-search` (OpenAI, strict tool schema, month + city input, returns candidates only — no auto-write into pricing).
- `revenue_pickup_automation_rules`: new columns `immediate_window_days`, `immediate_markdown_step`, `spike_detection_enabled`, `spike_threshold_pct`, `spike_lookback_days`, `event_surcharge_eur`, `event_surcharge_auto`.
- `_shared/pricingRules.ts`: `immediateWindowDecision()`, `detectDemandSpike()`, `eventSurcharge()` — all pure, with unit tests in `src/lib/smartPricing.test.ts`.
- UI: `EventsPanel.tsx` + event/spike chips in `RateStrategyGrid.tsx`; new controls in `PickupAutomationRules.tsx`. Ottofiori and RD Hotels/SLNT behaviour stays per-property — defaults are off for spike surcharge until you enable it.

## Suggested order

1. Cancellation/loss capture (makes pickup honest again) — highest value, smallest risk.
2. Immediate-window selling rules for 0-14 days.
3. Events table, manual entry, calendar chips, top-management access.
4. AI event search with review-before-save.
5. Spike detection and event surcharge feeding the automation.
