# Rate pushing that sticks, and a real bulk price editor

Four fixes to the Revenue price tooling, in priority order.

## 1. "Change prices" dialog cuts off the preview list

Today the preview shows the first 12 lines and ends with a dead "+27 more…" label that cannot be clicked, and the whole dialog scrolls awkwardly on desktop.

- Make the preview list its own scrollable block (fixed max height, native scroll) so every changed price is reachable.
- Replace the dead "+27 more…" text with a working "Show all 39" / "Show less" toggle.
- Group the preview by date so a 3-day change reads as three short blocks instead of one long list.
- Keep the footer (Cancel / Save N drafts) always visible instead of scrolling away.

## 2. Prices reach Previo but Hotel Care keeps showing "draft"

Confirmed from the data: for Oct 22–24 there are 39 drafts marked `pushed` and every one carries "the read-back price was unavailable", plus 39 fresh drafts created eleven minutes later — the user re-entered the same change because the grid still showed the old price.

Root cause: after writing the price, the push reads it back from Previo with `getRates` to prove it landed. That read returns nothing usable, so Hotel Care never writes the confirmed price into its own price list, the grid keeps the old number with the draft dot, and the change looks unsaved even though Previo accepted it.

Fix:

- Make the read-back reliable: send the pricelist id with the read, accept the alternative Previo response shapes, and retry once before giving up.
- When the read-back still comes back empty but Previo's write call answered OK, trust the write: store the pushed price in Hotel Care's price list, mark the draft `pushed` and label the cell "Sent to Previo (awaiting confirmation)" rather than leaving a stale price.
- After a push, run a targeted revenue re-sync for exactly the pushed dates, so the next render shows the live Previo price.
- Clear pushed drafts from the grid state immediately and refresh the cells, so the draft dot disappears the moment the push succeeds.
- Prevent duplicate drafts: if an identical pending change already exists for a date/room type/occupancy, update it instead of stacking a second one.

## 3. Act on the movement directly from "What moved in the last X days"

The quick adjust exists but only saves drafts, which is why it feels like nothing happens.

- Row and booking-detail actions become a single "Adjust price" flow with presets (2 / 3 / 8 / 11 / 22 or custom), increase or decrease, and the exact date range of that booking pre-filled.
- Add a confirmation step showing "N prices, avg X → Y" with two buttons: **Save as draft** and **Send to Previo now**.
- "Send to Previo now" runs the same push path as the calendar, then refreshes the movement board and the calendar so the new price is visible in place.
- Show the result inline on the row (e.g. "Raised 12 prices · sent") instead of only a toast.

## 4. Bulk price editor for the Rate & pickup calendar

A dedicated **Bulk edit prices** button in the calendar header opens a full editor, better than Previo's bulk dialog:

- **Date range**: a two-month calendar with drag-select for start/end, plus quick ranges (next 7 / 30 / 90 days, this month, next month, rest of season).
- **Weekdays**: individual Mo–Su toggles, plus "weekends only" and "weekdays only" shortcuts.
- **Room types and occupancies**: multi-select chips; none selected means all.
- **Change**: by amount, by percent, set fixed price, or round only — with the existing presets and a custom field.
- **Guards**: optional minimum and maximum price so a bulk change can never drop below the floor (e.g. min ADR 120) or overshoot.
- **Rounding**: whole number, nearest 5, or ".90" endings.
- **Preview**: a scrollable, date-grouped table of every price that will change, with a count and average movement, plus a warning when more than a few hundred prices are affected.
- **Apply**: Save as drafts, or Save and push to Previo with the usual confirmation checkbox.
- Everything is logged in the price activity trail exactly like today's day tool.

## Technical notes

- `supabase/functions/_shared/previoRateWrite.ts` — harden `readPrevioRateLevels` (pass `prlId`, tolerate alternative tags, single retry).
- `supabase/functions/revenue-push-drafts/index.ts` — trust a successful write when the read-back is empty; always upsert into `revenue_room_type_rates`; return per-draft outcomes.
- `src/components/revenue/RateStrategyGrid.tsx` — scrollable/grouped preview with a show-all toggle, sticky dialog footer, draft dedupe, post-push refresh, and the new bulk-editor entry point.
- New `src/components/revenue/BulkPriceEditor.tsx` — the editor described in section 4, reusing the existing draft-save and push helpers.
- `src/components/revenue/QuickRateAdjustDialog.tsx` and `PickupMovementBoard.tsx` — add the confirm + "Send to Previo now" path and inline result feedback.
- No database schema changes are required.
