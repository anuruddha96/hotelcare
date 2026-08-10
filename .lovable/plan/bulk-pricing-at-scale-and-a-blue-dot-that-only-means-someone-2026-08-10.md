# Bulk pricing at scale, and a blue dot that only means "someone priced this day by hand"

Two things: make a 2,000+ price bulk change actually go through reliably, and keep the blue marker meaningful.

## 1. The blue dot becomes a manual-change marker only

Today every price change writes an activity row, and the grid puts a blue dot on any cell that has one — so a season-wide bulk edit would sprinkle dots across 184 days and the signal is lost.

New rule:

- Bulk edits still change the price everywhere in the selected range, including days that were priced by hand. Nothing is skipped.
- Only short-range manual work (day tool, single-cell edit, pickup re-price) puts a blue dot on a cell.
- A bulk edit never adds a dot, and never removes a dot that is already there. A day the owner raised for high demand keeps its marker even after a general bulk move, until someone changes that day by hand again — then the dot refreshes to the new time and price.
- Hover text stays as it is: who, when, and the price movement. For a bulk-affected day it also notes the later bulk move, so the number in the tooltip never disagrees with the number in the cell.
- The legend under the calendar is updated: "blue dot = priced by hand for this day".

## 2. Bulk changes of 2,000+ prices

Today the editor saves drafts one by one from the browser (two requests per price — roughly 4,800 for the screenshot's 2,391 prices) and then asks the server to push them all inside a single request. Both parts fall over long before that size: the save takes minutes, and the push runs one Previo conversation per date/room type in sequence, which will exceed the function's time limit and leave part of the batch unsent.

Fix, in three parts:

- **Saving drafts**: write them in chunks of a few hundred in one round trip each, instead of one at a time. A 2,391-price change becomes a handful of requests instead of thousands.
- **Sending to Previo**: the push runs in batches with a progress bar ("Sending 1,200 of 2,391…"), each batch a separate call, several Previo conversations in flight at once. If a batch fails, the rest continue and the failures are listed at the end with Previo's own message and a "Retry failed" button.
- **Safety on the size**: above a threshold the dialog states plainly how many prices and how long it is likely to take, and asks for the extra confirmation it already asks for today. Cancelling mid-way stops after the current batch and keeps whatever landed.

## 3. Smaller fixes in the same screen

- The preview list gets a proper count line and a working show-all toggle for very large batches (it currently renders the first five days only).
- After a bulk run the calendar refreshes the affected date range only, instead of a full reload.

## Technical notes

- `src/lib/rateDrafts.ts`: replace the per-row read/write loop in `saveRateDrafts` with chunked upserts against the active-cell unique index; add `pushRateDraftsBatched(hotelId, ids, { chunkSize, concurrency, onProgress })` that slices ids and calls `revenue-push-drafts` per chunk, aggregating `pushed`/`failed`/`errors`.
- `src/lib/rateAudit.ts` / `src/hooks/useRateAudit.ts`: introduce a `MANUAL_SOURCES` list (`day-tool`, `cell-edit`, `pickup-board`) and build `byCell` for the dot from those sources only; keep `bulk-editor` rows in the activity feed and in the hover history, but out of the dot index.
- `supabase/functions/revenue-push-drafts/index.ts`: process the date/room-type groups with a bounded concurrency (e.g. 4–6 in flight) and return partial results if a soft time budget is hit, so the client can send the remainder in the next chunk.
- `src/components/revenue/BulkPriceEditor.tsx`: progress state, batched save + push, retry-failed action, show-all preview toggle, large-batch warning copy.
- `src/components/revenue/RateStrategyGrid.tsx`: dot rendering reads the manual-only index; legend copy updated; range-scoped refresh after a bulk run.
- No database schema changes.
