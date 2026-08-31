# Restaurant reservations for every hotel + room 036 check

## Room 036 (Memories Budapest / Levante)

I checked the live data: room 036 is in the system today — Twin, 2 guests (Alejandro Iva, Soraya), 2 breakfasts, from the 06:45 Previo sync. A lookup for "036" returns `eligible` right now.

So the room was almost certainly missing at the moment staff searched, because the BB grid only contains rooms present in that morning's Previo daily-overview snapshot: a late arrival or a reservation created after the sync is invisible until the next sync. Today there is no parsing/mapping bug — every room in the snapshot renders, and the same check passes for Mika and Ottofiori (their grids and guest info load correctly).

Fix for the real problem behind the report:
- Add a "Refresh from Previo" action on the BB Rooms tab so staff can pull a fresh snapshot instead of waiting for the scheduled sync.
- When a searched room is not in today's snapshot, show a clear message ("no reservation in today's list — refresh or check reception") plus the last sync time, instead of a bare not-found.
- Show the snapshot's last-synced time in the BB header so staff always know how old the list is.

## Reservations for Mika Downtown, Ottofiori and Gozsdu

Cause: the Reservations tab reads `restaurant_reservations`, which is only filled by the inbound webhook the Memories website sends. Only `memories` has a row in `restaurant_webhook_sources`. Every hotel's bookings already exist in the Sales Dashboard (properties: `memories`, `mika`, `gozsdu`, `ottofiori`), so HotelCare should read from there rather than wait for four websites to be rewired.

### How it will work

```text
Sales Dashboard (single source of truth for bookings)
        ^  status write-back (seated / no_show / booked)
        |
        +--> HotelCare pull  (restaurant-reservations-sync, per hotel + date)
                  -> public.restaurant_reservations
                  -> /bb Reservations tab (all hotels)
```

1. **New edge function `restaurant-reservations-sync`** — connects to the Sales Dashboard's Supabase with a read key, fetches that property's reservations for the requested service date (guest, party size, times, status, outlet, occasion, requests), and upserts them into `restaurant_reservations` on `(hotel_id, source_project, source_reservation_id)`. Only restaurant/brunch outlets are stored; museum and transfer bookings are skipped.
2. **`restaurant-reservations-list`** calls the sync first (max once per ~60s per hotel/date, cached) and then returns the rows, so the tab is populated the first time it is opened for any hotel.
3. **Mapping rows** — add `restaurant_webhook_sources` entries for Mika Downtown, Ottofiori and Gozsdu (property slug -> HotelCare hotel), so the existing resolution logic and the "configured" state work for them. The `/bb` hotel picker resolution already handles both hotel-config IDs and canonical hotel UUIDs.
4. **Arrived / No-show for all hotels** — the marking UI already exists and stays unchanged. `restaurant-reservation-status` gains a direct write-back to the Sales Dashboard reservation row (status + marked-at) for every property, with the current signed-webhook path kept as fallback for `memories`. The dashboard already models `seated` and `no_show`, so its analytics pick the change up with no change there.
5. **Cancellations and edits** made in the dashboard flow back on the next pull; cancelled bookings keep showing struck through.

### What I need from you

A read/write key for the Sales Dashboard Supabase project (`wckpmcabemtoeavjtfyr`) stored as HotelCare secrets `SALES_DASHBOARD_SUPABASE_URL` and `SALES_DASHBOARD_SERVICE_KEY`. I will request them during the build. Without them the tab keeps showing the empty state and marking stays local.

## Verification

Open `/bb` for Mika Downtown, Ottofiori and Memories and confirm each shows its own bookings for the selected date with time, guest name and cover count; mark one Arrived and one No-show and confirm the status appears on the Sales Dashboard and the card shows "Synced". Re-check room 036 lookup and the new refresh action on the Rooms tab.

## Technical notes

- New: `supabase/functions/restaurant-reservations-sync/index.ts`; migration inserting the three `restaurant_webhook_sources` rows.
- Touched: `restaurant-reservations-list` (trigger sync + return), `restaurant-reservation-status` (dashboard write-back), `src/pages/Breakfast.tsx` (refresh action, last-synced label, clearer not-found copy), `src/lib/breakfast-translations.ts`.
- Untouched: Previo housekeeping sync, breakfast serving flow, all other hotels' room logic.
