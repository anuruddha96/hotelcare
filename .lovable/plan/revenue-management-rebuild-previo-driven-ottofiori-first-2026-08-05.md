# Revenue Management rebuild (Previo-driven, Ottofiori first)

Scope: the Revenue Management section only. Nothing in housekeeping, PMS sync for rooms, or approvals is touched.

## Feasibility — what I verified

- Previo's XML API documents a **`getRates`** method that returns the *final* price per room type / rate plan / date, with occupancy-based pricing and rate-plan derivation already applied. That matches the "Alap" (base) sheet you downloaded from `pms.previo.app/.../rates`: room type rows x date columns, with 1 Guest / 2 Guest / 3 Guest prices, room status and rooms-for-sale.
- Pickup does **not** need the report file: `searchReservations` exposes creation date + stay dates, so pickup for any date range and any "as of" window can be computed exactly (Budapest time) instead of parsing an XLSX.
- Occupancy comes from the same reservation pull against total room inventory (`/rest/rooms`), which is how 7D/30D occupancy will be recomputed accurately.

Because API entitlements are per-account, **step 1 of the build is a read-only probe** against Ottofiori's Previo credentials that calls `getRates` (plus rate-plan/pricelist listing) and prints exactly what comes back. If `getRates` is not enabled on your account, the calendar falls back to an **admin-only** upload of the `priceList.xlsx` you shared (I'll parse the exact "Alap" layout above), and I'll tell you which one is in effect. Everything else in this plan works from the API regardless.

## What changes

### 1. Hotel scoping
Revenue Management shows **only the hotel currently selected** in the hotel switcher (org + assigned hotel). No multi-hotel card grid unless the user is on "All Hotels" as an admin.

### 2. Hotel overview card (the screen in your screenshot)
- 7D and 30D occupancy recomputed from the live reservation pull (rooms sold / sellable rooms, Budapest calendar days), not from stale snapshots.
- The "Next 14 days" chart becomes a **range-adjustable chart**: 14d / 30d / 90d / 6 months, with occupancy, pickup and reference rate on one timeline.
- Peak-pickup days rendered in red on the chart.
- A **pickup range summarizer**: pick a date range (Budapest time) and get total pickup, per-day breakdown, and the biggest movers.
- Uploads removed for everyone except admins; `Sync` is the only refresh path for managers and runs on click.

### 3. Sync correctness
Rewrite the revenue sync so one click pulls, for the selected hotel only:
- reservations (stay dates, created-at, room type, price, status, cancellations) for today .. +6 months,
- room inventory and room types,
- rates per room type / date / occupancy (from `getRates`),
and writes date-scoped snapshots in Budapest time. Cancellations are subtracted so pickup can be negative (your report shows -1 days). Every sync writes a history row with counts and errors so a silent partial sync is visible.

### 4. Rooms & rate-plan mapping (admins)
- Settings shows every room type returned by Previo for the hotel, alongside the existing mapping rows, so you can confirm the mapping is correct.
- One room type is flagged **reference**; other types carry a derivation rule (% or fixed €) measured against the reference.
- After mapping is confirmed, an admin can set a new reference price for a date or date range and press **Update prices** — the app computes the derived prices for all other room types and pushes them to Previo, then re-pulls to confirm the stored rates match what was pushed.

### 5. "Open" → Excel-style rate & pickup calendar
- Left column: room types from the API. Top: dates.
- Horizontal scroll with **clear month borders**, weekends shaded differently.
- Each cell shows the exact price for that room type on that date, in **EUR**, taken from the **Alap / base** rate plan.
- A pickup heat row/overlay per date: user-selectable pickup window (e.g. "since yesterday", "last 3 days", "last 7 days"); 1 pickup = light orange, 2 = stronger orange, 3+ = red.
- Occupancy and rooms-for-sale shown per date so price, occupancy and pickup are readable together.

## Technical notes

- New edge function `previo-revenue-sync` (replacing the current revenue pull path) using the existing `callPrevioXml` / `fetchPrevioWithAuth` helpers and per-hotel `pms_configurations`; hard-scoped to the requested hotel and its org.
- New tables/columns for per-room-type per-date rates by occupancy, and for pickup snapshots keyed by (stay_date, captured_date) so any pickup window can be derived without re-pulling.
- All date math via `src/lib/budapestTime.ts`.
- Currency normalized to EUR at read time; non-EUR rate plans are flagged rather than silently converted.
- Upload entry points gated behind the admin role in `Revenue.tsx` and `RevenueHotelDetail.tsx`.

## Order of work

1. Read-only Previo probe for `getRates` / rate plans / pricelists on Ottofiori — report exactly what is available.
2. Sync rewrite + storage schema.
3. Hotel overview (scoping, accurate 7D/30D, adjustable chart, pickup range tool, upload gating).
4. Excel-style calendar with pickup heat.
5. Mapping confirmation + reference-price push.
