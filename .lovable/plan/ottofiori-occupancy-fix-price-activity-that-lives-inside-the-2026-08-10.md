# Ottofiori occupancy fix + price activity that lives inside the Rate & pickup calendar

## 1. Occupancy is exactly half of the truth (Ottofiori)

Confirmed cause, from the data:

- Previo shows 95% for 10 Aug; Hotel Care shows 48%. Every day is exactly half — 100/50, 86/43, 76/38.
- Ottofiori's room inventory is counted as **42 rooms**, but the hotel has **21**. The `room_types` table holds the real types (Economy Double 1, Deluxe Queen 4, Deluxe Twin 10, Luxury Triple 5, Deluxe Quad 1 = 21) **plus** three Previo unit-group duplicates of the same physical rooms: "Room (cap 2) — 15 units", "Room (cap 3) — 5 units", "Room (cap 4) — 1 units" = 21 more.
- The nightly snapshots already store the correct `rooms_available = 21`, but the page prefers the summed room types, so the denominator doubles and occupancy, RevPAR and "rooms left to sell" (558 for August) are all halved/inflated.

Fix:

- Mark the three unit-group rows as not counting toward inventory (they stay visible as Previo objects, they just stop being counted twice). Occupancy for 10 Aug becomes 20/21 = 95%, matching Previo.
- Make the room sync stop re-flagging auto-created "Room (cap N) — X units" rows as inventory when real named room types already exist for that hotel, so a future sync cannot bring the double count back.
- Add a small "Inventory: 21 rooms" line with a tooltip in the month header, so a wrong denominator is visible instead of silent.
- SLNT is untouched: its units are the unit-group rows, so the rule only drops duplicates when a hotel has both named room types and generated unit-group rows.

## 2. Why "Price activity" looks empty

The panel is on the page, below the calendar, and permissions are fine. The problem is the content: `rate_change_audit` for Ottofiori holds ~31,000 rows written by the **alert engine** (action "dismiss", no user, no room type), the newest 16,000 of them stamped this morning at 08:00 by the automatic sync. The panel reads the newest 400 rows, so it only ever shows machine noise with blank room types — your own changes are buried.

Fix:

- The activity feed shows **human actions** (day tool, single-cell edit, demand grading, Previo push) and hides engine bookkeeping rows behind a "Show automatic system changes" toggle.
- Rows without a room type/user are grouped as one collapsed "Automatic rate engine · N entries" line instead of thousands of blank rows.
- Stop the alert engine from writing one audit row per suggestion; it writes one summary row per run instead.

## 3. Price activity moved into the Rate & pickup calendar

- The activity feed becomes a panel **inside the calendar card**, opened from a "Price activity" button in the calendar header (a slide-over on desktop, full-height sheet on mobile), instead of a separate card further down the page.
- It stays filterable by drafted / sent to Previo, and clicking an entry scrolls the grid to that date and highlights the cell.

## 4. Simpler cell hover, exactly like your screenshot

Hovering (or tapping on mobile) a price cell shows one compact line under the cell:

```text
Yesterday 18:12 · Nuwan · €111 → €123  (+€12, +11%)  · sent to Previo
```

- Relative wording: "Today 09:14", "Yesterday 18:12", then "7 Aug 11:20".
- Only the **last** change is shown by default, with "3 more changes" expanding the rest — no long list on first hover.
- Cells changed today or yesterday keep a small corner dot so recent moves are scannable.
- Unpushed drafts read "draft — not sent yet".

## 5. Earlier requests still open

Bring these in the same pass:

- Events row in the Rate & pickup calendar (AI-fetched Budapest events twice a day + manual entry) — wire the row and manual add if it is not visible yet.
- Housekeeper cards: per-housekeeper room chips with done / in progress / pending / DND counters in the summary colours.
- SLNT: venue-scoped access UI for managers/supervisors/housekeepers, the supervisor-to-venue coverage diagram, and the evening (after 17:00) next-day scheduling flow.

Tell me which of these you want first if you do not want all of them in this pass.

## Technical notes

- Migration: set `counts_toward_inventory = false, is_sellable = false` for Ottofiori's `Room (cap N) — X units` rows; scoped by `hotel_id = 'ottofiori'`, no other tenant touched.
- `previo-pull-revenue` / `previo-sync-rooms`: when a hotel already has named sellable room types, insert generated unit-group rows with `counts_toward_inventory = false`.
- `useRevenueHotelData.ts`: keep the override → named types → snapshot order, and fall back to `snapshots[0].rooms_available` when the summed types exceed it by more than 20%.
- `useRateAudit.ts`: filter to `source in ('day-tool','cell-edit','demand','push','autopilot')` by default, expose `includeSystem`, and query with a `performed_by is not null` preference so human rows are never crowded out by the limit.
- `RateActivityPanel.tsx`: rendered inside a Sheet triggered from `RateStrategyGrid`'s header; keep the batch grouping.
- New `RateCellHistory` presentation: single-line summary with `formatRelativeDay`, expand for older entries; replaces the current multi-row hover card.
- `revenue-rate-alerts`: one audit row per run instead of per suggestion.
