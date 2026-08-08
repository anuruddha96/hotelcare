# SLNT: correct room count, real currency (HUF), and a re-ordered Revenue page

SLNT-only where behaviour differs. Ottofiori / RD Hotels stay on their current paths.

## 1. "60/66 rooms" when SLNT has 61 units

Confirmed cause: in `src/lib/pmsRefresh.ts` the denominator for portfolio tenants is `consideredRows` — the number of rows Previo returned (after dropping "Technikai" separator rows), not the number of units in Hotel Care. Both SLNT Previo accounts together return 66 listing rows, 60 of which matched, so the chip reads 60/66 with "6 unmatched".

Fix:
- Denominator becomes the count of active SLNT units in the app (61), so the chip reads `60/61 rooms`.
- The extra Previo rows are reported separately as "6 Previo listings not mapped", with a tap-through that lists the exact raw names so they can be mapped (or dismissed as non-units) in the existing unit-mapping review screen.
- Single-account tenants keep the current `rows.length` behaviour untouched.

## 2. Currency — SLNT prices are HUF, shown as €

Confirmed cause: the revenue pipeline treats every price as EUR. `previo-pull-revenue` only trusts `EUR`, converts `CZK` with a hardcoded /25, and defaults everything else (including HUF) to EUR unchanged; `previo-revenue-sync` defaults the rate currency to `"EUR"`. That is why ADR shows "€12,591" — those are forints.

Fix:
- Store the currency Previo actually returns per rate/reservation instead of forcing EUR, and record the hotel's base currency on the revenue settings.
- All revenue UI formats amounts in the hotel's real currency (Ft 12 591 for SLNT, € for Ottofiori) using locale-aware formatting — no more hardcoded €.
- EUR equivalent shown as a secondary line (e.g. `Ft 12 591` / `≈ €32`). The rate comes from Previo where available: first check the Previo API for a published exchange/currency rate for the account; if none is exposed, fall back to an admin-set rate in Revenue settings, and label which one is in use.
- Existing stored SLNT figures are re-labelled by a re-sync — no silent conversion of historic rows.

## 3. Revenue page order (SLNT and Ottofiori alike, it is a general improvement)

Top to bottom:
1. Header KPIs (existing)
2. Today's performance — bookings created, room-nights sold, booking value, actual ADR, ADR target
3. Rate & pickup calendar (the grid)
4. Pickup & occupancy horizon chart
5. Movement board (what moved today / last day)
6. Remaining panels
7. AI analysis last

## 4. Make every KPI self-explaining

Each card gains an inline info line and tooltip stating the exact basis:
- Revenue on the books — how it is computed (sum of confirmed room revenue for stay dates in view, cancellations and no-shows excluded) and the date range it covers.
- Rooms left to sell — the period (e.g. "August 2026, 24 days in view").
- Pickup in window — the booked-on window and the stay-date range it measures (e.g. "booked today, for stay dates Aug 8 – Sep 7").
- Occupancy / ADR / RevPAR — numerator and denominator spelled out.

## 5. Six-month outlook on the occupancy card

Occupancy card gains a compact 6-month strip (current month highlighted) fed from the same snapshot data. ADR and RevPAR get the same strip only if it stays visually calm; otherwise occupancy only.

## 6. Layout and motion

- Fix the horizontal overflow so the page fits the viewport on mobile (only the rate grid scrolls sideways, inside its own pane).
- Charts animate in on load (short, subtle entry — no looping motion).

## Technical notes

- `src/lib/pmsRefresh.ts`: portfolio total from app unit count; unmatched Previo names surfaced to the mapping review.
- `supabase/functions/previo-pull-revenue` and `previo-revenue-sync`: persist source currency, stop defaulting to EUR, capture Previo's exchange rate when the API exposes one.
- New currency helper + `useHotelCurrency` hook; `RevenueHotelDetail.tsx`, `RevenuePulsePanel`, `MonthPerformanceHeader`, `RateStrategyGrid`, `PickupHorizonChart` all format through it.
- `RevenueHotelDetail.tsx`: section reorder and overflow containment.
- Revenue settings: base currency + manual EUR rate fallback (admin only).

## Sequencing

1. Room-count fix (quick, visible immediately).
2. Currency: verify what Previo returns for both SLNT accounts, then persist and format.
3. Page reorder + KPI explanations.
4. Six-month occupancy strip.
5. Mobile fit + chart animation.
