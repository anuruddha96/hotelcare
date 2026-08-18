# Make the automation behave again: real surcharges, honest dots

## What I checked in your live data (Ottofiori, 03:0x UTC)

- The engine is running hourly and is not erroring. In the last 48 hours it wrote **22,425 markdowns** and only **60 increases**.
- Yesterday one booking (res 114729863, stay 25 Aug) raised the same cells **twice** (14:00 and 15:10). The "one raise per booking" guard shipped after that, and today's 02:52 run behaved correctly for that date.
- Several stay dates had a genuinely new booking in the last 48h, **no cancellation**, and still got **no increase**: 18, 19, 20 Aug; 28, 29 Nov; 19, 22, 23 Dec; 30, 31 Jan; 1 Feb. Those bookings were in the candidate set (captured 02:51 today), so they reached the surge pass and were dropped by one of its guards.
- Dates with 1 new night and 1 cancelled night in the window net to zero and are blocked on purpose (15, 16, 24, 25, 26 Nov). That part is correct behaviour, just invisible.
- **The engine keeps no record of why an event was skipped.** It counts skips in memory (`skipped_not_new`, `skipped_negative_pickup`, `held_short_window`, `held_sold_out`) and throws them away with the response. That is why the exact cause for the dates above cannot be named from the data today — so step 1 is to make the engine say it, not to guess.

Two structural problems are visible in the code regardless:

1. **The two passes disagree about what "pickup" means.** The markdown pass only skips a date that picked up inside the last evaluation window (~1 hour), while the surge pass now honours the full 48h lookback. So the same date can be marked down every hour and raised in the same run, and the result depends on which draft the publisher writes last. `markdownDatesThisRun` exists but the surge pass never consults it.
2. **A raise is consumed forever.** The action table's uniqueness is `(hotel, stay_date, reservation, room, occupancy)` with `ignoreDuplicates`, so once a booking has lifted a cell — even if Previo refused the price, as your 11/12 Aug history shows — that booking can never lift it again.

## What will change

### 1. The engine explains every skipped date
Each run records, per stay date, the reason no increase happened: `stale_booking`, `already_raised`, `net_negative`, `cancelled_today`, `short_window`, `sold_out`, `type_sold_out`, `daily_cap`, `no_tier_increase`. Written to the run summary and to the automation notification, and shown in the cell/day history as a grey line ("New booking seen, price held — the date is net negative over 48h"). This turns "some days pickup but no surcharge" into a visible answer instead of an investigation.

### 2. One direction per date per run
- The markdown pass uses the same 48h pickup lookback as the surge pass, so a date that genuinely picked up is not marked down an hour later.
- The surge pass skips dates already moved down in this run (`markdownDatesThisRun`), so the two passes can never fight over one cell.

### 3. A refused price can be retried
The "already raised" check ignores raises whose push was refused by Previo or expired, so a booking that never actually moved the price gets one more attempt on the next run instead of being written off.

### 4. Fix the diagnosed cause
Once step 1 is live, the first run names the guard that is dropping the far-out dates (28 Nov, 19 Dec, 30 Jan …) and that guard is corrected in the same pass — most likely the net-pickup or already-raised test, but the fix follows the recorded reason, not a guess.

### 5. Purple dot with no history
The cell dots read from `rate_cell_markers` (7-day window) while the drawer reads `rate_cell_history` (28-day window) through a per-date cache that is only ever loaded once. If a date was opened before the automation wrote its rows, the cache keeps the empty answer while the dot refreshes. Changes:
- Reload a date's history when its marker is newer than the newest cached row for that date.
- If the drawer still has nothing, fall back to the automation action rows for that cell (which carry the reason text) instead of showing an empty panel.
- Never render a dot for a cell the drawer cannot explain.

## Technical notes

- `supabase/functions/revenue-pickup-automation/index.ts`: per-event skip reason map, shared pickup lookback between the markdown and surge passes, `markdownDatesThisRun` guard in the surge loop, refused-push exclusion in `alreadyRaisedRes`, skip reasons persisted on the run summary and in `revenue_automation_notifications`.
- `src/hooks/useCellRateHistory.ts`: marker-aware invalidation (compare newest marker timestamp per date against the cached rows before reusing the cache).
- `src/components/revenue/RateCellHistory.tsx` / `DayChangesSheet.tsx`: automation-action fallback rows and the new "held, and why" lines.
- No schema change is required; the skip reasons ride on existing JSON columns.
