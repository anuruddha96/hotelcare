# Mark restaurant guests as arrived or no-show, synced to the Sales Dashboard

Staff on the `/bb` Reservations tab can currently only read the list. This adds one-tap status marking and pushes that status back to the Sales Dashboard - RD Hotels, where its analytics already counts no-shows.

## What staff will see

On each reservation card in `/bb` → Reservations:

- Two buttons: **Arrived** and **No-show**.
- Tapping one updates the card immediately (green "Seated" badge, or dimmed with a "No-show" badge) and shows a short confirmation.
- Tapping the active status again clears it back to booked, so a mistake is fixable.
- A small "Synced" / "Sync pending" indicator per card so staff know the dashboard got it. Failed pushes are retried on the next status change and logged.
- Summary line gains "x arrived · y no-show" alongside the reservation and cover counts.

## How the sync works

Reservations already carry `source_project = 'memories'` and the same `source_reservation_id` the Sales Dashboard stores, so status can be matched exactly on both sides.

```text
/bb card tap
   -> restaurant-reservation-status (new edge function)
        1. update public.restaurant_reservations.status  (seated | no_show | booked)
        2. POST signed payload to the Sales Dashboard webhook
             /api/public/webhooks/reservation
             headers: x-property: memories, x-signature: HMAC-SHA256(body)
             body: same reservation fields + new status
   -> Dashboard updates its reservations row -> analytics funnel + no-show charts
```

The dashboard webhook upserts on `(property, source_project, source_reservation_id)` and accepts any of `booked / seated / no_show`, so resending the reservation with the new status updates the existing row rather than creating a duplicate. Its analytics page already excludes no-shows from covers and counts them in the funnel — no change needed there.

## Technical details

1. **DB migration** — add to `public.restaurant_reservations`: `status_marked_at timestamptz`, `status_marked_by text` (device/staff label, nullable), `dashboard_sync_state text default 'pending'`, `dashboard_synced_at timestamptz`, `dashboard_sync_error text`. No RLS change (public access stays via edge functions only).
2. **New edge function `restaurant-reservation-status`** — public like `restaurant-reservations-list` (IP rate limited), validates `reservation_id`, `hotel_id` and `status ∈ {booked, seated, no_show}`, writes with the service-role client, then forwards to the dashboard. Outbound URL and secret come from new secrets: `SALES_DASHBOARD_WEBHOOK_URL` and `SALES_DASHBOARD_WEBHOOK_SECRET` (must equal the dashboard's `HOTEL_MEMORIES_WEBHOOK_SECRET`). If the forward fails, the local status is still saved and `dashboard_sync_state` is set to `failed` with the error.
3. **`restaurant-reservations-list`** — also return the new sync/marking columns.
4. **`src/components/breakfast/RestaurantReservations.tsx`** — add the Arrived / No-show controls, optimistic update, sync indicator, and extended summary; new `bbT` strings in `src/lib/breakfast-translations.ts` for all supported languages.

## Note before building

The two secrets above are needed for the dashboard leg. I will request them during the build; until they are set, marking will still work locally and queue as "sync pending".
