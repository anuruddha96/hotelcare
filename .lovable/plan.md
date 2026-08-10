# Revenue Management: one hotel, one clear page

## 1. Top managers skip the portfolio page

Today `/rdhotels/revenue` shows the "Hotels tracked / Pending recs / upload cards" overview to top managers. That page exists only for the admin who oversees all hotels.

The redirect that was meant to prevent this no longer fires: it checks "is revenue admin", and top management was recently given the same revenue powers as admin, so the check now passes for them too.

- Split the two ideas: revenue *powers* (top management keeps everything: push, autopilot, strategy, events) versus the *portfolio overview* (admin only).
- On opening Revenue, a top manager is sent straight to the hotel currently selected in the header switcher, e.g. `/rdhotels/revenue/ottofiori`, with auto-sync as today. Falls back to their assigned hotel if nothing is selected.
- Switching hotel in the header while on the Revenue page moves them to that hotel's page instead of bouncing to the overview.
- Admins are unaffected and still get the portfolio page.

## 2. Price activity — plain language, not a log

The current activity sheet groups rows into batches with filters, source codes and a system toggle. It reads like a database table.

Replace it with a simple, scannable feed:

```text
Today
  10:12   You raised 12 prices for 17–21 Aug   avg +€8   Sent to Previo
  09:40   You lowered Deluxe Queen, 14 Aug     €123 → €111   Draft
Yesterday
  18:12   Nuwan raised 3 prices for 24 Aug     avg +€11  Sent to Previo
```

- One line per action a person took, in one sentence, with a green up / blue down marker.
- Grouped under Today / Yesterday / date headings — no "min ago" arithmetic.
- Two states only: **Draft** (not sent) and **Sent to Previo** (or **Failed**, in red with a retry link). Internal source codes disappear from the UI.
- Clicking a line expands the individual dates and room types it touched.
- Automatic engine entries are hidden entirely; a small "system entries" link at the bottom reveals them for troubleshooting.

Cell hover keeps exactly the shape you asked for and gets tightened to a single readable block:

```text
Deluxe Queen · 2 guests · 17 Aug
€111 → €123   +€12 (+11%)
Yesterday 18:12 · Nuwan · Sent to Previo
```

## 3. Page layout — the price list is the hero

New order on the Rate Grid tab:

1. **Month performance header** (occupancy, ADR, revenue, 6-month outlook) — unchanged.
2. **Today's sales & ADR goal** chart.
3. **Rate & pickup calendar (price list)** — the hero, full width, nothing above it competing.
4. **Pickup & occupancy horizon** chart, directly under the price list.
5. **What moved in the last N days** — expanded (see below).

Everything else becomes a collapsed entry in one **Tools** row of buttons directly under the price list, each opening in a side panel: Demand desk, Revenue intelligence (AI), Demand board, Price activity, Revenue pulse. The main page shows charts, data and the price list only.

## 4. "What moved" gets the booking detail you asked for

Each movement row expands into the actual bookings behind it:

```text
Fri 21 Aug   +3 rooms   +€412
  Booked 10 Aug 09:14 · 2 guests · 3 nights (21–24 Aug) · Deluxe Queen · €137/night
  Booked 09 Aug 21:02 · 1 guest  · 1 night              · Standard     · €98
  Cancelled 10 Aug 07:40 · 2 guests · 2 nights          · Deluxe Queen · −€222
```

Created date and time, guests, nights, room type and value per booking, gained and lost separated, using the booking-night data already synced from Previo.

## 5. Demand desk, simplified

- The demand desk moves out of the main flow into its own panel opened from the Tools row.
- Inside it keeps only: the grade per date, the reason in one line, and the suggested change with an Apply button. The multi-section settings move behind a small "Rules" toggle in the same panel.

## Technical notes

- `src/lib/roleAccess.ts`: add `canSeeRevenuePortfolio(role)` = admin only; `src/pages/Revenue.tsx` redirect uses it instead of `isRevenueAdmin`, resolving the hotel from the header/tenant selection first, then `profile.assigned_hotel`.
- `src/pages/RevenueHotelDetail.tsx`: reorder the `grid` tab, and move `DemandPricingPanel`, `RevenueIntelligencePanel`, `RevenuePulsePanel` and the activity panel into `Sheet`s driven by a new small `RevenueToolsBar` component.
- `RateActivityPanel.tsx`: rewrite as a day-grouped feed; drop the filter chips and source labels, keep `useRateAudit` as the data source (`HUMAN_SOURCES` filter already excludes engine noise).
- `RateCellHistory.tsx`: single-block layout, most recent change only, "N more" link retained.
- `PickupMovementBoard.tsx`: expandable rows fed by `live.nights` (created_at_pms, guests, nights, room type, price) filtered to the stay date and pickup window; no schema change needed.
- No database migration required.
