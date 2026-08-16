# Make the missing pieces visible, and stop the "289 still checking" loop

## 1. The "289 still checking" error — root cause found

Every flagged cell is a sub-euro difference. Real examples from Ottofiori, all created by the automation run `1893dc56…` and re-created on later syncs:

```text
Deluxe Queen Room  2026-12-14  requested 189.76  Previo published 188.88
Deluxe 4-bed       2026-12-14  requested 286.76  Previo published 285.88
Luxury triple      2026-12-14  requested 197.65  Previo published 196.82
```

Previo lands a value about 0.3-0.5% below what was requested (pricelist rounding / conversion on Previo's side). The verification step compares the two numbers **exactly**, so every one of these becomes a "landed differently" flag. There are 500+ new flags per sync hour, all on far-future dates (Nov 2026 - Feb 2027), and they never clear on their own. This is not a batching or timeout failure — the prices did land.

### Fix

- Confirm a cell when Previo is within a small tolerance of the request (whichever is larger: 1 currency unit or 0.5%). Only a real difference stays flagged.
- Send whole-number prices for every push, including automation, so Previo has nothing to round away.
- One open flag per cell: a re-check replaces the previous flag instead of stacking a new one every sync, and flags older than the reconciliation window auto-resolve.
- Backfill: resolve the existing 289 open flags that fall inside the new tolerance, keeping them in history.

## 2. Long, heavy price changes must always be scheduled in batches

Bulk edits already go to the durable queue, but a large range is still handed over as one job, so a slow property can leave a run half-verified and produce the flag storm above.

- Split any send into fixed-size chunks (date × room type) at enqueue time; each chunk is its own queued unit with its own state.
- The background publisher takes chunks one at a time and re-drives only unfinished ones; a browser refresh, timeout or logout never affects it.
- The grid shows real progress: queued / sending / confirmed / needs attention, with a "Retry unfinished only" action.
- Verification runs per chunk, so a 6-month push cannot flood the calendar with flags.

## 3. Negative pickup on Ottofiori

Loss detection by disappearance is implemented and works — SLNT has 42 recorded losses today. Ottofiori has none, despite Previo's report showing -25, and its syncs report success. So the detection is being skipped or short-circuited for this property.

- Add per-run counters (nights before, nights after, losses found, reason if the loss pass was skipped) recorded on the sync state so the answer is visible instead of guessed. Fix whatever the counters expose — the most likely candidates are the long-range pass being cut for time (which shrinks the compared window) and the loss pass being skipped whenever any reservation warning is present.
- Show losses even when net pickup nets out to zero: the pickup row gets a "-N lost" figure next to new bookings, and the day detail lists the lost reservations with their value.
- Keep Previo's own cancelled-status feed as a second source when it returns anything.

## 4. The demand / events calendar you cannot find

The events feature exists but is buried inside the "AI intelligence" tab, away from the Rate & pickup calendar, which is why it reads as missing.

- Put a **Demand & events** panel directly under the Rate & pickup calendar on the property page: month list of events, manual add/edit/delete, city + country selector, and the "Find events with AI" button with review-before-save.
- Event chips on the Demand row of the calendar, with a repeat marker for annual events and a tooltip explaining the effect on price.
- A spike badge on dates where occupancy is running 5%+ ahead of pace, with the same explanation in the cell history.
- Confirm top management sees and can manage it, still isolated per organisation.

## Technical notes

- `previo-revenue-sync`: tolerance-based confirmation, single open flag per cell, sync-run counters, loss pass no longer gated on unrelated reservation warnings.
- `revenue-enqueue-rates` / `revenue-push-drafts` / `revenue-publish-queue`: chunked runs with per-chunk state and idempotent retry by run id.
- Whole-number rounding enforced in `_shared/pricingRules.ts` and the manual/bulk editors.
- One-off data pass to resolve in-tolerance `previo_different` audit rows.
- `RevenueHotelDetail.tsx`: move `EventsPanel` next to `RateStrategyGrid`; pickup row gains the loss figure in `RateStrategyGrid.tsx`.

## Order

1. Tolerance + flag de-duplication + backfill (kills the 289 immediately).
2. Chunked, resumable publishing with visible progress.
3. Ottofiori loss diagnosis and the loss figure on the pickup row.
4. Demand & events panel moved into the calendar, with chips and spike badges.
