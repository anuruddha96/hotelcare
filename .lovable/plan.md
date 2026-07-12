## Scope
Deliver commits D1 → H1 from the approved rollout plan. All changes are additive and gated behind per-hotel flags. `previo-test` and current XLSX upload behavior remain 1:1 identical. Ottofiori stays at "kill-switch ON" until an admin flips flags in the new checklist UI.

Constraints already decided:
- Re-sync policy: **auto-apply safe changes, ask on risky**.
- Pilot room: **305**.
- Manual XLSX upload always remains available.

---

## D1 — Shared PMS normalizer (server-side)

**New file:** `supabase/functions/_shared/pmsNormalizer.ts`

Exports a pure function:
```
normalize(input: RawXlsxRow[] | PrevioApiRow[], meta: { hotelId, businessDate, source: 'xlsx' | 'api' })
  -> NormalizedSnapshot
```

`NormalizedSnapshot` shape (canonical, one row per **physical Previo roomId**):
- `previo_room_id`, `previo_room_kind_id`, `room_number`
- `stay_kind`: `checkout | daily | arrival | vacant | ooo`
- `guest_count`, `guest_nights_stayed`, `arrival_date`, `departure_date`
- `linen_change_required`, `towel_change_required`
- `notes`, `raw`

The normalizer contains ALL the business rules currently duplicated across the client XLSX parser and `previo-pms-sync`. Nothing else in the app changes yet — `previo-pms-sync` is refactored to import from this module and produce byte-identical rows (verified with a snapshot test) so no existing hotel is impacted.

---

## E1/E2 — Non-destructive diff + PmsChangesDrawer

**New file:** `supabase/functions/_shared/pmsDiff.ts`

```
diffSnapshot(previous: NormalizedSnapshot, next: NormalizedSnapshot)
  -> { safe: Change[], risky: Change[], unchanged: Change[] }
```

Classification:
- **Safe** (auto-apply): new arrival on vacant room, guest-count update, notes/linen/towel flag update, departure date pushed later while `stay_kind` unchanged, room becomes clean/inspected in Previo.
- **Risky** (needs approval): `stay_kind` transitions (checkout↔daily, checkout↔arrival), cancellations, room swaps, room reassigned to a different guest, `guest_nights_stayed` reset.

Applier rules:
1. Update `rooms` row for the affected room only.
2. **Never delete `room_assignments`** unless the room's `stay_kind` truly changes; even then, only touch the assignment for that room.
3. Write a `pms_change_events` row (table already exists) recording old → new, category (safe/risky), applied vs pending, actor, source.
4. Idempotency key `(hotel_id, business_date, source, content_hash)` → duplicate uploads are no-ops.
5. Emit a notification to hotel managers via existing notifications system when risky changes are pending or when safe changes were auto-applied in bulk.

**PmsChangesDrawer** (`src/components/pms/PmsChangesDrawer.tsx` already exists; extend it):
- Sections: **Auto-applied (safe)**, **Needs your approval (risky)**, **No change**.
- Per-risky-row: Apply / Ignore / Snooze buttons; bulk Apply-all.
- Live-updates via realtime on `pms_change_events`.
- Shows source (Previo / XLSX / manager override) and diff details.

Wiring:
- `previo-pms-sync` (XLSX path) invokes normalize → diff → apply-safe → persist-risky-pending → notify.
- The new `previo-sync-daily-overview` (added in G-stages) uses the same pipeline.
- Assignment-preservation logic is enforced at the DB layer with a safeguard trigger: any row-level `room_assignments` DELETE originating from a PMS sync must go through `pms_apply_change()` SECURITY DEFINER, which checks that stay_kind actually changed.

---

## F1 — Outbound queue for dirty→clean write-back

**Schema (new migration):**
- Table `public.pms_outbound_queue`: `id, hotel_id, room_id, previo_room_id, target_status, source_assignment_id, attempts (int, default 0), next_attempt_at, status (pending|in_progress|succeeded|failed|cancelled), last_error, created_at, updated_at`.
- GRANTs to `service_role`, RLS locked to service_role.
- Index `(status, next_attempt_at)` for the worker.
- Enqueue via `AFTER UPDATE` trigger on `room_assignments` when `supervisor_approved` flips true — **only** if the hotel's `pms_configurations` has `status_push_enabled=true`, `outbound_kill_switch=false`, and (when `outbound_room_allowlist` is non-empty) the `room_id` is in it. Guarded so `previo-test` behavior is unchanged.

**New edge function:** `previo-outbound-worker`
- Cron every 60 s (via existing pg_cron pattern).
- Picks up to N due rows, marks `in_progress`, calls `/rest/rooms/{physicalRoomId}/clean-status`, updates row.
- Backoff: 1 m, 5 m, 30 m, 2 h, 6 h; after 6 attempts → `failed`, alert surfaced in admin sync-health.
- Logs to `pms_sync_history`.

**Client change:** In `SupervisorApprovalView.tsx`, the existing best-effort `previo-update-room-status` invoke becomes a no-op fallback (the queue is authoritative). Approval remains fully decoupled from PMS success — no regression.

**Previo status enum constant** (verified against Previo REST docs during implementation): mapped in one place inside the worker.

---

## B2/B3 — Admin Activation Checklist UI + remove hardcoded gates

**Extend `src/components/admin/PMSConfigurationManagement.tsx`:**

Per-hotel activation panel showing an ordered checklist:
1. Credential secret present ✔ / Configure…
2. Connection test → button + last result badge.
3. Room discovery → button, list Previo rooms side-by-side with HotelCare rooms, mapping confidence.
4. Draft mapping import → confirms each mapping to `active`.
5. Snapshot read (shadow) → toggle + last diff summary.
6. Snapshot apply → toggle.
7. Status push → toggle.
8. Nightly sync → toggle.
9. Global: environment (test/live), outbound kill-switch, pilot room allowlist (multi-select of `rooms` for that hotel), notes.
10. Activate hotel button — sets `activated_at`, `activated_by`.

Each toggle writes to the flag columns added in Phase A; UI shows current state and provides an "explain what this does" tooltip. Toggling a stage OFF is always safe (instant rollback).

**Remove `previo-test`-only hardcoded gates** in:
- `supabase/functions/previo-update-room-status/index.ts` (the `hotel_id !== 'previo-test'` short-circuit).
- `supabase/functions/previo-sync-rooms/index.ts` (the `importLocal` restriction to `previo-test`).
- Replace with flag checks: `status_push_enabled`, `room_import_enabled`, etc. `previo-test` config already has all flags ON, so its behavior is unchanged.

---

## H1 — Manager PMS Upload section (Sync / Upload / Preview)

**Change:** the existing PMS upload UI block used by housekeeping managers.

New three-button layout (visible per-hotel based on flags):
- **Sync from Previo** — visible when `snapshot_read_enabled=true`; calls `previo-sync-daily-overview`.
- **Upload XLSX file** — always visible (unchanged behavior at the parsing entry point; downstream now goes through normalize → diff → apply).
- **Preview differences** — opens `PmsChangesDrawer`.

Header status chip:
- Last sync source + timestamp.
- Pending-risky count badge; clicking opens the drawer.
- Sync-health color (green/amber/red) driven by outbound queue + last sync status.

The button appearance, spacing, and copy match existing shadcn tokens — no visual redesign.

---

## Order of commits (each independently reviewable)

1. **D1** normalizer + refactor `previo-pms-sync` to use it (no behavior change; snapshot test proves parity).
2. **E1** `pmsDiff.ts` + `pms_apply_change()` SECURITY DEFINER + wire XLSX path through diff engine. Add `pms_change_events.category` enum if missing.
3. **E2** PmsChangesDrawer extension + notifications hook + realtime.
4. **F1** migration for `pms_outbound_queue` + trigger + `previo-outbound-worker` + cron schedule (data insert not migration).
5. **B2/B3** admin activation UI + remove hardcoded `previo-test` gates.
6. **H1** manager Sync/Upload/Preview UI + status chip.

---

## Safety rules held throughout
- No changes to auth, RLS on business tables, roles, revenue, breakfast, minibar, reservations, or ticket flows.
- Every new code path is gated by a flag defaulting to OFF (except `previo-test`, whose flags are pre-ON).
- Kill-switch on `pms_configurations` immediately stops both inbound diff-apply and outbound queue for that hotel.
- Assignment-preservation invariant enforced by a DB safeguard trigger, not just by application code.

---

## What I need from you before implementing
Nothing new — all prior questions are answered. On approval I'll ship D1 first (smallest, riskiest to get wrong) and check in before E1.

---

## D1 shipped
- `supabase/functions/_shared/pmsNormalizer.ts` (pure, unwired).

## E1 shipped (this turn)
- `supabase/functions/_shared/pmsDiff.ts` — pure classifier: safe / risky / noop per room. Unwired.
- Migration: `public.pms_apply_change(hotel, room, date, before, after, event_id)` SECURITY DEFINER. Never deletes existing assignments; on true `stay_kind` change it sets `pms_hold=true` on the row and links `pms_hold_event_id`. On safe changes it reports `updated_in_place` so the caller can UPDATE in place. `EXECUTE` revoked from PUBLIC, granted only to `service_role`.
- Added missing GRANTs to `pms_change_events` (SELECT, UPDATE for authenticated; ALL for service_role).
- No live code path calls the diff or the RPC yet — that is E2.

**Next: E2** — wire the XLSX upload path and `previo-sync-daily-overview` through `diffSnapshots`, persist `pms_change_events`, auto-apply SAFE via `pms_apply_change`, and extend `PmsChangesDrawer` to show Auto-applied / Needs approval sections with realtime.

## E2 shipped (this turn) — shadow-diff only
- New table `pms_snapshots` (per hotel + business_date) storing the last normalized snapshot. Hotel staff can view; only edge functions write.
- `pms_change_events` extended with `category` / `change_kind` / `auto_applied` columns (nullable / default false — no impact on existing rows or writers).
- New edge function `pms-shadow-diff`: accepts a NormalizedSnapshot, diffs against previous snapshot for the same (hotel, date), inserts categorized `pms_change_events`, upserts snapshot. Idempotent via content_hash short-circuit. NEVER mutates room_assignments or rooms.
- `PmsChangesDrawer` extended: shows "Needs approval" / "Auto-applied" / "Safe" badges and change_kind sub-label. Existing conflict/updates/resolved grouping preserved so no visible change until events with the new fields exist.
- Zero call sites yet: neither `PMSUpload.tsx` nor `previo-sync-daily-overview` invokes `pms-shadow-diff`. That one-line invocation is the very last touch of E2 and will be added on the next "next" so it can be reviewed alone.

**Next: E2 final** — add the fire-and-forget `pms-shadow-diff` invocation from the XLSX upload success path (in a try/catch that can never fail the upload), then the same from `previo-sync-daily-overview`.

## E2 final shipped (this turn)
- `pms-shadow-diff` now accepts raw XLSX rows (`{ raw: { rows, hotel_id, business_date, source } }`) and normalizes server-side, so no Deno-only code needs to be imported from the browser bundle.
- `PMSUpload.tsx` now invokes `pms-shadow-diff` once, fire-and-forget, right after the successful `pms_upload_summary` insert. The call is:
  - never `await`ed → cannot delay the upload;
  - wrapped in try/catch and a `.catch()` on the promise → cannot throw;
  - logs only via `console.warn` if the edge function returns an error.
- Skipped for `previo-sync-daily-overview` — that function is reservation-oriented, not physical-room-snapshot oriented. The equivalent API-side wiring belongs in `previo-sync-rooms` and will be added alongside F1 (outbound queue) so both sides move together.
- Net operational effect right now: on every XLSX PMS upload, `pms_change_events` and `pms_snapshots` get populated in the background. Everything else — room_assignments, rooms, upload summary, checkout automation — is unchanged.

**Next: F1** — `pms_outbound_queue` table + trigger on `room_assignments` (only enqueues when the hotel's `pms_configurations` has the outbound flag ON — `previo-test` today has it OFF, ottofiori has it OFF, so zero enqueues happen at rollout) + `previo-outbound-worker` cron.
