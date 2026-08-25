# Fix flat prices after a whole-day push, and wrong purple dots

## What actually happened on 25 Aug at Ottofiori

The drafts written at 05:50 tell the story: ten cells, all `intent_source = manual`, all created in the same instant, all with `new_price = 158` — but with very different old prices (58, 71, 99, 101, 104, 109). So the whole-day tool took the single price that was typed and wrote that exact number into every room type and every occupancy of that date. Previo therefore shows €158 everywhere on 25 Aug, while Hotel Care's grid still shows the older per-room prices because the calendar only refreshes those cells after the next Previo sync.

Two separate problems come out of this:

1. **A whole-day (and bulk) price is applied as one absolute number to every room type and every guest count.** Room-type differentials and the occupancy ladder are wiped in one click.
2. **Ladder and hierarchy repairs make prices equal, never stepped.** The safety layer lifts a lower cell "up to" the neighbour's price, so 1g = 2g = 3g = 4g is a normal outcome. That is exactly the flat ladders seen in the Previo screenshots (Triple Room 183/183/183, Deluxe Twin 158/158).

## The fix

### 1. Whole-day and bulk edits keep the shape of the day

When a single price is entered for a whole day (or a range in Bulk edit), treat it as the price for the reference cell only, and derive every other cell from the day's existing shape:

- Room types keep their existing relative distance to the reference room type on that date (in %, rounded to whole currency units).
- Occupancy levels keep their existing step within each room type.
- If a cell has no prior price to derive from, fall back to the configured per-guest supplement (below).
- The confirmation dialog shows a short preview: "Deluxe Twin 158 · Triple 183 · Quad 192 …" so it is obvious before pushing that the day is not being flattened.
- An explicit "Set the same price everywhere" checkbox stays available for the rare case where that is really wanted.

### 2. A real occupancy step instead of equal prices

Add a per-hotel setting **extra guest supplement** (currency-aware: EUR properties default to +10 per extra guest, HUF properties to the converted equivalent), stored on `hotel_revenue_settings`.

- `repairLadder` in the shared safety layer repairs to `lower + supplement` instead of `lower`, so a repair never produces two identical levels.
- `liftHigherRooms` likewise lifts the higher room type to at least the cheaper room's price plus one step, instead of exactly equal.
- Both remain upward-only, so no floor, min-ADR or markdown cap is undercut.

### 3. Purple dots on manual changes (Gozsdu)

Manual pushes are written to `rate_change_audit` with `source = "push"`, but the reconciler only treats `day-tool`, `cell-edit` and `pickup-board` as manual. Everything else is confirmed as `previo_bulk_confirmed`, which the grid's origin map does not recognise as a team change — so the cell falls through to whatever automation touched that date, and the date header shows purple.

- Include `push`, `manual_push` and `bulk-editor` in the manual-origin set used by `previo-revenue-sync`.
- Map `previo_bulk_confirmed` to the "team" origin in `src/lib/rateOrigin.ts` so those cells get the blue dot.
- Header dots keep showing the most recent change, so a date with both a manual push and an automation move shows the newer of the two, not automation by default.

### 4. Repair 25 Aug at Ottofiori

After the code is in, re-derive the 25 Aug ladder from the neighbouring dates' shape (keeping the 158 level for the reference room type) and queue it through the normal publish pipeline so Previo receives stepped prices again.

## Technical notes

- Files: `supabase/functions/_shared/rateSafety.ts` (+ its test file), `supabase/functions/revenue-enqueue-rates/index.ts`, `supabase/functions/previo-revenue-sync/index.ts`, `src/components/revenue/RateStrategyGrid.tsx` (whole-day dialog + preview), `src/components/revenue/BulkPriceEditor.tsx`, `src/lib/rateOrigin.ts`.
- One migration: `extra_guest_supplement_eur` on `hotel_revenue_settings`, plus a room-differential mode flag; no new tables.
- Tests extend `rateSafety_test.ts`: stepped repair, no equal levels produced, upward-only guarantee, and derivation of a whole-day price from an existing day shape.
