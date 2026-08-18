# Live breakfast data for the BB page (Previo API instead of manual upload)

## What's happening today

The BB page reads `daily_overview_snapshots`. Two sources feed that table:

- `manual` — the daily overview XLSX upload. Last rows captured 2026-07-24, covering dates up to 2026-07-24. 2,197 of 2,233 rows carry breakfast counts.
- `previo` — the live `previo-sync-daily-overview` function. 10,692 rows through 2026-11-10, but **every single row has breakfast = 0** (also lunch/dinner/all-inclusive = 0).

So live data already flows for rooms and guests; what is missing is the meal entitlement — the one field BB actually needs. Two concrete causes, both confirmed in the code:

1. The Previo sync guesses meals from a `<meal>`/`<board>`/`<package>` tag in the `searchReservations` XML. That tag is not present in the responses, so the flags are always false.
2. The sync writes Previo's numeric `statusId` ("1", "2", …) into `status`, while BB expects the words the XLSX importer wrote (`arriving`, etc.), so the arrival/vacant chips are wrong for live rows.

Additionally the last recorded Previo sync stamp is 2026-08-13 — the daily overview refresh only rides along with a Revenue page visit or the hourly revenue engine tick; there is no dedicated job that guarantees BB has today's data before breakfast service.

## What will be built

### 1. Find the real meal field in Previo (first step, before anything else)
Use the existing probe function to dump one full raw `searchReservations` reservation block plus a reservation detail call for a known booking with breakfast, for each of the four BB hotels. Identify where board/meal lives — typically per-night `<services>` / `<item>` entries with a service id and count, or a rate-plan name. The exact mapping is not yet confirmed, so this step decides the parser shape before any writes.

### 2. Parse meals properly in `previo-sync-daily-overview`
- Read breakfast / lunch / dinner / all-inclusive **counts** (not booleans) from whatever structure step 1 identifies, per reservation and per night, falling back to pax only when the service exists without a quantity.
- Where meals come from a rate-plan / package name, add a per-hotel mapping table of Previo service or rate-plan ids to meal type, seeded from step 1 findings, so new packages can be corrected without a code change.
- Map `statusId` to the same vocabulary the XLSX importer used (`arriving`, `staying`, `departing`) so the BB chips behave identically for live rows.
- Keep the existing delete-then-insert per hotel and window; `manual` rows stay untouched.

### 3. Guarantee fresh data every morning
- Add a dedicated cron job that syncs the daily overview for every hotel with an active Previo config: a nightly full-window run and a short-window (today + 2 days) refresh every 15 minutes during the morning so late check-ins and meal add-ons appear on the BB grid.
- Record each run in `pms_sync_history` (already supported) and expose the last successful sync time on the BB page.

### 4. BB page changes
- Show a "Live from Previo — updated HH:MM" line, with a stale warning when the newest sync for that hotel is older than a few hours.
- Add a manual "Refresh now" action for breakfast staff that triggers the short-window sync for their hotel only.
- Prefer `previo` rows over `manual` rows for the same hotel/date/room, so leftover upload rows can never shadow live data.
- Keep the XLSX upload as a fallback for hotels without Previo.

### 5. Verification
Compare, for one date, the live-synced breakfast counts against the last uploaded XLSX for the same date per hotel, and report any room-level mismatches before switching BB to prefer live data.

## Technical notes

- Files touched: `supabase/functions/previo-sync-daily-overview/index.ts` (parser, status mapping, meal counts), `supabase/functions/breakfast-public-lookup/index.ts` (source preference, freshness field), `src/pages/Breakfast.tsx` (freshness banner, refresh action), plus a small cron migration and, if step 1 requires it, a meal-mapping table with GRANTs and RLS.
- No change to the manual upload path or to any non-Previo hotel.
- Hotels in scope (all four have active Previo configs and BB codes): Hotel Mika Downtown, Hotel Memories Budapest, Gozsdu Court Budapest, Hotel Ottofiori.
