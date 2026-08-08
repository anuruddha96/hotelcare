# SLNT Revenue: readable price list, honest numbers, clearer bookings feed

Three problems, all SLNT-only in effect. Everything below is gated so RD Hotels / Ottofiori (EUR, single Previo account) behave exactly as today.

## 1. Why the numbers are wrong (verified against the database)

Two confirmed causes, both in the data layer, not the display layer:

**a) Mixed currencies in one table.** `revenue_booking_nights` for `slnt-group` holds both HUF and EUR rows:

```text
Previo account 782407 : 577 rows, avg 38,798   -> HUF
Previo account 783103 : 4,187 rows, min 36 / max 71,184 -> EUR and HUF mixed
today's Booking.com rows: 64.38, 70.76, 49.89  -> plainly EUR
```

`previo-revenue-sync` reads `<price>` off each reservation but never reads the reservation's currency (it only does that for the pricelist). Every EUR booking is stored as if it were forints. That is exactly why "Today" reports 33 room nights for 1,797 Ft at 54 Ft ADR while the rate grid shows 26,000 Ft.

Fix: parse the reservation currency, convert non-base amounts into the hotel's base currency using the saved rate (SLNT: 400 HUF/EUR, already stored), and store the original currency and amount alongside so nothing is guessed twice. Re-sync rewrites the horizon, so the bad rows heal on the next sync.

**b) Revenue thresholds are still euro-sized.** `hotel_revenue_settings` for `slnt-group` is `base_currency = HUF` but keeps `floor_price_eur 60`, `rate_warn_below_eur 60`, `rate_max_sane_eur 900`. Every forint price is compared against euro limits, so the entire grid is painted "critical" red — that red wash in the screenshots is not real. Thresholds will be scaled into the hotel's base currency (and made editable in that currency).

**c) Goals are euro defaults.** `Today's Sales & ADR Goal` defaults to ADR 120 / value 1,200 — meaningless in forints. Defaults become currency-aware, and the euro symbol still hardcoded on the "ADR tonight" tile is removed.

## 2. Price list that stays readable while you scroll

- The metric block you circled (month, date row, Pickup, Occupancy, Left to sell, Demand) becomes **sticky**: the grid gets its own vertical scroll area, so room types scroll under a header that always shows the date and that date's pickup/occupancy/left-to-sell/demand.
- **Column separation**: alternating day shading, a stronger weekend tint, a vertical rule every 7 days, a visible "today" column, and a clear line between each room-type block, so the wall of numbers reads as a grid instead of a paragraph.
- Prices get a compact form (`26,0k` style) at narrow widths with the exact number in the tooltip and in the edit dialog, so the columns stop colliding on a phone.

## 3. Adjustable, collapsible left column

- A drag handle on the divider resizes the left column; the width is remembered per user.
- A collapse button snaps it to a narrow icon rail: room-type initials plus a guest-count icon, full name on hover/tap.
- Three snap sizes (wide / compact / rail) so a tap is enough on mobile — the drag is for fine tuning.

## 4. Bookings created today — say what it is for

- A one-line purpose header: *"Every reservation created in this period, newest first — spot cheap bookings while you can still reprice."*
- Each booking becomes a two-line row: **arrival → departure · nights** on top; room type, channel, total and ADR-vs-goal on the bottom, with the chips reduced to channel + one status. Value and ADR align in their own right-hand column so the eye can compare down the list.
- Group multi-room bookings under one reservation instead of repeating the same booking, and label the "below goal" chip with what it is measuring.

## Technical notes

- `supabase/functions/previo-revenue-sync/index.ts`: read reservation currency (attribute or tag, with a sanity fallback for values far below the base-currency band), normalise to base currency, and persist `currency` + `original_price` on the booking-night rows.
- Migration: add `currency` / `original_nightly_price` columns to `revenue_booking_nights` and `revenue_cancelled_nights`; add base-currency threshold columns to `hotel_revenue_settings` (existing `*_eur` columns keep working for EUR hotels).
- `src/lib/revenueThresholds.ts`: resolve thresholds in base currency; EUR hotels keep the current values.
- `src/components/revenue/RateStrategyGrid.tsx`: sticky metric header, banded columns, resizable/collapsible left pane (persisted in `localStorage`).
- `src/components/revenue/TodaysSalesAdrGoal.tsx`: currency-aware goal defaults, drop the hardcoded `€`, restructure the bookings list.
- `src/components/revenue/TodaysBookingsPanel.tsx`: same row restructure so both feeds match.

## Not covered until you confirm

The horizon holds 161 reservation/date pairs with more than one row. Those look like genuine multi-room bookings rather than duplicates, so I will verify against Previo before changing any counting logic.
