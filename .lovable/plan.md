## Goal
Make PMS Sync act as the replacement for the manual PMS Excel upload: retrieve live Previo reservation/stay data, calculate checkout/daily/no-show/night counts the same way the Excel upload did, and update room chips correctly.

## What I found
- The current API sync is successfully calling Previo `/rest/rooms`, but that endpoint only gives room roster/clean status for Ottofiori right now.
- It is not receiving reservation/departure/stay data, so it cannot calculate today’s 9 checkout rooms / 12 daily rooms from live PMS data.
- The manual upload path has the correct business logic: it resets today’s room bucket fields, reads columns like Room, Occupied, Departure, People, Night/Total, Status, Note, and writes checkout/daily/no-show/night metadata.
- Previo’s public docs for reservation data point to XML `searchReservations` with a date window and optional status filters; REST `/rest/reservations` as currently called returns 405, so that is not the correct REST shape for this tenant.

## Implementation plan
1. **Create a shared Excel-equivalent PMS row mapper**
   - Extract the manual-upload row interpretation into reusable logic.
   - Keep the exact rules for checkout rooms, daily rooms, no-shows, current/total nights, towel/linen changes, guest count, notes, and dirty/clean status.

2. **Fix Previo reservation retrieval**
   - Update `previo-pms-sync` so reservation data is required for a real bucket sync.
   - Use the documented `searchReservations` XML request correctly for the live date window:
     - include today’s departures
     - include stayovers that arrived before today
     - include today arrivals/no-shows
     - preserve room object ID/name matching
   - Add status-filter attempts only as diagnostics/fallback if the first query fails or returns no reservation blocks.
   - Do not use `/rest/rooms` as proof that the PMS snapshot is complete.

3. **Make API sync feed the same shape as Excel upload**
   - Convert Previo reservations into rows with the same fields the manual upload expects: `Room`, `Occupied`, `Departure`, `Arrival`, `People`, `Night / Total`, `Status`, `Note`, plus metadata.
   - Calculate checkout rooms from real departure today / checked-out status.
   - Calculate daily rooms from active stayover rows and night totals.
   - Calculate no-show only from actual reservation status/arrival evidence, not from missing reservations.

4. **Apply room updates like the manual upload, safely**
   - When reservation data is authoritative, reset today’s PMS-derived bucket fields for that hotel and rewrite them from the API snapshot.
   - When only `/rest/rooms` succeeds but reservation data fails, do not move chips and return a clear non-success state instead of a misleading success.
   - Keep existing protections for in-progress checkout-cleaning assignments.

5. **Preserve outbound PMS status updates**
   - Do not change `previo-update-room-status`; supervisor “mark clean” should continue pushing clean/dirty status to Previo.
   - Do not break `previo-poll-checkouts`; it remains a separate checkout-release/ready-to-clean function.

6. **Verify with live data before finishing**
   - Run the edge function in dry-run mode for Ottofiori.
   - Confirm returned counts match real PMS-style buckets, not the old stale upload:
     - checkout rooms count
     - daily rooms count
     - no-show count
     - current/total night values
   - Deploy the changed edge function(s), then run one apply sync and check `rooms` + `pms_sync_history` show authoritative reservation data.