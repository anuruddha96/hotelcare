## Goal
Enable the live **Ottofiori** hotel on the existing Previo integration safely, without any code or DB changes yet. This plan is a rollout/runbook plus a list of pre-existing code issues to be aware of. Implementation would happen in a later, approved pass.

## What already works (verified from code)

- `_shared/previoAuth.ts` handles per-hotel credentials via `pms_configurations.credentials_secret_name` and Basic auth against `https://api.previo.app`, sending `X-Previo-Hotel-ID`. Multiple secret formats accepted (`user:pass`, JSON, name/value pairs).
- `previo-test-connection` — read-only ping to `/rest/rooms`, updates `last_test_status` on the config row. Admin or hotel-assigned only. Safe for Ottofiori.
- `previo-sync-rooms` **import branch** (`importLocal:true`) — pulls `/rest/rooms`, upserts into `rooms` and `pms_room_mappings` using the **physical** `roomId` (correct) and stores full metadata in `rooms.pms_metadata`.
- `previo-update-room-status` — pushes clean/dirty to `PUT /rest/rooms/{pms_room_id}/clean-status`, using `pms_room_mappings.pms_room_id`. Since the import writes the **physical** roomId there, the push targets the right room.

## Pre-existing issues to flag (do NOT fix in this pass)

1. **Hard gates on `hotel_id === 'previo-test'`** in two places:
   - `previo-sync-rooms/index.ts` line 119: import branch refuses any hotel other than `previo-test`.
   - `previo-update-room-status/index.ts` lines 62–68: silently no-ops the push for every hotel except `previo-test`.
   Ottofiori cannot go live until these gates are widened. Recommended future change: allow-list driven by a new `pms_configurations.push_enabled` flag (or an explicit slug set) rather than a hard-coded id.

2. **Broken non-import branch of `previo-sync-rooms`** (lines 297–367). It matches `pms_room_mappings.pms_room_id` against `roomData.roomKindId.toString()` — i.e. the **room-kind (type) ID**, not the physical `roomId` that the import branch actually writes. These two branches disagree on what `pms_room_id` means, so status-pull-back will silently "no mapping" for every row on any hotel imported via the import branch. Ottofiori should never call this branch until it is corrected. Use `previo-update-room-status` (push) + `previo-poll-checkouts` / `previo-nightly-sync` instead, or the import branch's own status seeding.

3. `previo-clean-status-probe` is a brute-force endpoint tryer — useful for diagnosis, but must not be run against a live tenant except in a read-only spirit; several candidates are `PUT`/`PATCH`.

## Prerequisites (config only, no code)

- Confirm the Previo hotel ID and API credentials for Ottofiori with the customer.
- Super admin creates a **per-hotel** Edge Function secret, e.g. `PREVIO_CREDS_OTTOFIORI`, value in one of the supported formats (`user:pass` is simplest).
- In `pms_configurations` for `hotel_id = 'ottofiori'` (create if missing):
  - `pms_type = 'previo'`
  - `pms_hotel_id = <numeric Previo hotel id>`
  - `credentials_secret_name = 'PREVIO_CREDS_OTTOFIORI'`
  - `is_active = true`
  - `sync_enabled = false` (kept off during read-only phases)
  - Any `auto_sync_enabled`, cron, or push flags left **off**.
- Ensure no `pms_room_mappings` rows exist yet for Ottofiori (fresh slate) — or export/backup existing ones.
- Announce a short maintenance window with reception + housekeeping leads; they should not manually flip room statuses while validation is running.

## Staged rollout

### Stage 0 — Preflight (read-only)
- Call `previo-test-connection` with `{ hotelId: 'ottofiori' }`. Expect `ok:true`, non-zero `roomCount`, latency reasonable, `last_test_status='ok'`.
- If it fails: inspect `last_test_error` and the function logs. Do not proceed.

### Stage 1 — Preview room list (read-only, no writes)
- Call `previo-sync-rooms` with `{ hotelId: 'ottofiori', previewOnly: true }`.
- Verify:
  - Room count matches Ottofiori's physical inventory.
  - Each row has a unique `roomId` (physical), plus `roomKindId`/`roomKindName`.
  - `name` values match HotelCare's expected room-number scheme (e.g. no "Onity 101" vs "101" collisions). If they don't, agree on a naming rule with ops before importing.

### Stage 2 — Import rooms + mappings (writes to HotelCare only, not Previo)
- This requires temporarily widening the `previo-test` gate in `previo-sync-rooms` (that's the one code change this rollout ultimately needs — flag it, but do not make it in this pass). Two safe options for the eventual patch: (a) allow-list `['previo-test','ottofiori']`, or (b) drive by a new `pms_configurations.import_enabled` flag.
- Once the gate is widened, call `previo-sync-rooms` with `{ hotelId: 'ottofiori', importLocal: true }`.
- Validate in DB:
  - `rooms` rows created with correct `hotel='ottofiori'`, `room_number`, `room_type`, `organization_slug`, and `pms_metadata.roomId` populated.
  - `pms_room_mappings` rows created; `pms_room_id` equals the **physical** `roomId` (not `roomKindId`). Spot-check ≥5 rows against `/rest/rooms` preview output.
  - Count of rows in `pms_room_mappings` for this config == count from Stage 1.
  - `pms_sync_history` row for this run has `sync_status='success'` (or 'partial' with a small, understandable error list).
- Roll-back plan if wrong: `DELETE FROM pms_room_mappings WHERE pms_config_id = <ottofiori cfg id>` and remove any brand-new `rooms` rows (identify by created_at within the import window and `pms_metadata->>roomId IS NOT NULL`).

### Stage 3 — Mapping validation (read-only, no Previo writes)
- For each mapping, verify round-trip in HotelCare:
  - Housekeeping status page shows every Ottofiori room.
  - No duplicate room numbers.
  - Random 5 sample: HotelCare `pms_metadata.roomId` == `pms_room_mappings.pms_room_id` == Previo `/rest/rooms[*].roomId`.
- Do **not** yet enable status push. Manually toggling statuses in HotelCare during this stage is safe because the push function is still gated to `previo-test`.

### Stage 4 — Single-room live write test (narrow, controlled)
- Prerequisite: widen the `previo-test-only` guard in `previo-update-room-status` — future one-line change; flag now, do not make it in this pass.
- Pick a single out-of-service / test room in Ottofiori (agreed with ops).
- Use `previo-clean-status-probe` first with `targetStatus:'clean'` and a single `pmsRoomId` (that one test room) if there is any doubt about the endpoint shape — the probe is exploratory but useful for a first-time hotel.
- Then trigger a real status change on that one room in HotelCare and confirm:
  - `previo-update-room-status` returns `success:true`, non-skipped.
  - `pms_sync_history` row `sync_type='room_status_update'`, `sync_status='success'`.
  - Ottofiori's Previo web UI shows the new status within seconds.
- Flip it back (dirty ↔ clean) once and verify again.

### Stage 5 — Controlled ramp
- Enable push for a single floor (10–15 rooms) for one full housekeeping shift. Monitor `pms_sync_history` for failures and Previo dashboard for drift.
- If clean for a shift, enable house-wide push. Leave `sync_enabled=true` only after 24 hours of quiet logs.
- Do not enable `previo-nightly-sync` or `previo-poll-checkouts` for Ottofiori until push is stable; those broaden the surface area.

## Monitoring & rollback

- Dashboards to watch: `pms_sync_history` failures per hour, `pms_configurations.last_sync_error`, Edge Function logs for `previo-update-room-status` and `previo-sync-rooms`.
- Kill switch: set `pms_configurations.is_active = false` (or `sync_enabled=false`) for `ottofiori`. Every function reads these and short-circuits.
- Emergency rollback: revert the gate widening in the two files above; Ottofiori falls back to no-op push, matching today's behaviour.

## Deliverables from this plan (later passes)

1. Small code change to widen the `previo-test`-only gates in `previo-sync-rooms` (import branch) and `previo-update-room-status`, driven by a config flag rather than a hard-coded slug.
2. Fix or removal of the broken non-import status-pull branch in `previo-sync-rooms` so it uses physical `roomId`, not `roomKindId`.
3. Optional: admin UI surface to run Stages 0/1/2/4 with a single click per hotel.

No files are edited in this pass.
