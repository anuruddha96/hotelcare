# Fix "Today's sales & ADR goal" numbers and its refresh behaviour

## What is wrong (verified against the database)

For Hotel Ottofiori, bookings created today (Budapest) are:
**6 reservations, 8 booked rooms, 24 room-nights**, with stay dates running as far out as **8 Dec 2026**.

The panel shows 4 bookings / 13 room-nights because it silently filters bookings by a **default guest-stay window of today + 90 days** (13 Aug – 11 Nov, exactly the dates in the screenshot). Every booking whose nights fall beyond that window is dropped from the count, revenue, ADR and the goal progress.

The missing negative pickup has a separate cause: the `revenue_cancelled_nights` table is **completely empty for every property**, so cancellations and no-shows created today never reach the app at all. The revenue sync does have a dedicated cancelled/no-show pass, but nothing has ever landed from it — the exact reason (Previo rejecting the status filter, or the cancellation timestamp not being parsed) is not yet confirmed and must be diagnosed before it is fixed.

## Plan

### 1. Count every booking created in the period
- Remove the hidden 90-day stay-date restriction from the KPI path: a booking created today counts in full, whatever its arrival date.
- Keep the two stay-date fields as an **optional** filter (default: off / "all stay dates"), clearly labelled, instead of a silent default window.
- Widen the data query so nights outside the old window are actually fetched.
- Result for today at Ottofiori: 6 bookings, 8 rooms, 24 room-nights, with revenue and ADR recomputed over all of them.

### 2. Make cancellations visible again
- Diagnose why the cancelled/no-show pass of the revenue sync produces zero rows (run the Previo call for Ottofiori for today's window and inspect the response and the parsed cancellation timestamp).
- Fix whichever step drops them, so cancellations and no-shows created today are stored.
- In the panel, show cancellations as part of today's picture (a negative pickup line and a cancelled count) rather than hiding them behind a toggle that reads "Cancelled hidden".

### 3. Refresh only with the page, never by hand
- Remove the manual refresh button from this section.
- Reload the panel's data whenever the page's shared property sync completes (the same 30-minute freshness cycle the rest of the revenue page already uses), plus once on entry — no separate timer, no independent pull.
- Show a plain "as of <time> · updates with the page sync" line so it is obvious the numbers are live and not stale.

## Validation
- Today's Ottofiori figures match Previo: 6 bookings / 24 room-nights, with the cancellation shown as negative pickup.
- Switching the period presets (Today / Yesterday / Last 7 days / This month) keeps totals consistent with Previo.
- After a page sync completes, the panel's numbers and timestamp move without any user action; no refresh control is present.

## Technical notes
- No schema changes expected; the fix is in `TodaysSalesAdrGoal.tsx`, its query, and the cancellation pass of `previo-revenue-sync`.
- Hotel and organization filters stay untouched; other properties benefit from the same corrections automatically.
