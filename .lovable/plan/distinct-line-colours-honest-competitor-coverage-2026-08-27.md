# Distinct line colours, honest competitor coverage

## What I checked

- In `MarketIntelligenceChart.tsx`, the Occupancy line and the "This property rate" line are both drawn with `hsl(var(--primary))`, and Market average and Market median are both `hsl(var(--foreground) / 0.75)`. So three of the most important series share two colours — exactly what you saw.
- Competitor colours are generated on a golden-angle hue walk with no exclusion zone, so a competitor can land on the same blue/green as Occupancy, ADR or a sister hotel.
- Competitor data in the database right now (Ottofiori's set): 8 hotels captured 20-30 nights each, coverage stops at **25 Sept** (the scan only asks for 30 nights); 3 hotels failed with `gpt-4.1: no readable answer`; 1 returned `no_prices_found`.
- The "0 prices" badges in the Competitor rates drawer are wrong: they read `last_scan_prices` (the last run's count) instead of stored prices. Mystery Hotel shows "0 prices" while holding 12 usable future prices; NH Collection shows "0" while holding 13.
- 26 stored prices sit below the 0.45 confidence cut-off and are silently dropped from the chart.

## 1. One colour per series

- Fix a reserved palette for the fixed series so no two are alike: Occupancy (blue), ADR (green), City demand (violet), This property rate (amber/primary), Market average (solid dark), Market median (dashed grey), booked/cancelled bars unchanged.
- Generate competitor and sister-hotel hues from the golden-angle walk but **skip hue bands already used** by the fixed series, and keep the two groups visually separate (competitors solid thin, sister hotels dashed).
- Legend swatches read from the same single source as the lines, so a chip can never show a colour the line does not use.

## 2. Competitor coverage that is honest and wider

- **Wider window**: extend the scan from 30 nights to 60 nights (chunked, as now), so a 60d/90d chart is not drawn against 30 nights of data.
- **Retry failures**: a chunk that comes back "no readable answer" is retried once with a stricter, shorter prompt; only after the retry is the competitor marked failed.
- **Second pass for blanks**: after a run, re-ask only the dates a competitor left empty, so partial hotels fill in instead of staying at 0.
- **Correct counts in the drawer**: the badge shows stored future prices and coverage ("18 prices · to 25 Sept"), with the last run's status as a separate line, plus the failure reason when there is one.
- **Coverage stated on the chart**: the footnote already says where competitor prices end; it will also name how many of the watched hotels reported and link to the drawer when some failed.
- Low-confidence prices (<0.45) stay excluded from the lines and the market average, but the drawer states how many were held back so the gap is explainable rather than invisible.

## 3. Data accuracy check on the tiles

Comparison tiles keep the window alignment already in place; no calculation change is planned here unless the colour work uncovers a mismatch.

## Technical notes

- `src/components/revenue/MarketIntelligenceChart.tsx`: new `seriesPalette` module-level map, hue-exclusion in `competitorColor`, dashed stroke for sister hotels, legend driven from the palette.
- `supabase/functions/competitor-rate-scan/index.ts`: horizon 30 -> 60 nights, per-chunk retry, blank-date second pass, per-competitor run rows unchanged.
- `src/hooks/useMarketRates.ts`: expose stored future price count and per-competitor coverage end for the drawer badges.
- `src/components/revenue/CompetitorRatePanel.tsx`: badge shows stored prices + coverage + last run status/error.
