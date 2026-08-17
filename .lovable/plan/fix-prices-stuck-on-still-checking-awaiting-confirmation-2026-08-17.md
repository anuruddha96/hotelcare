# Fix prices stuck on "still checking" / "awaiting confirmation"

## What the badge means

After Hotel Care sends a price, Previo accepts it instantly but publication is only proven by reading the price back. Until that read-back happens the row shows "awaiting confirmation from Previo sync". Today 2,153 rows are stuck in that state (Memories Budapest 1,657, Gozsdu Court 370, Mika Downtown 106, Ottofiori 20) — not because the prices failed, but because the read-back never covers them.

Checked against live data: for every stuck Memories Budapest row a live Previo price already exists in our mirror (699 match the requested price exactly, 823 differ). So the prices did go live; only the verification step is missing.

## Root causes (confirmed in code)

1. **The post-push read-back only checks the first date of each batch.** In `revenue-push-drafts`, a batch covers a date range (`from`..`to`), but the verification call reads Previo for `date: b.from` only. Push one date and everything confirms; push a season and only the first day of each room/rate group is ever confirmed — every other date stays "sent". This is exactly why it appears when users update prices for a longer period.

2. **The nightly reconciliation can't drain a backlog.** In `previo-revenue-sync` the outstanding-draft loop issues one `UPDATE` per draft, sequentially, inside the same request that also parses months of Previo XML. With 1,500+ outstanding rows per hotel the loop runs out of time before finishing, so the backlog survives every run and keeps growing.

3. **No terminal state.** A row that is never matched has no age limit, so it can display "still checking" indefinitely — there is nothing that closes it out.

## The fix

**A. Verify the whole pushed range, not just the first date**
- Change the read-back in `revenue-push-drafts` to fetch Previo rate levels for the batch's full `from`..`to` range (the Previo read already supports a date range; today a single date is passed), and match each draft on `stay_date + occupancy` instead of occupancy alone.
- Keep it in the background `waitUntil` task, chunked so a 180-day push doesn't blow the runtime.

**B. Make reconciliation bulk and bounded**
- Replace the per-row `UPDATE` loop in `previo-revenue-sync` with grouped bulk updates (one update per distinct outcome, `.in("id", ids)`), the same pattern `revenue-push-drafts` already uses.
- Cap the number of outstanding drafts examined per run and process oldest-first, so each run makes guaranteed forward progress.

**C. Close out rows that can never be confirmed**
- When a pushed row is older than a set age (e.g. 24h) and a live Previo price exists for its cell, settle it now: `confirmed` if it matches, `different` if not — instead of leaving it "sent".
- Rows whose stay date has already passed are closed as `expired` (135 such rows exist today at Memories Budapest alone).

**D. One-off cleanup**
- A migration that settles the existing 2,153 stuck rows against the current mirrored Previo prices (match → `confirmed`, mismatch → `different`, past dates → `expired`), so the counter drops to reality immediately instead of waiting for the new logic to catch up.

**E. Honest UI**
- In the "Price changes waiting to go live" dialog, show the age of the oldest pending item and a "Settle now" action that triggers a targeted re-check for just those cells, rather than an open-ended "still checking".

## Technical notes

Files touched: `supabase/functions/revenue-push-drafts/index.ts` (range read-back), `supabase/functions/previo-revenue-sync/index.ts` (bulk reconcile, ageing rules), one SQL migration for the backlog cleanup, and `src/components/revenue/RateStrategyGrid.tsx` for the pending dialog copy/action. No pricing logic, no re-pushing of prices — the fix only reconciles state that already exists in Previo.
