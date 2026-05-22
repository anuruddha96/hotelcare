
## Goal

Three independent improvements to Revenue Management:

1. Calendar must show the **exact reference-room price** from Previo's pricelist (not the realized ADR average).
2. The per-hotel mini-chart on `/revenue` must show **occupancy + pickup + reference-room price** together, not just an occupancy spark.
3. The hotel card labels "Previo sync: never" and "Pickup upload: never" must reflect reality when Previo is actively syncing.

---

## 1. Reference-room price on the calendar (drop ADR fallback)

Today the calendar shows `daily_rates.rate_eur` where `source` can be:
- `previo_pms` — pricelist value (correct)
- `previo_realized` — average of total reservation price / nights (this is the ADR the user does not want)
- `manual` / `engine` — seeded or recommended

Change `previo-pull-revenue` so the calendar always reflects the **pricelist** value for the reference room type:

- Pick exactly one Previo room as the reference. Resolution order:
  1. `room_types.is_reference = true` with a parsable `pms_room_id`.
  2. If none, the most populous capacity bucket (existing fallback) — already done — but persist that pick by flipping `is_reference`.
- Pricelist fetch already exists (`pricelist/getPriceList`). Improvements:
  - Match strictly on `objId ∈ refObjIds`. Within that, prefer `persons = standard_occupancy` (new optional column, default = ref capacity); never fall back to "cheapest entry across all room types" — that was distorting the calendar.
  - Store the raw pick per date in a new table `previo_reference_prices(hotel_id, stay_date, rate_eur, persons, currency, captured_at)` so the UI can show the exact value with provenance and we can stop overloading `daily_rates`.
- **Stop writing `previo_realized` rows.** Remove the realized-ADR upsert branch entirely. Only `previo_pms` rows are written to `daily_rates`. Keep a one-time backfill SQL that deletes existing `previo_realized` rows so the calendar repaints clean.
- `RevenueHotelDetail.tsx` (`rate` column in `Row`) reads `previo_reference_prices` first, then falls back to `daily_rates` for non-Previo hotels. Display a small "PMS" badge on the cell so it is obvious the number is the pricelist value, not a recommendation.
- Day-detail sheet shows: reference room name, persons used for the price, pricelist id, and last fetch time.

If the pricelist endpoint returns nothing for the reference room (Previo plan limitation), surface the existing `pricelistError` in the day-detail and in `RevenueSyncHistory` instead of silently falling back to ADR.

---

## 2. Hotel-card mini chart: occupancy + pickup + reference price

Replace the single-series sparkline (lines 338–346 of `src/pages/Revenue.tsx`) with a richer combo chart. The data is already loaded for occupancy; add two more series:

- Build `spark` for the next 14 days containing `{ d: 'Mon 25', occ: 62, pickup: 3, rate: 145 }` by joining:
  - `occupancy_snapshots` (latest per stay_date) — already loaded.
  - `pickup_snapshots.delta` summed per stay_date — fetch a second slice over the 14-day horizon (not just "last 24h").
  - `previo_reference_prices` (or `daily_rates` source=`previo_pms`) for the rate line.
- Render with Recharts `ComposedChart`:
  - Left Y axis: occupancy % (area), pickup (bars).
  - Right Y axis: rate € (line, accent color).
  - Compact tooltip showing all three values + date.
- Below the chart keep the existing 7-day occupancy bar row; add a tiny legend (Occ / Pickup / Rate) so the chart is self-explanatory.
- Card grows ~80px taller; keep responsive — single column on mobile already handled.

---

## 3. Fix "Previo sync: never" and "Pickup upload: never"

Two root causes:

**a. `pms_configurations.last_sync_at` is never updated** by `previo-pull-revenue` or `previo-sync-daily-overview`. The Revenue page reads it for the "Previo sync" line, so it always shows "never" even when syncs run on the cron.

Fix: at the end of both edge functions, on success:
```ts
await service.from("pms_configurations")
  .update({ last_sync_at: new Date().toISOString(), last_sync_status: "success", last_sync_error: null })
  .eq("hotel_id", hotelId).eq("pms_type", "previo");
```
On error, write `last_sync_status: "error"` + `last_sync_error: message`. Add the two columns if missing.

**b. "Pickup upload" label is misleading.** The current query reads any `pickup_snapshots` row regardless of source, but the label implies an XLSX upload. For Previo-connected hotels there is no XLSX upload — the data comes from the live sync.

Fix in `src/pages/Revenue.tsx`:
- Compute two values:
  - `lastPickupUpload` = newest `pickup_snapshots` where `source <> 'previo'` (or `snapshot_label <> 'previo-live'`).
  - `lastPickupLive`   = newest where `source = 'previo'`.
- Render conditionally:
  - If `isPrevio` and `lastPickupLive`: "Previo pickup: 2 min ago".
  - Else: "Pickup upload: …" (existing behavior for XLSX-only hotels).
- Same treatment for occupancy line ("Previo occupancy" vs "Occupancy upload").
- The "Previo sync" line now uses `last_sync_at` updated in (a) and shows the latest of the two syncs (revenue + overview).

Also add a small `RefreshCw` button on each Previo card that invokes `revenue-engine-tick` for that specific hotel so an admin can force a re-sync if the cron is lagging — gives a fast feedback loop for confirming the labels update.

---

## Technical details

**Files to edit**
- `supabase/functions/previo-pull-revenue/index.ts` — drop realized-ADR upsert, persist reference price to new table, update `last_sync_at`.
- `supabase/functions/previo-sync-daily-overview/index.ts` — update `last_sync_at` on success/error.
- `src/pages/Revenue.tsx` — richer mini chart (ComposedChart), split pickup/occupancy labels by source, manual sync button, load `previo_reference_prices`.
- `src/pages/RevenueHotelDetail.tsx` — read `previo_reference_prices` for the rate column, badge cells as "PMS", show reference-room details in day sheet.
- `src/components/revenue/RevenueSyncHistory.tsx` — surface pricelist errors when present.

**Migration**
```sql
create table public.previo_reference_prices (
  hotel_id text not null,
  organization_slug text not null,
  stay_date date not null,
  rate_eur numeric(10,2) not null,
  persons int,
  currency text default 'EUR',
  pricelist_id text,
  captured_at timestamptz not null default now(),
  primary key (hotel_id, stay_date)
);
alter table public.previo_reference_prices enable row level security;
-- read policy: admin/top_management of the org; service role bypasses
create policy "org admins read ref prices" on public.previo_reference_prices
  for select using (has_role(auth.uid(),'admin') or has_role(auth.uid(),'top_management'));

alter table public.pms_configurations
  add column if not exists last_sync_status text,
  add column if not exists last_sync_error text;

-- one-time cleanup so the calendar stops showing realized ADR
delete from public.daily_rates where source = 'previo_realized';
```

**Out of scope**
- No changes to the engine / autopilot logic.
- No new permissions for non-admin roles.
- Multi-room-type price display is deliberately not added — the user asked for one reference room only.
