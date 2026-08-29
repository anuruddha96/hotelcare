# Month chips + a full month in one screen

## What you get

Just above the rate & pickup calendar (right under the range buttons, close to the grid) a compact row of month chips: `Aug` `Sep` `Oct` … covering the horizon that is currently loaded. Clicking a month:

- filters the calendar to only that month's dates — no scrolling needed;
- automatically fits those days on screen so all 28–31 columns are visible in one snapshot;
- clicking the active chip again (or an `All` chip at the start of the row) returns to the normal continuous horizon and your previous zoom.

The chips show only months inside the selected range (14d…12m), so on `12m` you get the full Jan–Dec style strip, on `30d` just one or two.

## Fitting 31 days on screen

When a month is selected the grid measures its own width and picks a column width so the whole month fits:

- available width = scroll container width minus the sticky left label column;
- column width = available / number of days in that month, clamped to a legible minimum (roughly 34px); if the screen is too narrow (phones) it falls back to the minimum and the month still scrolls a little rather than becoming unreadable;
- the sticky left column also narrows in month mode to give the days more room.

Leaving month mode restores the user's saved zoom level exactly as before.

## Technical notes

All changes are in `src/components/revenue/RateStrategyGrid.tsx`:

- New state `monthFilter: string | null` (`YYYY-MM`), remembered per user with the existing `useUiPreference` pattern only for the session (not sticky across reloads, so the page still opens on "today").
- Month chip list derived from `allDates` (already computed from `days`), grouped by `YYYY-MM`, labelled with the short month name (+ year when the horizon crosses into the next year).
- `dates` memo gets one more predicate: `if (monthFilter && !d.startsWith(monthFilter)) return false;` — it sits alongside the existing `reviewOnly` / `pickupOnly` filters, so selection, drag-select and all row rendering keep working off `visibleDatesRef` unchanged.
- Fit-to-width: a `ResizeObserver`-backed measurement of `scrollRef` produces an effective `CELL_W` override while `monthFilter` is set; `ROW_H`, dot sizes and the left pane width derive from the same effective scale as they do today, so both panes stay pixel-aligned.
- On selecting a month the grid scrolls back to `scrollLeft = 0`.
- No data-loading change: months beyond the current range button simply aren't offered until the user widens the range.
