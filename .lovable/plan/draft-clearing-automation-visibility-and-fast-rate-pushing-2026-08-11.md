# Draft clearing, automation visibility, and fast rate pushing

## 1. "Clear all" says removed but nothing goes away

Confirmed cause. The waiting list in the push dialog shows two kinds of rows: real unsent drafts, and rows already accepted by Previo that are waiting for sync confirmation ("Accepted — awaiting confirmation from Previo sync"). The delete only removes rows whose status is `draft` or `failed`, so the accepted rows survive, yet the success toast still counts every selected row. Ottofiori currently has 558 true drafts and ~4,400 accepted/awaiting rows, which is why "1000 drafts removed" changed nothing.

Fix:

- Delete exactly the rows the user ticked, including accepted-but-unconfirmed ones (clearing those only stops Hotel Care tracking them; it never changes a live Previo price — the dialog wording will say so).
- Report the real number deleted, returned by the database, instead of the number selected. If some rows could not be removed, say how many and why.
- Show two clear groups in the dialog — "Not sent yet" and "Sent, waiting for Previo confirmation" — with separate counts, separate select-all and separate clear actions, so "Push" never re-sends already-accepted rows.
- Add a one-shot cleanup for the backlog: dismiss all confirmation-waiting rows older than 24 hours for the hotel.

## 2. Did the automation act on pickup #114488609?

No. Confirmed from the data: the reservation was created in Previo at 16:27 for stay dates 20–22 August, but Hotel Care only imported it at 18:21. The automation cursor filters on the Previo creation time and only looks at bookings created after the previous run (18:15), so a booking that arrives late from a sync is skipped permanently. The last automation actions are from 16:30 for two other reservations.

Fix:

- Move the automation cursor to "when Hotel Care first saw the booking" (`captured_at`) rather than the Previo creation time, so late-arriving syncs are still priced. Keep the existing unique index so nothing is charged twice.
- Keep an age guard: skip a booking whose Previo creation time is older than a configurable window (default 24 hours) to avoid re-pricing historic backfills.
- Add a small "Automation activity" list in the automation sheet: last run time, pickups seen, actions taken, actions skipped and the reason (below ADR floor, daily cap reached, no price on file).
- Backfill nothing automatically; offer a "Run now" button that processes the current window so the user can see it work immediately.

## 3. Colour for automation-made price changes

Today the grid marks manual changes only (blue dot recent, orange dot older). Add a third, clearly different marker for automation:

- Purple dot = price set by pickup automation.
- Blue dot = set by a person recently, orange dot = set by a person earlier.
- Legend row updated with all three, and hover/tap detail says "Pickup automation +€8 (2nd pickup within 60 min) at 16:30" including the triggering reservation number.

## 4. Why pushing is slow, and how it gets fast

Confirmed cause. Every price change is sent as its own Previo EQC message for one single date and one room type. A 966-price bulk edit over 75 days becomes hundreds of separate Previo conversations, sent in browser chunks of 24 with two parallel requests — the sync history shows repeated 24-price calls taking 5–11 seconds each. Room Price Genie is fast because it sends date ranges in one message.

Fix (same safety, far fewer calls):

- Group drafts by room type and identical occupancy ladder, then collapse consecutive dates into a single `DateRange from/to` EQC message. A flat season change becomes one message per room type instead of one per day.
- Put every room type for the same date range into one message where Previo allows multiple `RoomType` blocks, cutting calls again.
- Keep the gap-free occupancy ladder rule intact so Previo error 3092 cannot come back.
- Raise the server-side concurrency and increase the browser chunk size, since each chunk now represents many more dates for the same wall time.
- Keep the run id, per-cell state and resumability already in place, so a lost response still recovers without re-sending confirmed cells.
- Show a single progress bar with "X of Y prices sent" driven by real completions, and a realistic time estimate.

Expected result: a full-season bulk change goes from minutes of repeated calls to a handful of Previo messages.

## Technical details

- `src/components/revenue/RateStrategyGrid.tsx`: split the waiting list by status, remove the status filter from the delete, count deleted rows from the returned data, add automation marker colour and legend.
- `supabase/functions/revenue-push-drafts/index.ts`: change grouping key from date + room type to room type + ladder signature with contiguous date-range collapsing; batch room types per message; keep per-draft status writes.
- `supabase/functions/_shared/previoRateWrite.ts`: allow several room types in one `AvailRateUpdateRQ`.
- `supabase/functions/revenue-pickup-automation/index.ts`: cursor on `captured_at`, add booking-age guard, record skip reasons in `revenue_pickup_automation_actions`.
- `src/components/revenue/PickupAutomationRules.tsx`: run-now button and recent-activity list.
- All queries stay scoped by `hotel_id` and organization slug.

## Validation

- Clear all on Ottofiori and confirm the waiting count drops to zero and stays zero after refresh.
- Re-run automation and confirm a late-synced booking like #114488609 is priced, with the action visible in the activity list and a purple dot on those dates.
- Time a 900+ price bulk push before and after; confirm identical final prices in Previo and no 3092 errors.
