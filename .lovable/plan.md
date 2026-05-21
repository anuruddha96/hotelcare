# Plan

## 1. Fix the "Upload for Hotel Memories Budapest" dialog UI

Symptoms (screenshot 1): the primary **Upload** button is clipped behind the right edge, and the "Close" button sits awkwardly with empty space. The job row also lets long filenames push layout.

Changes in `src/pages/Revenue.tsx` (UploadDialog only):

- Wrap the dialog body in `min-w-0` so flex children don't overflow.
- Footer row: change `flex gap-2 justify-end` → `flex flex-wrap gap-2 justify-end items-center pt-2`, give the primary button `shrink-0`, and shorten the label to `Upload` (count moves to a badge) so it never overflows on narrow widths.
- Job list rows: enforce `min-w-0` on the filename cell and `truncate` on both filename and message; status icons stay `shrink-0`.
- `DialogContent`: keep `max-w-lg` but add `sm:max-w-lg max-w-[95vw]` plus `p-4 sm:p-6` so the buttons aren't pushed under the rounded corner on small viewports.

No business-logic changes here.

## 2. Calendar prices don't match the PMS — fix Previo rate ingestion

Confirmation about Daily Overview data:

- All per-room arrivals, departures, ongoing guests, pax, meals (breakfast/lunch/dinner/all-incl.), housekeeping flags and meal totals **can** be derived from the Previo API. They're already partially covered by `previo-pms-sync` (reservations + room status) and `previo-sync-daily-overview` (per-day snapshot). The XLSX upload remains as a manual fallback for hotels whose API user lacks pricelist scope.

Pricing bug root cause in `supabase/functions/previo-pull-revenue/index.ts` (block "2b. Pricelist XML"):

- The function calls `getPricelist`/`getPriceList`/etc., but the screenshot shows Previo's Pricelist screen uses **rate plans per room type with multiple occupancy rows** (`€60`, `€60`, `€75`, etc.). Our parser only takes the *capacity-matched cheapest* entry and ignores the active **rate plan / pricelist id** and the **room-type → reference-room** mapping configured in Rooms Setup. That's why the calendar shows €120 default for early dates and inflated €1115/€3021 numbers later — those are realised ADR sums from reservations (block 2a), not the PMS pricelist, because pricelist parsing returned 0 rows for this hotel.

Fixes:

1. **Correct Previo method + parameters.** Per Previo XML API docs, the working endpoint is `pricelist/getPriceList` with `<priceListId>` and `<term>` and `<objTypeIds>`. Update the call to:
   - First fetch `pricelist/getList` to enumerate available pricelists and pick the one flagged `isDefault=1` (or the one mapped in `pms_configurations.settings.previo_pricelist_id` if the user set one).
   - Then call `getPriceList` with `<priceListId>` + `<objTypeId>` for every active room type from `room_types.pms_room_id`.
2. **Parse all occupancy rows.** Build `pricelistEntries` keyed by `(date, objTypeId, persons)` and store *all* of them, not just one.
3. **Use the right reference price per date.** For each date, look up the row whose `objTypeId` matches `room_types.is_reference = true` AND whose `persons` equals that room's `standard_occupancy` (fall back to base occupancy, then cheapest). Write that into `daily_rates` with `source='pms'` so it overrides the realised ADR.
4. **Stop overwriting PMS rates with realised ADR.** In the "5b" block, only write `realized` ADR when no `pms` value exists for that date — and never let realised ADR exceed `max_price_eur` (this is what produced €3021).
5. **Surface a clear diagnostic** in `pms_sync_history.data` when pricelist fetch returns 0 entries (method tried, hotel id, pricelist id, sample response snippet) so we can debug per hotel.
6. **Add `previo_pricelist_id` to `pms_configurations.settings`** and a small admin field in `PMSConfigurationManagement.tsx` so each hotel can pin the right pricelist if auto-detect picks the wrong one.

After deploying, trigger `previo-pull-revenue` for memories-budapest and verify Mon 21 May shows `€60`/`€75` matching the PMS screenshot instead of `€120 DEFAULT`.

## 3. Multi-organization `/bb` page

Today `src/pages/Breakfast.tsx` has a hardcoded `HOTELS` array containing only RD Hotels Group properties. Restructure so any organization with breakfast-enabled hotels gets its own `/bb` experience.

Routing in `src/App.tsx`:

- Keep `/bb` (legacy → RD Hotels for backward compat) and `/bb/:hotelCode` (direct code link).
- Add `/bb/org/:orgSlug` → org-scoped hotel picker.
- Add `/bb/org/:orgSlug/:hotelCode` → direct guest lookup.

Data:

- Add a new edge function `breakfast-org-hotels` (public, no auth) that, given an `org_slug`, returns the org's active hotels and their breakfast restaurant locations from `hotel_configurations` + `breakfast_locations` (or, if no such table yet, from a new `settings.breakfast_restaurants` JSON on `hotel_configurations`).
- Migration: add `breakfast_restaurants jsonb` to `hotel_configurations` (array of `{key, label_key, label}`), backfill the four RD Hotels values from the current hardcoded list.

`Breakfast.tsx` changes:

- Replace hardcoded `HOTELS` with a fetch from `breakfast-org-hotels` driven by `orgSlug` from the route (default `rdhotels` when route is `/bb`).
- Show org name + (optional) custom logo from `hotel_configurations.custom_logo_url` of the first hotel in the org, so each group's page is branded.
- All existing edge calls (`breakfast-public-lookup`, `breakfast-lookup`, `breakfast-mark-served`) already take `hotel_id`, so no backend change for guest lookup.

`BreakfastAuth.tsx`: also accept `orgSlug` so staff login lands them in the right org's hotel set.

Admin UX:

- In `BreakfastCodeManagement.tsx`, scope existing controls by the current org (already filtered by `organization_slug`); add a "Public /bb URL" copy button per hotel that emits `/bb/org/<slug>/<hotel_code>`.

## Technical notes

- All DB writes go through `supabase/migrations/` (new column + backfill).
- `previo-pull-revenue` keeps the same invocation contract; only internal parsing + write rules change.
- Type regeneration after migration is automatic.

## Out of scope

- Redesigning the calendar cell layout (chips already shipped).
- Changing pricing strategy logic (`revenuePricing.ts`).
