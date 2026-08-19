# One dot per date, and a full 12-month rate calendar

## 1. Date-row dots: show only the most recent change

Today the date header can show up to three dots (one per origin that touched any price on that date) — `headerOriginsByDate` in `RateStrategyGrid.tsx` keeps the three newest distinct origins. Since the per-cell dots and cell history already tell the full story, the header should carry a single dot: the newest change on that date.

Change:
- Header shows exactly one dot, coloured by the newest event across all cells of that date (team blue / automation purple / Previo orange / failed red).
- The date hover card keeps the full breakdown (e.g. "4 by your team, 2 by automation"), so nothing is lost.
- Legend copy updated to say the date dot reflects the latest change.

## 2. Rate & pickup calendar reaching 12 months

The calendar stops around mid-February because two limits line up:
- the grid's range picker maxes out at 180 days (`RANGE_OPTIONS`, and the auto-extend on scroll clamps to the same value);
- the data hook loads a 190-day horizon (`useRevenueHotelData`), and `previo-revenue-sync` defaults to 190 days when the page triggers a sync.

Change:
- Add `9m` (270) and `12m` (365) to the range picker; let the scroll auto-extend reach 365.
- Raise the data hook horizon to 365 days.
- Pass `horizonDays: 365` when the Revenue page and hotel-detail page invoke `previo-revenue-sync` (the function already accepts up to 400), so Previo prices for March onwards are pulled and stored.
- Dates with no price in Previo keep rendering as empty cells, exactly as they do now.

### Performance guard
Twelve months roughly doubles the rows the page loads. To keep the grid responsive:
- default range stays 30 days on mobile / 180 on desktop — the long horizon is opt-in via the picker and remembered per user;
- the existing paged fetches already handle the larger volume; the marker fetch (`rate_cell_markers`) is already paged to 25k rows and covers the wider range without change.

## Technical notes
- `src/components/revenue/RateStrategyGrid.tsx`: `headerOriginsByDate` returns a single newest origin; range options and auto-extend cap.
- `src/hooks/useRevenueHotelData.ts`: `horizonDays` default 190 → 365.
- `src/pages/Revenue.tsx` and `src/pages/RevenueHotelDetail.tsx`: pass `horizonDays: 365` to `previo-revenue-sync`.
- No database or pricing-logic changes.
