
# Previo live integration for Hotel Ottofiori — implementation plan

This plan turns the existing Previo test integration into a per-hotel, config-driven, multi-tenant PMS platform, then rolls Ottofiori out in supervised stages. Manual Excel upload stays as a first-class option. No live writes happen until the checklist in Stage 7 is satisfied.

I'm NOT asking you to paste the live credential in chat. The Ottofiori secret goes only into Supabase Edge Function Secrets under a dedicated name.

---

## Answers to your inline questions first

- **/bb page — room 216 (66EC.QRP216) in Ongoing:** treated as a separate small fix; scoped in Section 8 below. Root cause is almost certainly the checkout-day filter in `breakfast-public-lookup` treating today's departure as still "ongoing". Fix independent of the Previo work.
- **Preview vs live environment:** Lovable preview and the published app **share the same Supabase project and the same Edge Function secrets**. There is no automatic "test key in preview, live key in live". We get the same separation instead by using **per-hotel configuration**: `previo-test` keeps its own `PREVIO_CREDS_TEST` secret and `environment='test'`; Ottofiori uses `PREVIO_CREDS_OTTOFIORI` and `environment='live'`. Preview and production both talk to whichever hotel row you open — so the safety comes from feature flags on that row, not from the URL you visit. This is why Section 3 makes every dangerous capability an independently-gated flag that defaults to `false`.
- **"Same methods as test":** confirmed — same `/rest/rooms` for discovery, same `PUT /rest/rooms/{physicalRoomId}/clean-status` for write-back. No API contract change needed; only per-hotel credentials and config.
- **Keep manual upload:** yes. Manager UI gets a source toggle: **Sync from Previo / Upload file / Preview differences**, identical to the button pattern we used in the HotelCare test org.

---

## 1. Current architecture (verified)

- **Manual path:** `PMSUpload.tsx` parses Excel client-side and writes room snapshots/statuses through existing hooks.
- **API path today:** `previo-pms-sync` pulls `/rest/rooms`, reshapes rows into Excel-like objects, returns them to the browser which then feeds `PMSUpload`. Hard-gated to `hotel_id='previo-test'` (line 19, `ALLOWED_HOTEL_ID`).
- **Room discovery:** `previo-sync-rooms` — the **import branch** stores physical `roomId` correctly, but the **live-sync branch** matches `pms_room_mappings.pms_room_id` against `roomData.roomKindId` (category), which is the identity bug.
- **Write-back:** `previo-update-room-status` — hard-gated to `previo-test` (lines 62–68), best-effort client-side fire-and-forget from `SupervisorApprovalView.pushCleanStatusToPrevio`. No retry, no queue.
- **Local clean flip:** DB trigger `update_room_status_on_assignment_completion` (migration `20250909210854`) — remains the local source of truth. **Do not touch.**
- **Config:** `pms_configurations` already has `credentials_secret_name`, `pms_hotel_id`, `is_active`, `sync_enabled`. Missing: environment, per-capability flags, kill switch, last-test timestamps.
- **Auth:** `_shared/previoAuth.ts` — HTTP Basic, per-config `credentials_secret_name` with a global env fallback. Already suitable; fallback will be deprecated once every active config has a dedicated secret.

### Confirmed hardcoded `previo-test` gates to remove/replace
- `previo-pms-sync/index.ts` — `ALLOWED_HOTEL_ID = 'previo-test'`
- `previo-update-room-status/index.ts` — L62-68 skip guard
- `previo-sync-rooms/index.ts` — non-import branch gate (see file)
- `previo-poll-checkouts`, `previo-nightly-sync` — verify and replace with config flag reads
- Any client-side `hotel === 'previo-test'` conditionals in `PMSConfigurationManagement.tsx`, `PmsSyncStatus.tsx`, `PMSUpload.tsx`

### Confirmed identity bug
`previo-sync-rooms` live-sync branch: comparing `pms_room_mappings.pms_room_id` (physical) against `roomData.roomKindId` (category). Must compare against `roomData.roomId`. A pre-flight audit query will scan `pms_room_mappings` for values matching any known `roomKindId` (982505, 976815, 977103, 982615, 982617) and quarantine them.

---

## 2. Target architecture

```text
 Manual Excel  --\
                   >-->  server-side normalizer  -->  snapshot writer  -->  rooms / assignments
 Previo /rest ---/           (shared rules)              (idempotent)

 SupervisorApproval  -->  DB trigger sets rooms.status='clean'
                              |
                              +--> outbox row in pms_outbound_queue
                                        |
                                        v
                              pms-outbound-worker (cron)
                                        |
                                        v
                       PUT /rest/rooms/{physicalRoomId}/clean-status
                                        |
                                        v
                              pms_sync_history (audited)
```

Key principles: **config-driven per hotel**, **independent read/write flags**, **outbox + retries for writes**, **server-side normalization**, **physical roomId is the only identity used for write-back**.

---

## 3. Database changes (phase A migration)

### 3.1 Extend `pms_configurations`
Add columns (all nullable/defaulted so existing rows stay valid):
- `environment` text check in ('test','live') default 'test'
- `connection_test_enabled` bool default true
- `room_discovery_enabled` bool default false
- `room_import_enabled` bool default false
- `snapshot_read_enabled` bool default false
- `snapshot_shadow_mode` bool default true
- `status_push_enabled` bool default false
- `checkout_poll_enabled` bool default false
- `nightly_sync_enabled` bool default false
- `outbound_kill_switch` bool default false
- `outbound_room_allowlist` uuid[] null (single-room / one-floor pilot gate)
- `last_connection_test_at/status/error`
- `activated_at`, `activated_by` (uuid → profiles)

Backfill: `previo-test` row gets `environment='test'` and all the flags it currently uses turned on so nothing regresses.

### 3.2 Harden `pms_room_mappings`
- Add optional `hotelcare_room_id uuid` (FK to `rooms.id`) alongside existing `hotelcare_room_number`.
- Add `mapping_status` (`pending|active|ignored|error`), `confidence numeric`, `last_verified_at`, `notes`.
- Unique index: `(pms_config_id, pms_room_id) where mapping_status='active'`.
- Unique index: `(pms_config_id, hotelcare_room_id) where mapping_status='active'`.
- Validation trigger: reject insert/update where `pms_room_id` matches a known category id list stored in a new `pms_known_category_ids` table (populated from Previo discovery).

### 3.3 New `pms_outbound_queue`
Columns as you listed: id, organization_id, hotel_id, pms_config_id, assignment_id, room_id, pms_room_mapping_id, external_room_id, action, target_status, idempotency_key (unique), status, attempt_count, max_attempts, next_attempt_at, last_attempt_at, last_error, response_status, response_body_sanitized, created_at/by, completed_at, cancelled_at.
- Unique on `idempotency_key = pms_config_id||assignment_id||external_room_id||target_status`.
- RLS: org-scoped read for managers of that hotel; insert only via SECURITY DEFINER trigger; update only by service role (worker).
- GRANTs: `authenticated` SELECT, `service_role` ALL. No anon.

### 3.4 Trigger to enqueue on approval
New AFTER-UPDATE trigger on `room_assignments`: when `supervisor_approved` flips false→true, if a matching active config with `status_push_enabled=true AND outbound_kill_switch=false` and a single active physical mapping exist, insert one row into `pms_outbound_queue` with the idempotency key. **The existing local `rooms.status='clean'` trigger is untouched.** Client-side `pushCleanStatusToPrevio` will be removed once the worker is live.

### 3.5 Rollback
Every migration ships with a matching `down` SQL snippet in the description (drop new columns/tables, restore old trigger set). No destructive data changes — new columns default so old code keeps working.

---

## 4. Edge Function changes

- **`_shared/previoAuth.ts`** — no contract change, keep Basic. Remove global-env fallback only after every active config has a dedicated secret name (Phase C).
- **`previo-sync-rooms`** — fix live-sync branch to key on physical `roomId`; remove `previo-test` guard; require `room_discovery_enabled`; add `previewOnly` diff output already present.
- **`previo-pms-sync`** — remove `ALLOWED_HOTEL_ID`; gate on `snapshot_read_enabled`; when `snapshot_shadow_mode=true`, write to `pms_sync_history` only (comparison payload), never mutate `rooms`. Move normalization server-side into a new `_shared/pmsNormalizer.ts` and expose a `NormalizedPmsRoomSnapshot` shape identical for manual and API inputs. `PMSUpload.tsx` still works; both adapters call the shared writer.
- **`previo-update-room-status`** — remove `previo-test` guard; refuse if mapping missing or `pms_room_id` matches a known category id.
- **New `pms-outbound-worker`** (cron every minute via pg_cron): claim ≤N pending rows with `FOR UPDATE SKIP LOCKED`, revalidate config+mapping+kill switch+allowlist, call Previo, record attempt, exponential backoff up to `max_attempts`.
- **`previo-poll-checkouts` / `previo-nightly-sync`** — gate on their respective flags, no hardcoded hotel.

All functions keep `verify_jwt` as configured today except the cron worker (unauthenticated, called by pg_cron with the anon key).

---

## 5. Frontend changes

- **`PMSConfigurationManagement.tsx`** — per-org/per-hotel selector, environment badge, feature-flag switches with confirmation modal for live write-back, activation checklist widget, mapping table with suggested matches / confidence / ignore / raw metadata view. Never renders the secret value.
- **`PmsSyncStatus.tsx`** — organization/hotel/date/direction filters; retry / cancel / revalidate-mapping actions.
- **`PMSUpload.tsx` / manager dashboard** — three-action bar: **Sync from Previo**, **Upload file**, **Preview differences**. Shows current data source, last sync, business date, unmatched rooms, shadow-vs-live badge.
- **`SupervisorApprovalView.tsx`** — remove direct `pushCleanStatusToPrevio` call once outbox trigger is live; display per-assignment PMS state (pending / succeeded / retrying / failed).
- All access role-gated via existing tenant context; no cross-org leakage.

---

## 6. Credential handling

- Create Edge Function Secret **`PREVIO_CREDS_OTTOFIORI`** (Basic format: `username:password` or JSON `{username,password}` — parser already supports both). You add it in Supabase; I never see the value.
- Set `pms_configurations` row for `hotel_id='ottofiori'`: `pms_type='previo'`, `pms_hotel_id=<numeric>`, `credentials_secret_name='PREVIO_CREDS_OTTOFIORI'`, `environment='live'`, `is_active=true`, all read/write flags **false** initially.
- Global env fallback in `previoAuth.ts` remains for `previo-test` compatibility during migration; deprecated once every active config has its own secret.

---

## 7. Ottofiori staged rollout (config-only after code phase A/B ship)

| Stage | Action | Guard | Acceptance |
|---|---|---|---|
| 0 | Ship code A (DB migration, flags, identity fix, mapping validator, admin UI, outbox+worker, tests) | none | CI green, `previo-test` still fully working |
| 1 | Create Ottofiori config row + secret | all flags false | row visible in admin |
| 2 | Enable `connection_test_enabled`, run test | read-only | 200 OK, ~21 physical rooms |
| 3 | Enable `room_discovery_enabled`, run `previewOnly` sync | read-only | 21 unique physical roomIds, no category IDs present |
| 4 | Import mappings, admin reviews | write-back off | 21 active mappings, no dupes, no category IDs |
| 5 | `snapshot_read_enabled=true`, `snapshot_shadow_mode=true` for ≥3 operating days | no room mutation | shadow diff ≤ agreed threshold vs manual file |
| 6 | Turn shadow off, keep manual upload available | write-back still off | 1 operating day clean |
| 7 | `status_push_enabled=true` + `outbound_room_allowlist=[<one room>]` | one-room test | single Previo room flips clean; siblings unchanged; one audit row |
| 8 | Widen allowlist to one floor for a shift | pilot | no wrong-room updates, retries behave |
| 9 | Clear allowlist for full activation; enable `checkout_poll_enabled` and `nightly_sync_enabled` **separately**, one at a time | full live | 24h clean |

`outbound_kill_switch=true` on the config row disables the worker for that hotel immediately at any stage.

---

## 8. Small side fixes bundled with Phase A

- **/bb Ongoing showing checkout rooms (66EC.QRP216, 115):** patch `breakfast-public-lookup` so a reservation whose `departure_date = today` moves to Departures, not Ongoing. Add regression sample fixture. Independent of Previo work; low risk.

---

## 9. Test plan

Automated (Deno + Vitest):
- Identity: physical vs category id; duplicate mapping rejected; DB/TW-203 and TRP-305 name normalization.
- Tenancy: cross-org read/config blocked; housekeeper cannot see PMS admin; sync history org-scoped.
- Approval flow: completion → no outbox row; approval → exactly one row; duplicate approval → no second row; bulk approval → one row per physical room.
- Failure: missing mapping blocks call; 401/403 sanitized; timeout schedules retry; kill switch halts worker; manual upload still works during outage.
- Snapshot: idempotent repeat; shadow mode makes zero room writes; failed API leaves ops state intact; manual and API produce identical `NormalizedPmsRoomSnapshot` for a fixture pair.

Manual: full Stage 7 script with hotel ops on one agreed Ottofiori room.

---

## 10. Files that will change (phase A)

- `supabase/migrations/<new>_pms_multitenant.sql` (schema + trigger + queue + validator)
- `supabase/functions/_shared/previoAuth.ts` (deprecate global fallback logging)
- `supabase/functions/_shared/pmsNormalizer.ts` (new)
- `supabase/functions/previo-sync-rooms/index.ts` (identity fix + flag gate)
- `supabase/functions/previo-pms-sync/index.ts` (remove test gate, shadow mode, use normalizer)
- `supabase/functions/previo-update-room-status/index.ts` (remove test gate, validate mapping)
- `supabase/functions/pms-outbound-worker/index.ts` (new)
- `supabase/functions/breakfast-public-lookup/index.ts` (Ongoing/Departures fix)
- `supabase/config.toml` (register worker)
- `src/components/admin/PMSConfigurationManagement.tsx`
- `src/components/admin/PmsSyncStatus.tsx`
- `src/components/dashboard/PMSUpload.tsx`
- `src/components/dashboard/SupervisorApprovalView.tsx` (remove client push)
- Tests under `supabase/functions/**/__tests__` and `src/**/__tests__`

---

## 11. Risks and open questions

- **Previo numeric hotel ID for Ottofiori** — need the exact numeric ID (safe to paste in chat; not a secret).
- **Category id list** — confirm the five you listed are complete; otherwise the validator seeds from discovery.
- **Manager UX for pending PMS state** — do you want a badge in the room card, or only in the sync history panel?
- **pg_cron availability** on this Supabase project — must be enabled before the outbound worker ships.
- **Global env credential deprecation** — safe to remove once `previo-test` moves to `PREVIO_CREDS_TEST`; confirm timing.

---

## 12. Delivery order (small, reviewable commits)

1. DB migration + backfill for `previo-test` (no behavior change).
2. Identity fix in `previo-sync-rooms` + mapping validator + audit report.
3. Server-side normalizer + shadow mode in `previo-pms-sync`, remove test gate.
4. Outbound queue + trigger + worker + remove client push.
5. Admin UI: flags, activation checklist, mapping table.
6. `/bb` Ongoing/Departures fix.
7. Ottofiori config row + secret + Stages 2→9 executed as ops tasks, not code changes.

I will stop after each commit for review before starting the next.

Awaiting approval to proceed with Phase A (steps 1–2) only.
