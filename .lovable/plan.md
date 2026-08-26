# Final-7-day sell-down rule + a working competitor rate watch

## 1. Last 7 days = sell, never protect rate

Today the automation has an "immediate selling window" (14 days on Ottofiori). Inside it, a date that is not tight gets marked down — but nothing stops the other passes from *raising* the price: the pickup surge pass, the event surcharge and the far-out top-up can all lift a date that is three days out.

Add a distinct **final sell-down window** matching your cancellation policy:

- New setting **"Final sell-down window"**, default **7 days**, with an on/off switch (per property, so RD Hotels and SLNT can differ).
- Inside the window:
  - Markdown runs **every cycle** while rooms remain, down to the floor price — no "demand looks healthy" pause, no lead-band step shrinking.
  - **All increases are blocked** — event surcharge, demand spike, far-out top-up and ordinary pickup steps.
  - Two exceptions, both configurable:
    1. **Abnormal pickup** — the date picked up at least N room-nights (default: your existing abnormal-pickup threshold) inside the observation window. Then a normal increase is allowed.
    2. **Very special event** — only an event marked **high impact** (and only when event surcharge is switched to automatic) may raise the price. Medium/low-impact events are ignored in these 7 days.
  - Sold-out dates are untouched, as now.
- The pricing-activity entry says why in plain language: "3 days to arrival, 4 rooms left — reduced by €5 to sell the remainder (final 7-day window)" or "held/raised: 6 room-nights picked up in the last 48h".

This directly addresses the "prices going very high on event dates" complaint for near dates; further out, events keep working as they do now.

## 2. Competitor rate watch that actually runs

What is happening now: the scan works, but only partly. Today's scan captured prices for **1 of the 6 watched hotels** — the model is asked for 30 dates for each hotel one after another in a single request, and most attempts return nothing or time out. There is also **no schedule**: prices are only ever captured when someone presses "Scan prices".

Changes:

- **Daily automatic scan** (cron, early morning) for every property that has competitors configured, plus the manual button for an on-demand refresh.
- **Reliable capture**: split each competitor into small date chunks (about 10 dates per request) instead of one 30-date request, retry once on an empty result, and record per-competitor outcome (captured / not found / failed) so the panel can show "last scanned 06:15 · 4 of 6 hotels".
- **Slug/UUID handling** so a hotel opened by slug (the normal route) is accepted — the same fix already applied to competitor discovery.
- **Errors are shown**, not swallowed: if the scan fails for a hotel, the panel says which one and why.

## 3. Comparison view

Replace the current text-only "You against the set" with a chart plus a table:

- **Line chart** over the next 30-60 days: our rate, the competitor-set average, and the set's min/max as a shaded band.
- Toggleable line **per competitor**, so you can single out one hotel.
- A **"Compare with our hotels"** switch that adds the other properties in the same organisation (Ottofiori / Gozsdu / Mika / Memories, or the SLNT venues) as extra lines, read from the same rate data the portfolio comparison already uses — strictly inside your own organisation.
- Under the chart, a compact table: date, our rate, set average, difference in % and currency, cheapest/most expensive competitor for that date.
- Dates where we are more than X% above the set are highlighted, so an over-priced event date is visible at a glance.

## Technical notes

- `revenue_pickup_automation_rules`: new columns `final_window_enabled`, `final_window_days` (default 7), `final_window_allow_event_increase`, `final_window_abnormal_pickup_rooms`.
- `_shared/pricingRules.ts`: new pure `finalWindowDecision()` returning `{ inWindow, forceMarkdown, allowIncrease, reason }`; unit tests in `src/lib/smartPricing.test.ts`. Wired into `revenue-pickup-automation` at the markdown pass, the surge/pickup pass, the spike/event pass and the far-out top-up pass.
- `PickupAutomationRules.tsx`: a "Final sell-down window" card with the days, the exceptions and worked-example hints.
- `competitor-rate-scan`: slug resolution, chunked prompts, per-competitor result rows; new `competitor_scan_runs` table (or a status column on `competitor_properties`) for last-run reporting; pg_cron job `competitor-rate-scan-daily`.
- `CompetitorRatePanel.tsx`: recharts comparison chart, per-competitor toggles, sibling-hotel overlay via the existing portfolio snapshot RPC, plus the difference table.

## Suggested order

1. Final-7-day sell-down rule (highest operational value).
2. Competitor scan reliability + daily cron.
3. Comparison chart, per-competitor toggles and own-hotel overlay.
