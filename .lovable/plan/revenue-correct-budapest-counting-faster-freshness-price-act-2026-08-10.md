# Revenue: correct Budapest counting, faster freshness, price actions on movements

## 1. The missing 4th booking

What the data shows right now for Hotel Ottofiori: all four bookings created today are in the database, including the 01:58 one (stored as 23:58 UTC on 9 Aug). The app's "Today's Sales & ADR Goal" already converts that stamp to the Budapest calendar day, so it is counted correctly once it is present.

The gap is freshness, not timezone: the numbers on screen (3 bookings, 18 room nights) match exactly the three bookings that existed at the last Previo pull — the 10:26 booking had not been pulled yet. Revenue data is pulled once when the page opens and skipped entirely if the last pull is younger than 15 minutes, and the panel header showed "Not synced yet" while displaying stale figures.

Fixes:

- Reduce the arrival throttle to 3 minutes and refresh the revenue data every 5 minutes while the Revenue page is open (paused when the tab is hidden).
- Replace the "Not synced yet" chip with an honest freshness label: "Bookings as of 10:26 · Budapest" plus a small refresh button that re-pulls Previo immediately for this panel.
- Add "Cancelled / no-show hidden" wording so a cancelled booking never looks like a missing one.

There is one genuine Budapest bug found in the sync: the daily snapshot counts a booking as "created today" by comparing the UTC part of the timestamp against the Budapest date, so anything booked between 00:00 and 02:00 Budapest is attributed to the previous day. This skews pickup and "What moved". It will be changed to a Budapest-day comparison.

"What moved in the last N days" also builds its window from the browser clock instead of Budapest; it will use Budapest days so a user in another timezone sees the same numbers.

## 2. Act on a movement: adjust the prices for that stay range

Each expanded booking line in "What moved in the last N days" gets an inline action:

```text
Booked 10 Aug 09:30 · 1 guest · 15 nights (28 Aug – 11 Sep) · Deluxe Twin · €203/night   [ Adjust prices ]
```

Clicking it opens a small dialog:

- The date range is pre-filled from that booking (28 Aug – 11 Sep) and can be trimmed.
- Presets: +2, +3, +8, +11, +22 and a custom amount; a minus toggle turns the same presets into decreases.
- Optional room-type limit: all room types (default) or only the one in that booking.
- A live preview line: "42 prices, avg €118 → €129" before anything is applied.
- Apply writes drafts exactly like the price list's day tool; sending to Previo stays the existing, separate confirmed push, so nothing goes to the PMS by accident.

The row-level summary (Fri 21 Aug +3 rooms) gets the same action for that single stay date, so a strong pickup day can be raised in two clicks.

Only users who can already edit prices see these buttons; everyone else keeps the read-only view.

## 3. Last-change detail on the calendar date row

In the Rate & pickup calendar, hovering (or tapping on mobile) the date header shows the same block the price cells already use, aggregated for that date:

```text
17 Aug · 12 prices changed
Last: €111 → €123  +€12 (+11%)
Yesterday 18:12 · Nuwan · Sent to Previo
```

If nothing was ever changed for that date, it reads "No price changes yet". Draft-only changes are marked "Draft — not sent yet" in amber.

## Technical notes

- `supabase/functions/previo-revenue-sync/index.ts`: replace `created_at_pms.slice(0,10) === today` with a Budapest-day comparison helper for `new_bookings`.
- `src/pages/RevenueHotelDetail.tsx`: throttle 15 min to 3 min; add a `setInterval` (5 min, `visibilitychange`-aware) calling `live.reload()` and `load()`.
- `src/components/revenue/TodaysSalesAdrGoal.tsx`: freshness label from `lastSyncAt` in Budapest time plus a manual refresh; no change to the existing Budapest day-window logic, which is already correct.
- `src/components/revenue/PickupMovementBoard.tsx`: window start via `budapestDayOf` instead of browser `Date`; add `onAdjust(range, roomType)` callbacks on rows and detail lines.
- New `src/components/revenue/QuickRateAdjustDialog.tsx`: reuses the day-tool preset logic from `RateStrategyGrid.tsx` (extracted into a small shared helper) and writes drafts through the existing draft mutation path.
- `src/components/revenue/RateStrategyGrid.tsx`: date-header hover card fed by `useRateAudit().byCell`, grouped by `stay_date`, rendered with `RateCellHistory`.
- No database migration required.
