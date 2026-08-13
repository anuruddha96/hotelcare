# One demand chart, per-tab property, and SLNT price pushing

## 1. Replace two charts with one "Demand & pickup horizon"

Today "Pickup & occupancy horizon" (on the hotel page) and "Portfolio comparison · next 90 days" (on the portfolio page) are separate, and the occupancy scale is hidden whenever occupancy is switched off, so the line has no readable axis.

The merged chart keeps pickup bars as the base and layers optional lines on top:

- **Occupancy %** — right axis, always labelled with an axis title so it is never a mystery line.
- **ADR** — its own labelled money axis (unchanged behaviour, one right-hand metric at a time on mobile).
- **City demand** — a new single line: a Budapest demand index for each stay date, described below.
- **Compare properties** — a toggle that draws one occupancy line per property the user can access, using the fixed per-property colours from the current portfolio panel, plus the next-30-day ADR / RevPAR / occupancy summary tiles.

The portfolio page stops rendering the standalone comparison panel; the merged chart carries it. Range buttons (14d / 30d / 60d / 90d / 6m) stay and now drive the comparison too, so "next 90 days" is no longer a fixed window.

### What "city demand" means

We do not buy an external Budapest market feed, so the index is built from data already in the app and labelled honestly as an estimate:

- For every stay date, average the newest occupancy snapshot across all properties in the organisation the user can see (an in-house market proxy).
- For dates where properties have not reported yet, forecast from day-of-week and lead-time behaviour of the same properties over the past 60 days.
- Plot the result 0–100 on the occupancy axis, with forecast days drawn dashed so real and predicted are visually distinct, and a caption stating it is an internal portfolio-based estimate, not a paid market benchmark.

## 2. One property per browser tab

Property choice lives in `profiles.assigned_hotel`, one global value, so opening a second tab for a second property makes both tabs converge on whichever was switched last.

Fix: the property a user picks in the hotel switcher is remembered per tab (session-scoped), and the loaded profile is overlaid with that tab's choice. Tabs where the user never switched keep the account default. The account default is still saved, so the next fresh login opens on the last property used.

## 3. SLNT Group price pushing (checked — currently not wired)

Checked against live configuration:

- `hotel_revenue_settings` for `slnt-group` has `base_currency = HUF` and **`rate_write_method` is empty**, while Ottofiori, Memories and Mika all have `eqc:AvailRateUpdate`.
- `previo_rate_plan_mapping` has rows only for Memories, Mika and Ottofiori — **none for SLNT**.

So pushing prices from the SLNT price list would not reach their Previo today, regardless of currency. Currency itself is handled correctly: the grid edits and drafts are in the hotel's own base currency (HUF for SLNT) and the push sends that base currency, so the €/Ft display toggle cannot leak a converted number into the PMS.

Work in this plan:

- Sync SLNT rate plans into `previo_rate_plan_mapping` from their two Previo accounts and set the rate-write method, so pushes have a target.
- Add a guard in the price list: when a property has no rate-write method or no rate-plan mapping, publishing is disabled with a plain message ("Price sending is not set up for this property yet") instead of silently creating drafts that never leave.
- After wiring, verify with one small HUF push and confirm the value returned by Previo matches the sent amount.

## Technical notes

- `src/components/revenue/PickupHorizonChart.tsx` gains the portfolio query and the demand series; `src/components/revenue/PortfolioComparisonPanel.tsx` is removed and its usage in `src/pages/Revenue.tsx` dropped; the chart is passed the accessible hotel list from `src/pages/RevenueHotelDetail.tsx`.
- New `src/lib/tabHotel.ts` (session-scoped property) applied where the profile is loaded in `src/hooks/useAuth.tsx` and written by `src/components/layout/HotelSwitcher.tsx`.
- SLNT step 3 uses the existing `previo-sync-rate-plans` function plus a settings update; the price-list guard is presentation-level.
