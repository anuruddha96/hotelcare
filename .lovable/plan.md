## Plan: make RTC accurate and immediate

### Problem to fix
The live data shows all 15 Ottofiori checkout rooms are RTC again. The statusId `5 → 6` mapping fix is present, but another path is still treating **scheduled departure today** as **physically checked out**.

The main culprit is the manual/client PMS refresh path:
- `previo-pms-sync` emits `Occupied: "Yes"` for every departure-today room.
- `pmsClassification.ts` currently marks any scheduled departure with `Occupied: "No"` as checked out, but the row generation/fallbacks and upload-derived data can still convert departure rows into `CheckedOut=true` without a real Previo checkout confirmation.
- Once `CheckedOut=true`, `pmsRefresh.ts` sets `pms_metadata.readyToClean=true`, `checkedOutToday=true`, `checkout_time`, and `room_assignments.ready_to_clean=true`.

Separately, the cron poll currently exits early when no `ready_to_clean=false` assignments exist, which is bad after a false RTC event because it stops checking/reconciling.

### Changes I will make

1. **Make RTC require explicit Previo checkout confirmation**
   - Update PMS classification so scheduled departure alone never means checked out.
   - `CheckedOut=true` must come from one of:
     - Previo reservation statusId `6` (or legacy `9`),
     - explicit status text like `checked out/departed`,
     - an explicit boolean `CheckedOut=true` emitted by backend.
   - Remove the unsafe shortcut: `scheduled departure + Occupied: No = checked out`.

2. **Fix the upload fallback status bug**
   - In `previo-pms-sync`, the fallback from today’s PMS upload currently synthesizes checkout rows with `statusId: 5` when `item.status === "checked_out"`.
   - Change that to `statusId: 6` so every source uses the same Previo mapping.

3. **Make cron poll continue until true RTC is correct**
   - Remove/relax the early exit in `previo-poll-checkouts` so it still fetches Previo when assignments are already RTC, allowing correction and diagnostics.
   - Keep the strict rule that only real checkout signals release RTC.
   - Reintroduce a safe reconciliation step: if a room is marked RTC but Previo reservation feed says it is only scheduled departure / checked-in (`statusId=5`) and not checked out, clear RTC back to waiting.
   - Do not clear rooms that are already cleaned/in approval/completed or manually overridden.

4. **Immediately correct today’s Ottofiori data**
   - Keep the 5 rooms Previo confirmed as checked out: `101, 102, 302, 304, 406`.
   - Clear false RTC/checkout flags for the other 10: `103, 105, 201, 202, 205, 305, 402, 403, 404, 405`.
   - Keep them in Checkout Rooms as scheduled departures, but not RTC.
   - Set their `checkout_cleaning.ready_to_clean=false` and clear `checkedOutToday`, `readyToClean`, `checkedOutAt`, `checkout_time`.

5. **Verification**
   - Run targeted tests for PMS classification.
   - Deploy the changed Previo edge functions.
   - Run a dry/live checkout poll for Ottofiori.
   - Query live data and confirm:
     - RTC/`ready_to_clean=true` is exactly `101, 102, 302, 304, 406`.
     - The other 10 remain Checkout Rooms but are not RTC.
     - Future cron runs can add new RTC rooms when Previo changes their status to checked out.