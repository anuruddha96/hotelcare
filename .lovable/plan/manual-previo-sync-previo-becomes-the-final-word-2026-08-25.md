# Manual Previo sync: Previo becomes the final word

Verified against the live project:

- `pms_sync_history` has `sync_type CHECK (rooms, reservations, status_update, minibar, room_kinds, rate_push, checkouts_poll)` and `direction CHECK (from_previo, to_previo)`. The sync writes `sync_type = 'revenue_sync'`, `direction = 'inbound'` — both rejected, so no revenue sync run is ever recorded.
- `previo-revenue-sync` reconciles outstanding drafts and, when Previo disagrees, pushes the old Hotel Care price back (`retryCells` → `reconcile` push run). That is what re-sends €149 after the user pulled €159.
- `Sync now` (`runSync`) claims the sync lease via `claimRevenueSync` and reloads with `Promise.all([load(), live.reload()])`. `Pull rates` (`pullFromPrevio`) calls the same edge function but with no lease and only `load()` — two manual refreshes can overlap and the grid does not fully reload.

## What changes

### 1. Authoritative mode in the sync function

`supabase/functions/previo-revenue-sync/index.ts` accepts `mode: "authoritative_pms_pull"`. Nothing changes for scheduler/automation runs.

In that mode, for every outstanding draft **created before the sync started**:

- Previo's freshly read price is stored as usual in `revenue_room_type_rates`.
- If the draft's requested price differs from Previo's live price, the draft is closed: `confirmation_status = 'superseded'`, `actual_previo_price = <live>`, `reconcile_state = 'settled_from_pms'`, `reconcile_next_at = null`, `reconcile_error = null`, and a plain-language `push_error` explaining Previo's price was adopted.
- The cell is never added to `retryCells`, so no reconcile push run and no outbound queue entry is created for the old price.
- Matching prices still confirm normally (unchanged path).
- Drafts created **after** the sync start timestamp are skipped entirely — a price a user types while the sync runs keeps its intent and still publishes.
- The existing audit entry keeps the adopted-price wording already used for `previo_external`.

Ordering stays: read Previo → store mirror → settle old intents → reconciliation (no retries in this mode) → history row → `complete_revenue_sync` (which republishes the snapshot) → return.

### 2. One manual path for both buttons

In `src/pages/RevenueHotelDetail.tsx`, `pullFromPrevio` becomes a thin call into the same `runSync(true)` path, and `runSync` passes `mode: "authoritative_pms_pull"` when the refresh was user-triggered. Both buttons then share `claimRevenueSync` (no overlapping manual refreshes) and both finish with `await Promise.all([load(), live.reload()])`.

### 3. Sync history migration

One migration extends the two CHECK constraints on `pms_sync_history`:

- `sync_type` gains `revenue_sync`, `revenue_live`, `daily_overview_live`.
- `direction` unchanged; the function switches from `inbound` to `from_previo`.

The insert error is surfaced into the run's `errors` list (currently only `console.error`), so a rejected history row is visible in the run result.

### 4. Snapshot equals the Previo mirror

No new work here — `complete_revenue_sync` already republishes on partial runs. Because authoritative mode creates no retry pushes, nothing can move the mirror after the publish inside that run.

### 5. Normal outbound behaviour untouched

Automation and manual price pushes, reconciliation retries on scheduler runs, and publisher lease behaviour are unchanged. The "Previo wins immediately" rule applies only when `mode = "authoritative_pms_pull"`.

## Verification

After deploying, run a manual sync on Hotel Ottofiori and report:

- Test A (Previo wins), B (matching price confirms once), C (edit during sync survives), D (published snapshot = latest mirror), E (valid `pms_sync_history` row with `revenue_sync` / `from_previo`, actor and summary).
- A SQL comparison of every current/future cell in `revenue_published_payloads.rates` against `revenue_room_type_rates` where `source = 'previo'`: comparable cell count, mismatch count, and the exact reason for any remainder.

## Files touched

- `supabase/functions/previo-revenue-sync/index.ts`
- `src/pages/RevenueHotelDetail.tsx`
- one new migration (constraints on `pms_sync_history`)

No other files, no pricing or automation formula changes.
