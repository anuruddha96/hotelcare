# Make Previo the final word after a PMS sync

## What is actually wrong

Verified against production data for Hotel Ottofiori, 25 Aug 2026:

- The sync **does** read Previo correctly and stores it: `revenue_room_type_rates` holds the Previo prices (e.g. Luxury Triple 3 guests = 135, Deluxe Four-bed 3/4 guests = 145/137, captured 06:17:03 today).
- The calendar does **not** read that table. It reads a pre-built snapshot (`revenue_published_payloads`), and that snapshot still holds the older values (178 / 188 / 188), published at 06:16:57.
- Cause: the snapshot is only rebuilt when a refresh finishes with **zero** errors. A run that pulls fresh prices but also collects any soft error writes the new Previo prices to the mirror and then leaves the calendar showing the previous ones. Ottofiori has had no clean `revenue_sync` run recorded in the last 24 hours.
- Separate finding: the **"Pull rates"** button calls `previo-pull-rates`, which is a deprecated stub that returns "not supported" and does nothing. It looks like a manual PMS pull but never pulls anything.

## The fix

1. **Always republish after a refresh.** Rebuild the calendar snapshot at the end of every refresh, clean or partial, so what the grid shows is always the last thing read from Previo. The "last successful refresh" timestamp keeps only moving on a clean run, so the freshness badge stays honest.
2. **Make "Pull rates" real.** Point it at the live refresh (`previo-revenue-sync`) instead of the dead stub, and reload the grid when it returns.
3. **Explain adopted prices in cell history.** When the sync finds a different price in Previo it already records an entry with both numbers. Reword it from "changed directly in Previo" to a plain sentence — e.g. *"Hotel Care had €178, Previo had €135 — Previo's price was adopted"* — so clicking the cell answers the question directly.
4. **Record every refresh.** The `pms_sync_history` insert at the end of the sync is failing silently (no `revenue_sync` rows exist), which is why this was invisible. Surface that error into the run's error list so future refresh problems are traceable.

## Technical detail

- Migration: both overloads of `public.complete_revenue_sync` call `refresh_revenue_published_payload` unconditionally (wrapped so a publish error can't fail the run); `last_success_at` still guarded by `_success`.
- `src/pages/RevenueHotelDetail.tsx`: `pullFromPrevio()` invokes `previo-revenue-sync` with `{ hotelId, horizonDays: 365 }`.
- `src/lib/rateChangeGroups.ts`: `auditLabel` for `previo_external` returns the adopted-price wording.
- `supabase/functions/previo-revenue-sync/index.ts`: capture the `pms_sync_history` insert error.

No changes to pricing logic, automation, or any other property's behaviour.
