## Findings

- The latest sync did **not** receive real reservation/departure data from Previo.
- `/rest/rooms` is working, but it only returned the room list / clean status. It emitted `21 rows` with `0 depart today`, `0 depart tomorrow`, `0 arrivals`.
- That is why the app showed success but the room chips did not move: there was no authoritative PMS bucket data to apply.
- Today there is no current `pms_upload_summary` fallback. The latest stored PMS upload is yesterday, and it shows **9 checkout rooms / 12 daily rooms**, which matches your concern that today should not be only 2 checkout rooms.
- The existing checkout-release flow (`previo-poll-checkouts`) and clean-status push flow (`previo-update-room-status`) are separate and should not be changed except to keep compatibility.

## Fix plan

1. **Stop false “success” when bucket data is missing**
   - Revert the misleading behavior where REST room-list success is treated as a complete PMS sync.
   - The sync should only say complete when it has authoritative checkout/daily/no-show data.
   - If only `/rest/rooms` works, use it for clean/dirty status but do not claim the full housekeeping bucket sync is correct.

2. **Restore real PMS bucket source**
   - Update `previo-pms-sync` to require a reservation/departure source before moving checkout/daily/no-show chips.
   - Use these sources in priority order:
     1. Previo reservation/departure feed if authentication works.
     2. Today’s PMS upload summary if present.
     3. Existing Hotel Care room state only as a protection fallback, not as a “successful PMS sync.”

3. **Add a safe Previo reservation probe**
   - Add a non-destructive probe inside the connection test / sync diagnostics to try the documented `searchReservations` feed and log exactly which auth variant fails.
   - Also test plausible REST reservation endpoints separately, without changing rooms, so we can confirm whether Previo exposes reservation data via REST for this hotel.
   - Store only diagnostic metadata, never secrets.

4. **Fix manager button behavior**
   - If checkout/daily/no-show data is missing, show a clear short message that the PMS room list connected but reservation data was not received.
   - Do not show success unless room chips were recalculated from real PMS bucket data.

5. **Preserve existing functionality**
   - Do not change `previo-poll-checkouts` checkout-release behavior except to keep it compatible with the corrected bucket source.
   - Do not change `previo-update-room-status`; supervisor “mark clean” should continue pushing clean status to Previo via REST.
   - Keep existing protection so a bad PMS response cannot wipe checkout rooms.

6. **Deploy and verify**
   - Deploy affected edge functions.
   - Run the connection/probe path and inspect logs.
   - Run a dry-run sync first and confirm it returns real checkout/daily/no-show counts before applying room chip updates.
   - Confirm the manager UI no longer shows a misleading success when the PMS bucket source is incomplete.