## Findings

- Today’s PMS button is not failing on the room-list API. `/rest/rooms` is working and returns 21 rooms.
- The error toast appears because the newer `previo-pms-sync` function treats the XML `searchReservations` failure as a partial sync.
- Ottofiori’s working path appears to be REST-first, not XML-first: the app should use Previo REST room data to sync the room list and process embedded reservation fields when available.
- The current code still emits rows after XML failure, but with `0 depart today / 0 depart tomorrow / 0 arrivals`, so the frontend marks the sync partial and shows the warning.
- Existing room state already has the correct 305 and 401 checkout flags today, meaning the app must not wipe those when XML is unavailable.

## Urgent fix plan

1. **Restore REST-first PMS sync behavior**
   - Keep `/rest/rooms` as the primary PMS source for Ottofiori.
   - Use REST room payload reservation fields when present to classify:
     - checkout rooms
     - daily rooms
     - arrivals
     - no-shows
     - clean/dirty status
   - Treat XML `searchReservations` as an optional enrichment, not the reason managers see an error.

2. **Stop showing “PMS sync partial” to managers for Ottofiori when REST succeeds**
   - If REST room sync succeeds and rooms are updated, return manager-facing status as success.
   - Keep XML failure in admin/history diagnostics only.
   - Do not show the “checkout/departure data unavailable” toast for the morning manager flow.

3. **Protect checkout rooms when reservation enrichment is missing**
   - If REST has no reservation payload and XML fails, preserve today’s existing checkout flags instead of moving rooms into Daily Rooms.
   - This prevents rooms like 305 and 401 from being lost from Checkout Rooms.

4. **Improve fallback from recent successful PMS data**
   - If today’s live reservation data is incomplete, reuse the most recent valid PMS bucket snapshot for the current morning rather than returning `0 departures`.
   - This keeps Team View usable until Previo provides complete live reservation data.

5. **Deploy and verify**
   - Deploy the affected edge functions.
   - Trigger/check the PMS sync logs.
   - Confirm the manager path reports success when REST succeeds and Team View remains populated with checkout/daily rooms instead of showing the partial error.