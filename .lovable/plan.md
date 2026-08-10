# Manual-change dots on price cells, mobile multi-day select, mobile cell history

## 1. Why the blue dot only shows on the date row

Checked the audit data. Rows in `rate_change_audit` by source:

```text
engine        29,211   (no room type / occupancy)
manual        26,211   (no room type / occupancy — alert engine)
bulk-editor    2,391   (has room type + occupancy)
push             962   (has room type + occupancy)  last: today 16:53
day-tool         741   (has room type + occupancy)  last: today 12:38
```

Since the day tool became "save and push in one action", the client no longer writes a
`day-tool` audit row when the user pushes — only the edge function's `push` row is written.
The cell dot is driven by `MANUAL_SOURCES` (`day-tool`, `cell-edit`, `pickup-board`), which
excludes `push`, so no dot appears on the cells. The date-row summary uses `source === "push"`,
which is exactly why the marker still shows there. That also explains "some rates have it, some
don't": the ones from before 12:38 (drafted then pushed) still carry a `day-tool` row.

Fix:
- The day tool logs its hand-made change with source `day-tool` in **both** modes (draft and
  push), before the push, so the marker is written regardless of how the user finishes.
- Same for the pickup-board re-price and the single-cell edit path (`cell-edit`), so every
  short-range manual action leaves a marker.
- Bulk editor keeps writing `bulk-editor` and still never marks cells.
- The dot marker also falls back to a `push` row when that date+room type+occupancy was touched
  by a short-range action (1–7 days in the same batch), so pushes already made today get their
  dots back without a backfill.

## 2. Multi-day selection on mobile (long-press + swipe)

Today the date header uses pointer drag with `touch-none`, and mobile users must first tap
"Select days". Long-press does nothing.

- Long-press (~350 ms) on any date header enters selection mode and selects that date, with a
  short haptic buzz where supported.
- Keeping the finger down and sliding left/right extends the selection across dates
  (touch-move hit-testing on the header cells, since pointerenter does not fire for touch).
- Lifting the finger keeps the selection and shows the floating "N days selected · Change prices"
  bar; further taps add/remove dates until the user leaves selection mode.
- Horizontal grid scrolling stays untouched until the long-press threshold passes, so ordinary
  swiping still scrolls.
- Desktop drag-to-select behaviour stays exactly as it is.

## 3. Tap a price cell on mobile to see its history

The cell history lives in a `HoverCard`, which never opens on touch; a tap opens the edit dialog
instead.

- On touch devices, tapping a price cell opens a bottom sheet titled
  `Room type · N guests · date` showing: current price, draft price if any, and the change list
  (old → new, +€/%, "Today 14:20 · Nuwan · Sent to Previo"), reusing `RateCellHistory`.
- The sheet has an "Edit price" button that opens the existing edit dialog, so pricing is still
  one extra tap away.
- Desktop keeps hover-to-preview and click-to-edit unchanged.
- Date-header history gets the same treatment on touch (long-press opens the day sheet with the
  header summary, short tap opens the change tool as now).

## Technical notes

- `src/components/revenue/RateStrategyGrid.tsx`: log `day-tool` in push mode; long-press +
  touchmove range selection on the header row; new touch cell-history sheet; `useIsMobile` gate
  so desktop paths are untouched.
- `src/hooks/useRateAudit.ts`: allow a `push` row to count as a manual marker when its batch
  spans 7 days or fewer, so today's direct pushes show dots.
- `src/components/revenue/PickupMovementBoard.tsx`: ensure the re-price action logs
  `pickup-board` before pushing.
- No database or edge-function changes; no changes to Ottofiori/SLNT-specific pricing logic.
