# SLNT Revenue: real forint prices, a currency switch, and whole numbers

## What is actually wrong (verified)

- Every SLNT rate row in the database is stored with `currency = 'HUF'` (11,537 rows, 0 – 224,000). Ottofiori's 2,509 rows are `EUR`. So the data is right; the label is not.
- SLNT has **no row at all** in `hotel_revenue_settings`. The Revenue page reads `base_currency` from that row and falls back to `EUR` when it's missing — which is why the rate grid prints `€26,000` for what is 26,000 Ft. Ottofiori, Mika, Memories, Gozsdu and Previo-test all have rows and all are genuinely EUR, so they are unaffected.
- No exchange rate is stored for anyone (`eur_conversion_rate` is null everywhere), so no euro conversion is possible yet.

## The fix

### 1. Give SLNT a settings row
Create the missing `hotel_revenue_settings` row for SLNT with `base_currency = 'HUF'`. The sync already detects the currency from Previo by majority vote, but it only *updates* an existing row — it will now have one to update. No other hotel's row is touched.

### 2. Currency switch on the Revenue page
A small control in the Revenue header: **Ft / €**.

- Default is the hotel's own currency (Ft for SLNT, € for Ottofiori — where the switch simply doesn't appear, since base and display currency are the same).
- The choice is remembered per user and per hotel.
- Switching re-formats every number on the page instantly — rate grid, KPIs, ADR, RevPAR, revenue on the books, pickup values, movement board, drafts and push dialogs. No re-sync, no data change.

### 3. Exchange rate, entered by the user
Next to the switch: "1 € = ___ Ft".

- Prefilled from the stored rate if one exists; otherwise empty with a prompt to enter one.
- Saved on the hotel's revenue settings (admin / top management only), so everyone on the team sees the same rate, with a "set by <name>, <date>" note.
- Typing a new rate re-converts the whole page live as you type; it persists on blur.
- If no rate is set, the € option is disabled with the hint "Enter an exchange rate to view in euros" — no invented numbers.
- Prices you push back to Previo are always sent in the hotel's real currency (HUF), never the display currency, regardless of the switch. The push confirmation dialog states this explicitly.

### 4. Whole numbers everywhere
All revenue money values render as whole numbers with thousands separators, in both currencies:

- `26 000 Ft`, `224 000 Ft`, `€ 66`
- No `.00`, no `.5`, no long decimals — including ADR, RevPAR, revenue on the books, booking value, pickup value and the AI analysis text.
- Percentages stay as they are (whole percent).

### 5. Correctness pass on the numbers
While wiring the formatter through, confirm each figure divides by the right denominator with the currency change in place: ADR = revenue / rooms sold, RevPAR = revenue / rooms available, revenue on the books = sum of nightly prices in the window. Any value that turns out to be double-counted across the two Previo accounts gets fixed in the same pass.

## Technical notes

- `src/lib/revenueCurrency.ts` gains a display currency alongside the base currency, plus `convert()`; `money()` becomes strictly integer-formatted and currency-aware. `eur()` in `revenueAnalytics.ts` stays as the thin wrapper so no call site has to change.
- `RateStrategyGrid.tsx` (grid cells, draft rows, push dialog), `MonthPerformanceHeader.tsx`, `RevenuePulsePanel`, `PickupMovementBoard`, `TodaysSalesAdrGoal`, `PickupHorizonChart` tooltips and `AnalystPanel` all format through it.
- Migration: insert the SLNT `hotel_revenue_settings` row (`base_currency='HUF'`); no schema change needed — `eur_conversion_rate`, `eur_rate_source`, `eur_rate_updated_at` already exist.
- Display-currency preference: stored client-side per hotel; the exchange rate is server-side and shared.
- Ottofiori / RD Hotels: base currency stays EUR, rate 1, switch hidden — the only visible change for them is that stray decimals disappear.

## Sequencing

1. SLNT settings row + HUF labelling (immediately correct numbers).
2. Integer formatting across all revenue surfaces.
3. Currency switch + exchange rate input with live conversion.
4. Correctness pass on ADR / RevPAR / on-the-books.
