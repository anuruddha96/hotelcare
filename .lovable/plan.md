# Make the market intelligence chart readable, and fix the comparison numbers

## What I found in the data

- **Competitor lines stop early because the data stops early.** Ottofiori's competitor prices only exist from today to roughly 25 Sep (12 competitors, 5-30 nights each). Drawing them on a 90d/6m canvas makes them look broken. Nothing is being cut by the chart — the scan only covers ~30 nights.
- **Colours repeat.** There are only 8 competitor colours for 12+ competitors, and the sister-hotel occupancy lines reuse the same palette, so several series are literally the same colour.
- **The comparison tiles compare unequal windows.** For 2026-08 the stored daily snapshots start on different days per property: Ottofiori has 27 nights (from 5 Aug), Gozsdu / Memories / Mika have 21 nights (from 11 Aug). Each tile divides sold by available over only the nights it happens to have, so "Ottofiori 97% in August" is really "97% over 5-31 Aug as captured", and the four tiles are not measuring the same period. That is the inaccuracy you spotted.
- Side finding: the SLNT tile computes an ADR of ~25,186 because HUF revenue is not converted to EUR in that snapshot path.

## 1. Fix the comparison card

- Compute every tile over **one identical date window**: the overlap of the selected month with the nights all compared properties actually have snapshots for. Properties missing that window are shown as "no data" instead of a wrong percentage.
- Print the window under the tiles, e.g. `2026-08 · 11-31 Aug (21 nights) · same window for all properties`, so a partial month is never read as a full month.
- Skip nights with zero available rooms from both numerator and denominator.
- Convert HUF-based revenue to EUR before ADR/RevPAR so SLNT stops showing 25,186.
- Keep the open property's tile on the same snapshot source it uses now, so the numbers match wherever you open them from.

## 2. Make the chart simple to read

- **Fewer things at once.** Default view: net pickup bars + occupancy + market average only. Everything else stays available but off by default.
- **One series, one colour, always.** Replace the 8-colour list with a generated palette that gives each competitor and each sister hotel a distinct hue, and force sister hotels onto a visually separate style (dashed) from competitors (solid) so the two groups never look alike.
- **Honest coverage.** Competitor and market series are drawn only where data exists (no connecting across gaps), and the chart shows a light "no competitor data beyond <date>" marker so a stopping line reads as missing data, not as a price drop.
- **Range and data length agree.** When a range longer than the competitor coverage is picked, the competitor group is greyed in the series picker with its coverage stated (e.g. "prices to 25 Sep"), instead of silently drawing 30 of 90 nights.
- **Legend becomes a compact grouped picker** (Ours / Market / Competitors / Our hotels) with counts, replacing the four-row wall of struck-through labels.

## 3. Mobile

- Default to 30 nights, at most 4 visible series, and a horizontally scrollable single-row legend of only the series currently on.
- Larger tap targets on the range and series controls; the series sheet opens full-height on a phone.
- Keep the existing pinch-zoom / drag-pan behaviour and the tooltip suppression during gestures.
- Comparison tiles stack 2-up on a phone with the window label visible.

## Technical notes

- `src/components/revenue/MarketIntelligenceChart.tsx`: window-aligned `comparisonSummary`, palette generation, series defaults, coverage detection from `useMarketRates`, grouped legend, mobile branches via `useIsMobile`.
- `src/hooks/useMarketRates.ts`: expose per-competitor and overall coverage end date so the chart can state it.
- Presentation and calculation inside the chart only; no schema changes, no change to how snapshots or competitor scans are produced.
