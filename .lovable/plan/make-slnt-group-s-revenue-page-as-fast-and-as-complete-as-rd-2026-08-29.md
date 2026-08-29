# Make SLNT Group's Revenue page as fast and as complete as RD Hotels

## What I verified

- The Revenue page is a single shared component and route for every organization. There is no SLNT-specific branch left in it: sync line, "Sync now" button, automation status line, tabs and calendar are rendered from the same code for RD and SLNT.
- The differences you see are caused by **data volume** and by **what has actually been shipped to the live site**, not by different features:
  - Published dataset size: `slnt-group` is 5.8 MB (4,661 booking nights, 11,751 rate rows, 2,609 frozen sold-out prices) versus `ottofiori` 1.4 MB. The page downloads and parses that whole file in one call before anything paints.
  - Room types: SLNT has 34 (27 sellable) versus 5-10 for the RD properties. At the 12-month view in your screenshot the calendar draws roughly 27 rows x 365 day columns with no windowing — every cell is in the DOM.
  - The payload cache only lives in browser memory, so every reload or tab restore re-downloads all 5.8 MB.
- Sync state is healthy for SLNT (last successful sync 13:12 Budapest today) and an automation rule row exists for `slnt-group` (currently switched off), so the sync line and automation line have data to show — the screenshot is from a build that predates their restoration.

## Plan

### 1. Load only what the screen needs, then fill in the rest
- Add a windowed version of the published-payload read that takes a horizon in days and trims `nights`, `rates`, `cancellations`, `movements`, `snapshots` and `soldOutPrices` to that window server-side. The page already discards anything past the horizon, so nothing is lost.
- First paint requests a short horizon (about 120 days). The remaining horizon loads in the background and swaps in when complete. For SLNT this turns a ~5.8 MB blocking download into roughly 1.5 MB.
- This is org-neutral: RD properties get the same faster first paint, just with less to gain.

### 2. Keep the dataset between visits
- Persist the last verified payload per `organization + property` in browser storage (not just memory) with a short freshness stamp, so returning to Revenue paints instantly and refreshes in the background instead of showing the loading screen again.
- Tenant-scoped key, cleared on sign-out and on identity change, so no data can appear under another organization's header.

### 3. Make the calendar render only visible columns
- Window the rate & pickup calendar horizontally: render the day columns in view (plus a buffer) instead of all 365. Month chips and the fit-to-month zoom keep working unchanged.
- Same behaviour for every organization; properties with few room types simply never hit the limit.

### 4. Confirm sync and automation visibility on the live site
- Keep the sync status line ("Last synced …"), the compact "Sync now" button and the automation status line rendered for every organization and every Revenue role, independent of the hidden admin toolbar.
- Publish the app so SLNT users get the already-restored controls, and verify on `slnt-group` that the line shows the real last-sync timestamp and that automation reports "switched off" rather than disappearing.

### 5. Verification
- Side-by-side timing of a cold Revenue load for `ottofiori` and `slnt-group` (first paint and time to interactive calendar), before and after.
- Confirm the sync line, Sync now, automation status, month chips, zoom, bulk edit and tools row are identical for the same role in both organizations.
- Confirm SLNT still reads and writes only `slnt` / `slnt-group` and that RD data is untouched.

## Technical notes

- New SQL function `get_revenue_published_payload_window(_hotel_id text, _horizon_days int)` reusing the existing `user_can_access_hotel` check and the same grants; the current function stays for compatibility.
- `useRevenueHotelData` gains a two-stage load (short horizon, then full) with the existing request-version guard, plus a storage-backed cache layer keyed by `organizationSlug:hotelId`.
- `RateStrategyGrid` gets column windowing driven by the scroll container; no change to pricing logic, markers or selection behaviour.
- No organization-specific code paths are added; the only per-tenant differences remain data-bound (currency, inventory, venues, dual PMS accounts).
