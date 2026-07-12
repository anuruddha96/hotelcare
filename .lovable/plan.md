## Goal
Enable Hotel Ottofiori's live Previo API for two flows only — **(1) morning PMS sync** (replacing/augmenting the manual XLSX upload) and **(2) room status write-back** on supervisor approval (dirty → clean) — without breaking any current functionality, and without resetting housekeeper assignments on re-sync.

Minibar and other flows stay out of scope for this phase.

---

## Phase B — Ottofiori credential + admin activation (no runtime behavior change yet)

**B1. Store the live credential as a per-hotel Edge Function secret**
- Secret name: `PREVIO_CREDS_OTTOFIORI` (format: `username:password` or JSON `{"username","password"}`).
- The user will paste it into the Supabase secret form I open — never into chat.
- `pms_configurations.credentials_secret_name` for Ottofiori will point to this secret. The existing `_shared/previoAuth.ts` already resolves per-hotel secrets, so no code change here.

**B2. Admin "Activation Checklist" panel** in `PMSConfigurationManagement.tsx`
Per-hotel toggles (all default OFF for Ottofiori, ON for `previo-test` unchanged):
- Connection test
- Room discovery (read `/rest/rooms`)
- Room import (write to `pms_room_mappings` — draft only, requires human confirm)
- Snapshot read (pull daily overview)
- Snapshot **shadow mode** (compare to manual XLSX, do NOT write to `rooms`)
- Status push (write-back to Previo)
- Nightly sync
- Outbound kill-switch + optional room allowlist

Admin sees: last connection test result, unmapped rooms count, mapping confidence, sync health, activation state.

**B3. Remove `previo-test`-only hardcoded gates** in edge functions, replaced by the per-hotel flags added in Phase A. `previo-test` behavior stays identical because its flags are pre-set ON.

---

## Phase C — Identity correctness (physical `roomId`, not `roomKindId`)

- Fix `previo-sync-rooms` to import from `/rest/rooms` using the physical **room ID** (not category `roomKindId`). Verified against Previo REST docs.
- Add a mapping audit query flagging any `pms_room_mappings.pms_room_id` that matches a known category ID.
- `previo-update-room-status` already uses `roomMapping.pms_room_id` in the path — verify once mappings are corrected.

---

## Phase D — Server-side normalizer (single source of truth)

Move Excel parsing logic from client into `supabase/functions/_shared/pmsNormalizer.ts`:
- Input: either parsed XLSX rows OR Previo API snapshot.
- Output: canonical `RoomDayState { room_number, status, is_checkout, is_stayover, guest_count, notes, linen_flags, towel_flags, departure_date, arrival_date, guest_nights }`.
- Both `previo-pms-sync` (manual XLSX) and the new `previo-sync-daily-overview` (API) call this normalizer, guaranteeing identical downstream behavior.

---

## Phase E — Non-destructive re-sync (the assignments-reset fix)

Current bug: second XLSX upload wipes housekeeper assignments. New rule set applied to BOTH manual and API paths:

1. **Diff, don't replace.** For each room compare incoming state vs current `rooms` row.
2. **Preserve existing `room_assignments`** unless the room's PMS-derived nature actually changed (e.g. was `checkout`, now `daily`).
3. **On meaningful change** (checkout↔daily, new arrival, guest count change, departure date shift, cancellation):
   - Update `rooms` row.
   - Emit a `pms_change_events` row (table already exists) with old/new snapshot.
   - Reassign or unassign only the affected room's assignment; leave every other assignment untouched.
   - Notify the hotel's manager(s) via the existing notifications system with a summary like "Room 207: checkout → daily stay (guest extended). Assignment updated."
4. **Manager review drawer** (`PmsChangesDrawer.tsx` already exists) surfaces the diff before applying, or a "Auto-apply safe changes / Ask on risky changes" toggle.
5. **Idempotency key** per snapshot (hotel_id + business_date + source) so accidental double-syncs are no-ops.

---

## Phase F — Outbound queue for status write-back

Reliable dirty→clean push to Previo:

1. `pms_outbound_queue` table (added in Phase A migration): `{ id, hotel_id, room_id, previo_room_id, target_status, attempts, next_attempt_at, status, last_error, created_at }`.
2. Trigger on `room_assignments` (when `supervisor_approved` flips true, same trigger that already sets `rooms.status='clean'`) inserts a queue row **only if** the hotel has `status_push_enabled=true` and `outbound_kill_switch=false` and (if allowlist set) room is in it.
3. New edge function `previo-outbound-worker` (cron every 1 min) pops due rows, calls `/rest/rooms/{roomId}/clean-status`, retries with backoff, logs to `pms_sync_history`.
4. Client-side best-effort call in `SupervisorApprovalView` becomes a no-op passthrough (the queue is authoritative). Approval remains decoupled from PMS success — no regression to existing behavior.
5. Status mapping fetched once from Previo docs and stored as a constant (`clean|dirty|inspected|out_of_order`); mismatch → queue row failed + surfaced in admin sync health.

---

## Phase G — Staged rollout for Ottofiori

Gate-by-gate, admin toggles each stage after verifying the previous:

1. **G1 Connection test** — `previo-test-connection` returns 200.
2. **G2 Room discovery (read-only)** — list `/rest/rooms`, show side-by-side with HotelCare rooms.
3. **G3 Draft mapping import** — write to `pms_room_mappings` with `mapping_status='draft'`; admin confirms per row to make it `active`.
4. **G4 Snapshot read (shadow)** — pull daily overview; compare to manager's XLSX; show diff report; do NOT write to `rooms`.
5. **G5 Snapshot apply (single-room allowlist)** — apply only for one pilot room (e.g. 207).
6. **G6 One-floor pilot** — expand allowlist.
7. **G7 Full snapshot apply** — Ottofiori-wide, XLSX upload still available as fallback.
8. **G8 Status push (single room)** — enable write-back only for pilot room via `outbound_room_allowlist`.
9. **G9 Full status push** — remove allowlist.
10. **G10 Nightly sync** enabled.

At every stage `outbound_kill_switch` and per-flag toggles allow instant rollback with zero code changes.

---

## Phase H — UI: manager "Sync source" control

On the housekeeping manager dashboard (existing PMS sync button area):
- **Sync from Previo** (visible when `snapshot_read_enabled`)
- **Upload XLSX** (always available)
- **Preview differences** (opens `PmsChangesDrawer`)
- Sync-health chip: last success time, source, unresolved changes count.

Manual XLSX upload stays as the fallback per user requirement.

---

## What will NOT change in this phase
- `previo-test` hotel behavior (all flags pre-enabled, identity fix aside).
- Any minibar, reservations, or revenue flow.
- The supervisor-approval → `rooms.status='clean'` trigger (already correct).
- RLS policies, auth flows, or roles.

---

## Deliverable order (small reviewable commits)

Phase A (done). Then:
- **C1** identity fix in `previo-sync-rooms` + mapping audit query.
- **D1** shared normalizer module.
- **E1** non-destructive diff for manual XLSX path (validates the diff engine using the flow we already have).
- **E2** notifications + PmsChangesDrawer wiring.
- **F1** outbound queue + worker + trigger.
- **B2/B3** admin activation panel + remove hardcoded `previo-test` gates.
- **G1–G2** wire Ottofiori through stages 1–2 (read-only, safe).
- **H1** manager sync-source UI.
- Stages **G3–G10** are admin-driven runtime actions, not code commits.

---

## Open questions before I start C1
1. Confirm the secret name **`PREVIO_CREDS_OTTOFIORI`** (I'll open the secure form when you approve — do not paste creds in chat).
2. For Phase E non-destructive re-sync, do you want **auto-apply for safe changes** (new arrivals, guest count updates) and **manager approval for risky changes** (checkout→daily, cancellations, room swaps), or **manager approval for everything** initially?
3. For the Ottofiori pilot room in G5/G8, is **207** the right room, or pick another?
