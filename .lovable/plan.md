# SLNT: friction-free Team View assignment + live Previo API for both accounts

Two independent pieces. Everything is gated on the SLNT organization (`slnt` / hotel `slnt-group`) or on new rows that only SLNT has, so RD Hotels and Ottofiori keep byte-identical behaviour.

## Part 1 — Drag and drop without a dialog per move

Today every chip drop opens a confirmation. Replace it with a staged board:

- Drop a unit chip on a housekeeper card: the chip moves instantly (optimistic), no dialog. The move is held as a pending change, not yet written to the database.
- Dragging a chip off a card back to the board stages an unassign the same way.
- A sticky action bar appears at the bottom while there are pending changes: "3 moves pending — Apply all / Undo last / Discard". One blanket confirmation applies everything in a single pass.
- Each staged chip shows a subtle "pending" outline and a small badge so it is obvious what is not saved yet.
- Apply writes each move through the existing `assignRoomToStaff` / `unassignRoom` helpers, then refreshes both panels. Any row that fails is reported by name in a toast and rolls back to its original owner; the rest still apply.
- Errors, permissions and supervisor venue scoping are unchanged — a staged move that RLS rejects fails at Apply with a clear message.

### Auto-save / session restore

Pending moves survive a reload, a tab switch or an accidental navigation:

- Staged changes are written to `localStorage` under a key scoped to user + hotel + assignment date, on every change (debounced).
- On mount, if a draft exists for the same user/hotel/date and is less than 12 hours old, the board restores it and shows "Restored 3 unsaved moves — Apply or Discard".
- Restored moves are re-validated against current data: any unit that has since been assigned elsewhere or removed is dropped from the draft with a note.
- Draft is cleared on Apply or Discard.
- The board also warns via `beforeunload` while unapplied moves exist.

Gating: the staged/no-dialog flow is behind the existing SLNT flag, so other tenants keep the current per-move confirmation until you ask to roll it out.

## Part 2 — Live Previo API for SLNT's two accounts

Current state, confirmed in the database:

- `pms_configurations` has one row per hotel and holds the credentials secret name — Ottofiori (`PREVIO_CREDS_OTTOFIORI`, Previo hotel 786631) and previo-test. SLNT has no row.
- `pms_accounts` already has SLNT's two accounts (782407 "SLNT PMS 1", 783103 "SLNT PMS 2") under hotel `slnt-group`.
- All sync functions (`previo-pms-sync`, `previo-sync-rooms`, `previo-poll-checkouts`, `previo-update-room-status`) look up a single config by `hotel_id`, so one hotel cannot currently carry two Previo hotel IDs.

### Model change (additive)

- Extend `pms_accounts` with the per-account API fields it lacks: `credentials_secret_name`, `is_active`, `auto_sync_enabled`, `status_push_enabled`, `outbound_kill_switch`, `last_sync_at`, `last_sync_status`, `last_sync_error`, `consecutive_failures`.
- Sync functions gain an optional `pmsAccountId` input. When present they resolve credentials and the Previo hotel ID from `pms_accounts`; when absent they behave exactly as today via `pms_configurations`. No existing call site changes, so Ottofiori's path is untouched.
- Unit resolution for SLNT reuses the confirmed `pms_unit_mappings` aliases already used by the XLSX upload, so API rows land on the same units as the manual files.

### Credentials

Previo activated access for SLNT Group without issuing anything new, which usually means the existing live key now covers the added hotel IDs. So:

1. A connectivity test runs the existing live credential against 782407 and 783103.
2. If it authenticates, we store it as the SLNT accounts' secret reference and continue — nothing about Ottofiori's secret changes.
3. If Previo rejects it (401/403 or "hotel not permitted"), the admin panel shows the exact Previo status and message plus a one-line next step ("Previo has not attached this key to hotel 783103 — ask support to enable it, or paste the SLNT key"), and we request a separate `PREVIO_CREDS_SLNT` secret from you at that point.

### Feature parity with Ottofiori

For SLNT, per account and both together:

- Test connection, room/room-type pull, and today's PMS snapshot pull from the admin PMS panel.
- "Sync both accounts" runs them back to back into one combined result, the same shape as the two-file XLSX upload.
- Scheduled auto-sync, off by default, switchable per account.
- Outbound clean-status push after supervisor approval, using the account's Previo hotel ID and each unit's mapped Previo room ID, behind `status_push_enabled` + kill switch exactly like Ottofiori.
- Every sync writes to `pms_sync_history` so the existing history panel shows attempts, and failures surface the Previo status code and body verbatim rather than a generic error.
- The API path is non-destructive for SLNT, same as the manual upload: assignments and housekeeper-set flags are preserved, only statuses and daily/checkout retyping change.

### Isolation guarantees

- `previo-nightly-sync` stays hard-gated to `previo-test`; SLNT scheduling goes through the new per-account flag, never through Ottofiori's config.
- No changes to Ottofiori's or previo-test's `pms_configurations` rows, secrets, or push flags.
- All new columns are nullable/defaulted so existing rows keep current behaviour.

## Acceptance checks

- Ottofiori: manual refresh, checkout poll and approval push behave identically; no new rows or flags on its config.
- SLNT: connection test reports success or an exact Previo error; both accounts sync in one run; units resolve through the confirmed mapping with zero "unit not found" for mapped names.
- Team View: ten drags produce zero dialogs and one Apply; reload mid-session restores the pending moves; Discard clears them.
- Supervisor account still cannot move units outside its scoped venues.
- TypeScript build and existing tests pass.
