# Brunch reservations on the BB page

Breakfast staff currently see only in-house rooms from the Previo daily overview. Website brunch bookings live in a different system (the Sales Dashboard), so the team has to switch tabs. This adds a second tab on the BB page showing today's restaurant reservations, fed by the same signed webhook the hotel site already uses.

## How the data will arrive

The Memories site already signs and POSTs every reservation change to the Sales Dashboard. It will send the same signed payload to HotelCare as well, so HotelCare never depends on the dashboard being up.

```text
Memories brunch site (reservation insert/update/delete)
        |
        +--> Sales Dashboard  (existing, unchanged)
        +--> HotelCare  /functions/v1/restaurant-reservation-webhook  (new)
                 -> restaurant_reservations table
                 -> BB page "Reservations" tab
```

## What will be built in HotelCare

### 1. `restaurant_reservations` table
Per-hotel storage keyed by `hotel_id` + `source_project` + `source_reservation_id` (unique), holding guest name, email, phone, party size, start/end time, status (booked / seated / completed / no_show / cancelled), outlet slug, occasion, special requests, notes and the raw payload. Cancellations arrive as an action and mark the row cancelled rather than deleting it. RLS: staff of the owning hotel can read; writes only from the service role (the webhook). Explicit grants included.

A small `restaurant_webhook_sources` mapping (property slug -> hotel_id + secret name) keeps it generic: adding another hotel later means one row plus one secret, no code change.

### 2. `restaurant-reservation-webhook` edge function
Public endpoint, HMAC-SHA256 verification of the raw body against `x-signature`, property from `x-property`, per-property secret (`RESTAURANT_WEBHOOK_SECRET_MEMORIES` to start). Times are interpreted as Budapest wall clock unless the payload says otherwise, matching the dashboard's behaviour. Every call — accepted or rejected — is logged with outcome and status so delivery problems are visible. Only restaurant/brunch outlets are stored; museum and transfer payloads are acknowledged and ignored.

### 3. BB page becomes tabbed
The page keeps everything it does today and gains a tab bar under the hotel header:

- **Rooms** — the existing room grid, lookup and served marking, unchanged.
- **Reservations** — today's brunch bookings for the selected hotel, sorted by time.

Each reservation card shows the seating time, the **guest name in large bold text**, and a **prominent people count badge** (e.g. "4 guests"), plus phone, occasion and special requests when present. Cancelled bookings are shown struck through and dimmed at the bottom; no-shows are greyed. A header strip totals the covers for the day ("7 reservations · 23 guests"). The date picker already on the page drives this tab too, and the list refreshes live via Realtime so a booking made during service appears without reloading.

Translations follow the existing BB translation file, so the tab works in every supported language.

### 4. Change needed in the Memories project
The site's `notify-sales-dashboard` function gets a second signed POST to the HotelCare endpoint with the same body and a HotelCare-specific secret. That project is separate, so this step is done there — the exact snippet and the secret value will be provided once the HotelCare endpoint is deployed. Until it is applied, the tab shows an empty state explaining no bookings have been received yet.

## Verification

Send a signed test payload to the new endpoint and confirm it lands on the Reservations tab with correct Budapest time, then create a real test booking on the Memories site and confirm it appears in both the Sales Dashboard and the BB tab, and that cancelling it strikes the row out.

## Technical notes

- New: migration for `restaurant_reservations` + `restaurant_webhook_sources` (grants, RLS), `supabase/functions/restaurant-reservation-webhook/index.ts`, a `RestaurantReservationsTab` component.
- Touched: `src/pages/Breakfast.tsx` (tab shell only), `src/lib/breakfast-translations.ts`.
- No change to Previo sync, room lookup, served marking, or any other tenant.
