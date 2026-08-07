# Revenue page: accurate pickup, clearer layout, simpler UI

## What I verified first

- `revenue_cancelled_nights` is **empty** (0 rows) — the sync never stores cancellations, so losses can only be seen by comparing snapshots.
- `revenue_daily_snapshots` holds only **3 capture days** (5, 6, 7 Aug), 191 stay dates each. Comparing today vs yesterday already produces correct negatives (e.g. 21 Aug 13 → 12, 22 Aug 14 → 13), so any pickup window longer than 3 days currently has no baseline and silently shows "no movement" instead of the real minus.
- The baseline lookup keeps the *first* snapshot row it meets for a stay date rather than the newest one at or before the comparison date, so the comparison point is not deterministic.

That combination is why the app shows plus-only pickup while Previo shows minus days.

## 1. Make pickup correct

- Fix the baseline selection to always use the **latest capture at or before the window start**, and align the window edges so "Yesterday + today" really compares against the close of the day before yesterday.
- Capture cancellations in the Previo revenue sync (cancelled/no-show reservation states) into `revenue_cancelled_nights`, so a lost room-night is attributed to the day it was cancelled, not just inferred.
- Keep the snapshot delta as the safety net, and take the more pessimistic of the two sources so a loss is never hidden.
- All bucketing (booking creation, cancellation, "today") stated and computed in **Budapest time**, with the timezone shown once in the header instead of on every card.
- Show an honest "baseline not available yet" note for windows longer than the snapshot history instead of implying zero movement.

## 2. Pickup & occupancy horizon chart

- Print the pickup number **on top of each bar** (+2, -1), hidden only on very narrow phone widths where bars overlap.
- Zero days stay a faint tick with no label, so real movement stands out.
- Keep the existing series toggles; tidy tooltip wording.

## 3. Layout order

Top of the page (decision-first):

```text
Month performance (occupancy, ADR, RevPAR, revenue, rooms left, pickup)
Today at a glance  (tonight's occupancy, ADR, RevPAR, sales so far)
Demand & rate outlook chart
Today's Sales & ADR Goal
Pickup & occupancy horizon
Rate & pickup calendar
--- advanced / technical, collapsed ---
AI recommendations, demand board, pulse, sync history
```

The month header gains a compact "today" strip so monthly and current-day figures are visible at the same time.

## 4. Pickup movement board (replaces the chip list)

The wrapped row of `08-07 +6` chips becomes a readable board:

- Three summary tiles: **Gained** (room-nights and value), **Lost** (room-nights and value), **Net**.
- A sortable list of moved dates: date, weekday, gained, lost, net, revenue effect, rooms left after the move.
- Tap a date to expand the individual bookings (time booked, room type, nightly rate) as today.
- Lost nights are only listed once cancellations are being captured; until then the row shows the net snapshot loss and says the detail is pending the next sync.

## 5. "Did it work?"

It measures whether past AI recommendations actually moved revenue, and it is empty because no recommendation has been acted on yet. It will be **hidden until it has at least one measured outcome**, and when it appears it carries a one-line explanation. No separate empty card on the page.

## 6. Simplify the page

- Long explanatory paragraphs become short labels plus an info icon holding the detail.
- Advanced blocks move into collapsible sections that remember their state.
- Consistent card rhythm, one accent colour for pickup, subtle fade/height transitions on expand and on value changes; nothing that delays reading.
- Numbers rechecked end to end: occupancy (sold ÷ sellable), ADR (revenue ÷ sold), RevPAR (revenue ÷ sellable = ADR × occupancy), month totals summing the same day metrics the grid shows.

## Technical notes

- `src/lib/revenueAnalytics.ts`: baseline picks max `captured_date <= windowStart`; expose `gained`, `lost`, `net`, and a `baselineAvailable` flag per day.
- `src/components/revenue/PickupHorizonChart.tsx`: `LabelList` on the pickup bar.
- `src/components/revenue/MonthPerformanceHeader.tsx`: add the today strip.
- `src/components/revenue/PickupRangeSummary.tsx`: rebuilt as the movement board.
- `src/pages/RevenueHotelDetail.tsx`: section reordering and collapsible advanced area; `DemandRateOutlookChart` lifted out of the intelligence panel.
- `supabase/functions/previo-revenue-sync/index.ts`: fetch cancelled reservation states and write `revenue_cancelled_nights`.
