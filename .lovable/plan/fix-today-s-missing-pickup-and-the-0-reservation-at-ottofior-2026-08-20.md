# Fix today's missing pickup and the €0 reservation at Ottofiori

## What the data shows (checked in the live tables)

Reservation **114023587** is one Previo group booking (voucher 6083369375) with several rooms. Two of its rooms were added later — 19 Aug 12:32 and 20 Aug 09:06 — for stay dates 20–22 Aug, and Previo returns them with **price 0.00** because the money sits on the other rooms of the group. Those €0 rows are stored exactly as Previo sends them, so the €0 in the app is real PMS data, not a parsing bug.

The two problems that follow from it:

1. **Today's pickup shows nothing.** The pickup feed (`pickup_snapshots`) writes one gain/loss per **reservation + stay date**. Reservation 114023587 was already present on 20 and 21 Aug, so adding a second and third room to it produced no change at all — every delta captured today for this property is `0`. That is why the Rate & pickup calendar reads "no pickup" on dates that genuinely gained rooms today, and why the date dot stays quiet: it follows the same window/feed.

2. **The €0 rows distort the numbers.** They count as sold room-nights with zero revenue, which drags ADR down and makes "Bookings created today" report room-nights with €0 value.

## What will change

### 1. Count rooms, not just reservations, in the pickup diff
In the Previo sync, compare the **number of room-nights** per reservation + stay date between the previous book and the new one, instead of only whether the reservation exists:

- gained += max(0, rooms now − rooms before)
- lost += max(0, rooms before − rooms now)

A room added to (or removed from) an existing booking then moves pickup by 1, as Previo's own pick-up report does. Physical room-key changes stay neutral, because the count per reservation is unchanged — the safeguard that stopped phantom pickup keeps working, as does the churn plausibility guard.

### 2. Same rule in the calendar's fallback count
The in-app fallback (used when the sync feed has no row) counts distinct reservation ids per date, so it hides the same case. It will count distinct **rooms** per reservation instead, keeping the two paths consistent.

### 3. Make €0 room-nights honest
- Exclude zero-priced room-nights from the **ADR** average (they have no price, so they must not dilute it) while still counting them as sold rooms and in occupancy.
- In the "Reservations moved in today" list and the today tile, show such a row as **"€0 · priced on the group booking"** instead of a bare €0, so nobody reads it as a free stay.

### 4. Backfill today
Re-run the property sync once after the fix so today's captures record the rooms that were added, and the calendar's PU cells and date dots for 20–22 Aug fill in.

## Technical notes

- `supabase/functions/previo-revenue-sync/index.ts`: `movementByDate` computation switches from key-set difference to per-key room counts (`presentCounts` already exists and can be reused for the current side).
- `src/lib/revenueAnalytics.ts`: `createdRes` / `cancelledRes` sets become per-date sets of `res_id|room_key`; ADR denominator ignores nights with a null/zero price.
- `src/components/revenue/PickupMovementBoard.tsx` and `MonthPerformanceHeader.tsx`: €0 labelling only.
- No schema change, no pricing-engine change.
