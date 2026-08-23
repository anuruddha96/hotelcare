# Make the Revenue header show correct numbers on the first paint

## What actually happens today

Opening a property paints in stages, and the header presents every stage as if it were final:

1. The data hook first fetches only 60 days, then re-fetches the whole 190-day horizon, then again up to 365 days when the grid grows. Each stage refetches **everything from day 0**, not just the new days.
2. `buildDayMetrics` creates a row for every date in the requested range, even dates that have no snapshot, no rates and no nights yet. So a month that simply has not been synced yet aggregates to real-looking zeros — `0%`, `ADR —`, `RevPAR €0` — instead of reading as "still loading" (visible in the screenshot for Nov/Dec/Jan).
3. The month tiles' "pending" guard only triggers when a month has **no rows at all**, which is never true once the range covers it — so the guard never fires and the zeros are shown as facts.
4. The automatic Previo sync starts 1.2s after paint and takes ~40s. When it lands, `load()` + `live.reload()` rewrite the numbers. Nothing on screen says the figures are from the last sync and are being refreshed, so the change reads as "the app first showed wrong data".

## Changes

1. **Never show a zero for a month that has no data yet**
   - Mark a month as *pending* when its dates carry no evidence at all (no snapshot capture, no booking nights, no rates) — not merely when there are no metric rows.
   - Pending months render the existing shimmer tile plus a short "loading these dates" caption, both in the selected-month KPI strip and in the 6-month outlook row.
   - A month with real data but genuinely zero sales still shows `0%` — the distinction is evidence, not value.

2. **Say plainly when figures are being refreshed**
   - Pass the running sync state into the month header. While a refresh is in flight, keep the current numbers visible but add a small "as of HH:MM · refreshing" line under the heading and a soft pulse on the tiles, so the later change is expected rather than a correction.
   - When the refresh finishes, animate the tiles' value change (short fade/count-in) instead of a hard swap.

3. **Cut the redundant refetches (faster, and less backend load)**
   - Make the horizon growth incremental: after the 60-day first paint, fetch only the *new* date range and merge it into the existing arrays, instead of re-reading days 0–60 two more times.
   - Keep the single shared in-flight guard so a horizon growth and a sync-triggered reload never issue two identical query groups.
   - Prioritise the selected month: when the user picks a month outside the loaded window, that month's range is fetched first, before the rest of the horizon.

4. **Keep the opening cover honest**
   - Unchanged behaviour: cached data paints immediately, the thin top bar shows background work, the cover gives up after its ceiling.

## Technical notes

- `src/hooks/useRevenueHotelData.ts`: incremental range fetch + merge on horizon growth; expose a `coveredThrough` (last stay date with actual synced evidence) and a per-month evidence set derived from snapshots/nights/rates.
- `src/lib/revenueAnalytics.ts`: have `buildDayMetrics` flag each day as `hasData` so the header can distinguish "no data yet" from "zero sold".
- `src/components/revenue/MonthPerformanceHeader.tsx`: use the evidence flag for `isMonthPending`, add the "as of … refreshing" caption and value-change transition; accept a `refreshing` prop.
- `src/pages/RevenueHotelDetail.tsx`: pass `syncing` into the header.
- No database, Edge Function, Previo, tenant-isolation or pricing changes. No extra API calls — the incremental fetch strictly reduces query volume.

## Validation

- Cold open shows August's real occupancy/ADR/RevPAR on the first painted frame, with unsynced later months shimmering rather than showing `0%`.
- During the ~40s Previo sync the header reads "as of <time> · refreshing"; when it lands the values transition smoothly.
- Scrolling the calendar to 6/9/12 months still loads dates, without re-reading the first 60 days.
