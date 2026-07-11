## Previo Live-Rollout Architecture Audit (read-only)

No code, DB, secret, or setting changes are proposed here. This is a findings + rollout report.

---

### 1. Manual Excel path (baseline the API must reproduce)

Flow: `src/components/dashboard/PMSUpload.tsx` → `processFile(file)` (client-side XLSX parsing with SheetJS) → derives per-room fields → updates `public.rooms`, seeds/refreshes `daily_overview_snapshots` (source='manual'), computes checkout/stayover lists, and drives Team View / Auto-Assign.

Normalized fields the API path must reproduce for every hotel:
- Physical room identity (`room_number`, optionally `pms_metadata.roomId`)
- `status` (dirty / clean / OOO)
- `is_checkout_room` / stayover / arriving flags for today (business_date)
- `guest_count` / pax
- Meal flags: `hasBreakfast`, `hasLunch`, `hasDinner`, `isAllInclusive`
- Guest names / notes (for HK context)
- Linen/towel / DND hints where present
- `daily_overview_snapshots` row per (hotel_id, business_date, room_label, source) — the unique index makes re-imports idempotent per source.

Business rules embedded in `processFile` (checkout vs stayover vs arriving; "no service" rules; meal aliases inc. HU "Reggeli/Vacsora"; `_shared/roomCode.ts` room-label normalization) currently live in the browser. Anything the API path emits must feed the same normalization or these rules diverge.

---

### 2. Current Previo snapshot path vs Excel

- `supabase/functions/previo-pms-sync/index.ts` calls Previo `/rest/rooms` + XML `searchReservations`, builds pseudo-Excel rows, returns them to the browser.
- `PMSUpload.tsx` (≈ lines 985-1015) takes those rows, writes them into an in-memory XLSX with SheetJS, wraps in a `File`, then calls `processFile(file)` — the same manual code path.

Problems:
- **Two adapters, one normalization — but the normalization lives on the client.** Fragile, unauditable, no idempotency, no retry.
- **Reset side-effects on the client.** `setResults(null); setCheckoutRooms([]); setDailyCleaningRooms([]);` happen before the sync succeeds. A partial API failure can wipe UI state that no longer matches DB.
- **Snapshot writer split.** `previo-sync-daily-overview` writes `daily_overview_snapshots` (source='previo') server-side, but `previo-pms-sync` returns rows that go through the manual pipeline (source='manual'). Two sources of truth for the same day are possible.
- **Duplicated auth/creds parsing.** `previo-pms-sync` re-parses the credentials secret inline instead of using `_shared/previoAuth.ts` (which is used by other functions). Divergent parsers = credential-format bugs.
- **Checkout logic split.** `previo-poll-checkouts` runs server-side but is gated to `previo-test` and is invoked from both `PMSUpload` and `LiveSyncContext`; manual path derives checkouts client-side. Two truths.

Ideally normalization moves to a single server-side importer with two adapter inputs (XLSX bytes, Previo REST/XML) → one normalized snapshot → one writer to `rooms` + `daily_overview_snapshots` + `pms_change_events`.

---

### 3. Housekeeper completion → manager approval → outbound push

- Housekeeper completion: mutates `public.room_assignments` (`completed_at`, `status`) and `rooms.status='dirty'→ready_for_inspection` via `AssignedRoomCard.tsx` / `HousekeepingTab.tsx`.
- Manager approval: `src/components/dashboard/SupervisorApprovalView.tsx` at approve-single (~line 555) and `handleBulkApprove` (~line 615) updates `room_assignments.supervisor_approved{,_by,_at}=true` then calls `pushCleanStatusToPrevio(assignment.room_id)` (line 594) → `supabase.functions.invoke('previo-update-room-status', { roomId, status: 'clean' })`.
- Edge function `supabase/functions/previo-update-room-status/index.ts` reads `rooms` → `pms_configurations` → `pms_room_mappings.hotelcare_room_number === room.room_number` → PUT `/rest/rooms/{pms_room_id}/clean-status` with `{status:'clean'}`.

Correctness:
- **Push happens after** `supervisor_approved=true` DB write. Order is correct (per user requirement).
- **Push is gated to `hotel_id === 'previo-test'`** (lines 64-71). For Ottofiori this silently returns `{skipped:true}` — this is the observed log line "No PMS configuration found for hotel: Hotel Ottofiori" style skips.
- **Duplicate call risk.** Bulk approve loops per row and awaits sequentially — OK. But there is no idempotency key sent to Previo, no `pms_sync_history` de-dup check, and no debounce, so a fast re-click of the approve button on the same assignment issues N pushes. Also no outbox/retry table: if Previo returns 5xx the failure is toasted and lost.
- **Hotel identity mismatch source.** `previo-update-room-status` matches by `hotelcare_room_number === room.room_number` (physical). That's correct only because `pms_room_mappings.pms_room_id` should be the physical Previo `roomId`. See §6.

---

### 4. Admin console + config surface

Present:
- `pms_configurations` (23 cols): `hotel_id`, `pms_type`, `pms_hotel_id`, `credentials_secret_name`, `is_active`, `sync_enabled`, `auto_sync_enabled`, `connection_mode`, `last_test_at/status/error`, `last_sync_at`.
- `pms_room_mappings` (8 cols): `pms_config_id`, `hotelcare_room_number`, `pms_room_id`, `pms_room_name`, `is_active`.
- `rooms.pms_metadata` JSON: stores `{roomId, roomKindId, roomKindName, roomTypeId, ...}`.
- `pms_sync_history` (10 cols): direction, sync_type, sync_status, data, error_message.
- `pms_change_events`, `pms_upload_summary` for delta events.
- Admin UI: `src/components/admin/PMSConfigurationManagement.tsx` (490 lines: per-hotel config CRUD, test-connection, room-mapping CRUD) and `PmsSyncStatus.tsx` (331 lines: history + manual "Sync rooms now").

Missing for a reusable multi-tenant admin console:
- **Feature flags per hotel** (read-snapshot / write-status / poll-checkouts / nightly-sync — currently code-level `previo-test` gates instead of DB-driven flags).
- **Room discovery diff UI:** show Previo rooms vs HotelCare rooms with auto-match, confidence score, unresolved, extra-in-PMS, extra-in-HotelCare.
- **Category vs physical room clarity:** UI does not distinguish `roomKindId` from `roomId`; admin can mistakenly paste a category ID.
- **Credential health per hotel:** no dedicated view of "last test at, credential secret name resolved, HTTP status" grouped by hotel.
- **Activation checklist gate:** no rule that write-back is disabled until (test OK) + (100% mappings resolved) + (dry-run reviewed).
- **Outbox / retry:** no queue table for pending pushes; no admin view of failed pushes to re-drive.
- **Per-org grouping:** UI iterates hotels but does not group by `organizations`.
- **Kill switch:** no single toggle to halt all outbound writes org-wide.

---

### 5. Hardcoded gates / assumptions to `previo-test` (blocks Ottofiori)

Every one of these must be replaced with a DB-driven flag before rollout:
- `supabase/functions/previo-update-room-status/index.ts` L64-71: `if (pmsConfig.hotel_id !== 'previo-test') return skipped`.
- `supabase/functions/previo-sync-rooms/index.ts` L117-124: `importLocal` returns 403 for any hotel other than `previo-test`.
- `supabase/functions/previo-pms-sync/index.ts` L15, L78-88: `ALLOWED_HOTEL_ID='previo-test'`, 403 otherwise.
- `supabase/functions/previo-nightly-sync/index.ts` L2, L14: `ALLOWED_HOTEL_ID='previo-test'`.
- `supabase/functions/previo-poll-checkouts/index.ts`: gated to previo-test (invoked with hardcoded hotelId).
- `supabase/functions/previo-pull-revenue/index.ts` L24: `ALLOWED_HOTEL_ID='previo-test'`.
- `supabase/functions/previo-clean-status-probe/index.ts` L79: default hotelId `'previo-test'`.
- `supabase/functions/previo-probe/index.ts` L37: `.eq('hotel_id', 'previo-test')`.
- `src/lib/pmsRefresh.ts` L246: `if (hotelId === 'previo-test')`.
- `src/contexts/LiveSyncContext.tsx` L190: `if (hotelId !== 'previo-test') return`.
- `src/components/dashboard/PMSUpload.tsx` L975, L1029, L1043: `selectedHotel === 'previo-test'` guards around catalog sync + checkout poll.
- `supabase/functions/_shared/previoAuth.ts` L118-122: legacy global `PREVIO_API_USERNAME/PASSWORD` env fallback (should be removed once per-hotel `credentials_secret_name` is enforced).

---

### 6. Physical roomId vs roomKindId (category) — CRITICAL BUG

`supabase/functions/previo-sync-rooms/index.ts` has two branches:
- **Import branch (L152-245)** correctly stores physical `roomId` in `rooms.pms_metadata.roomId` and inserts `pms_room_mappings.pms_room_id = String(r.roomId)`. Correct.
- **Live-sync branch (L297-360)** matches mappings using `roomData.roomKindId.toString()`:
  - L322 `const roomKindId = roomData.roomKindId.toString();`
  - L327 `roomMappings.find(m => m.pms_room_id === roomKindId)` — mapping table stores physical `roomId`, so **every lookup will miss** and every row produces "No mapping for room kind: …". This branch is currently unusable.

`previo-update-room-status/index.ts` correctly uses `roomMapping.pms_room_id` (physical) in the `/rest/rooms/{id}/clean-status` URL — that path is fine assuming mappings were populated by the import branch (not manually pasted with a category ID).

Ottofiori categories the user listed (982505 / 976815 / 977103 / 982615 / 982617) are `roomKindId` values. If any admin pastes them into `pms_room_mappings.pms_room_id`, every push will hit `/rest/rooms/982505/clean-status` and either 404 or wrongly touch a category — the admin UI must reject non-physical IDs.

---

### 7. Target architecture (recommendation, no code)

```
+-----------------+       +----------------------+       +------------------+
|  XLSX Adapter   | --->  |                      | --->  |  rooms           |
|  (bytes)        |       |  Normalizer          |       |  daily_overview_ |
+-----------------+       |  + business rules    |       |    snapshots     |
+-----------------+       |  + idempotency key   |       |  pms_change_     |
|  Previo Adapter | --->  |  (server-side)       |       |    events        |
|  REST + XML     |       |                      |       +------------------+
+-----------------+       +----------------------+
                                     |
Approval event (DB trigger / edge) --+--> Outbox row (pms_outbound_queue)
                                                       |
                                                       v
                                     Worker: push to Previo, retry w/ backoff,
                                     write pms_sync_history, ack row.
```

Key properties:
- **Per-hotel credentials only.** Remove legacy `PREVIO_API_USERNAME/PASSWORD` fallback. Every hotel must have `credentials_secret_name`.
- **Config-driven feature flags** on `pms_configurations`: `feature_read_snapshot`, `feature_write_clean_status`, `feature_poll_checkouts`, `feature_nightly_sync`, `feature_shadow_mode` (writes only to history, does not call Previo).
- **Room discovery** endpoint returns diff (PMS-only, HC-only, matched, mismatched-name) + confidence — admin resolves.
- **Idempotency**: push key = `assignment_id + status + attempt_bucket`. Server refuses duplicate within N minutes.
- **Outbox + retry** table: `pms_outbound_queue(id, hotel_id, room_id, target_status, attempts, next_attempt_at, last_error, done_at)`.
- **Approval trigger**: DB trigger on `room_assignments.supervisor_approved=true` inserts an outbox row; the client no longer directly invokes the push (removes double-click risk).
- **Audit**: every push/pull writes to `pms_sync_history` with `direction`, `data`, `error_message`, `changed_by`.
- **Kill switch**: `organization_settings.pms_writes_enabled=false` short-circuits the worker.

---

### 8. Staged Ottofiori rollout (config + gated code widening only, per stage)

| Stage | Scope | Gate widening | Acceptance | Rollback |
|---|---|---|---|---|
| 0 Preflight | secret + config | none | `PREVIO_CREDS_OTTOFIORI` set; `pms_configurations` row exists; `sync_enabled=false`; all feature flags off | delete row + secret |
| 1 Connection | `previo-test-connection` (already ungated) | none | `ok:true`, `roomCount≥21`, latency<2s | none |
| 2 Read-only preview | `previo-sync-rooms { previewOnly:true }` | none | JSON returns 21 physical rooms w/ unique `roomId`; user confirms names | none |
| 3 Mapping import | `previo-sync-rooms { importLocal:true }` | widen L119 guard to allow Ottofiori under a DB feature flag | 21 `rooms` rows w/ `pms_metadata.roomId` populated; 21 `pms_room_mappings` w/ `pms_room_id=physical roomId`; zero mappings equal to any of {982505, 976815, 977103, 982615, 982617} | delete Ottofiori mappings + rooms |
| 4 Snapshot shadow | `previo-pms-sync` widen to Ottofiori, but keep `feature_shadow_mode=true` — write only to `pms_sync_history` and `daily_overview_snapshots (source='previo')`, do NOT drive `rooms.status` | 3 consecutive days of shadow snapshots match manual upload for the same day (allow diff report) | flip `feature_read_snapshot=false` |
| 5 Manual-vs-API diff | script/report comparing manual XLSX vs `previo` snapshot for same business_date | ≤2% row diff, all diffs explainable | keep manual as source |
| 6 One-room write | approve a single test room (marked internally) → outbox → push | Widen `previo-update-room-status` gate for Ottofiori with feature_flag AND `room_id in (single test room)` | Previo UI shows clean; `pms_sync_history.sync_status='success'`; no duplicates | set `feature_write_clean_status=false` |
| 7 One-floor pilot | enable write for floor 1 rooms only | flag scoped by room list | 24h with 0 duplicate pushes, <1% failure | disable flag |
| 8 Full launch | write enabled house-wide; nightly + checkout poll on | remove hard-coded hotel gates entirely | 7 days steady; failure/retry rate acceptable | flip org-wide kill switch |

---

### 9. Admin UX (future hotel onboarding)

1. **Hotels list** (per organization): status pills for Connection / Mappings / Read / Write / Poll / Nightly.
2. **New Hotel wizard**:
   - Step 1: choose PMS type, enter `pms_hotel_id`, choose `credentials_secret_name` from an existing-secret dropdown (or "Add new secret" deep link).
   - Step 2: "Test connection" (must pass to continue).
   - Step 3: "Discover rooms" (read-only preview from `/rest/rooms`).
   - Step 4: "Room mapping table" — 3-column: HotelCare room | suggested Previo physical room (auto-match by exact name → fuzzy → capacity/type fallback) with confidence chip (High/Med/Low) | actions. Reject any row whose Previo ID equals a known category/`roomKindId` — visible warning.
   - Step 5: Unresolved list (PMS-only + HC-only + low-confidence). Must reach 100% or explicit "ignore".
   - Step 6: Activation checklist — [x] test ok [x] mappings 100% [x] shadow snapshot 3 days [x] super-admin countersign → then feature flags become editable.
3. **Sync health panel**: per-function last run, latency, success%, last error, "Kill switch" toggle.
4. **Outbox viewer**: pending pushes, failed pushes with "Retry" and "Discard".
5. **Audit**: `pms_sync_history` filtered by hotel/date/direction/status.

---

### 10. Findings by priority

**Critical blockers (must fix before any Ottofiori pilot):**
- `previo-sync-rooms` live-sync branch matches on `roomKindId` (category) instead of physical `roomId` — `previo-sync-rooms/index.ts` L322-327.
- `previo-update-room-status` hard-gated to `previo-test` — L64-71.
- `previo-sync-rooms` import branch hard-gated to `previo-test` — L119-124.
- `previo-pms-sync` hard-gated to `previo-test` — L15, L78-88.
- Client-side reset of results before sync completes (`PMSUpload.tsx` ~L953-956) can wipe UI on partial failure.
- No idempotency / outbox on outbound push — duplicate clicks push duplicates (`SupervisorApprovalView.tsx` L555, L615).
- Admin console lets you paste any string into `pms_room_mappings.pms_room_id`; category IDs are not rejected (`PMSConfigurationManagement.tsx`).

**Should fix before pilot:**
- Move snapshot normalization server-side; stop round-tripping API rows through an in-memory XLSX (`PMSUpload.tsx` L1015-1024).
- Replace `previo-test` string gates with `pms_configurations` feature flags across `previo-nightly-sync`, `previo-poll-checkouts`, `previo-pull-revenue`, `previo-clean-status-probe`, `previo-probe`, `pmsRefresh.ts`, `LiveSyncContext.tsx`.
- Consolidate credential parsing to `_shared/previoAuth.ts` (remove inline parser in `previo-pms-sync` and `previo-sync-daily-overview`).
- Remove legacy env fallback `PREVIO_API_USERNAME/PASSWORD` (`_shared/previoAuth.ts` L118-122).
- Distinguish "manual" vs "previo" source in UI (Rooms / Team View) so shadow-mode discrepancies are visible.
- Add DB trigger on `room_assignments.supervisor_approved` → outbox instead of client-invoked push.

**Later platform improvements:**
- Extract a `pms-normalizer` shared module used by both adapters.
- Per-org `pms_writes_enabled` kill switch in `organization_settings`.
- Retry worker (cron) reading `pms_outbound_queue` with exponential backoff.
- Admin room-discovery diff view with auto-match + confidence scoring.
- Onboarding wizard replacing free-form CRUD.
- Metrics dashboard: push latency, failure %, snapshot freshness per hotel.
- Structured error taxonomy in `pms_sync_history.data` (currently free-form JSON).
