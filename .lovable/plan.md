## Goal

Three connected fixes for the Previo integration, all hard-gated to `hotel_id = 'previo-test'` so OttoFiori and other hotels are untouched.

---

### 1. Fix: Checkout rooms staying dirty after Previo says "Clean"

**Root cause.** Two edge functions disagree on Previo's `roomCleanStatusId` mapping:

- `previo-pms-sync` (line 267): `r.roomCleanStatusId === 1 ? "Clean" : "Untidy"`
- `previo-sync-rooms` (line 285): `1 → dirty, 2 → clean, 3 → clean (inspected), 4/5 → dirty`

Per Previo's REST docs the second mapping is correct (`1 = Untidy/Dirty`, `2 = Clean`, `3 = Inspected`). The `previo-pms-sync` row producer is emitting the inverse `Status` label, then `pmsRefresh.ts` writes that wrong value to `rooms.status`. That is why Onity 101 and 105 show dirty in Hotel Care after a sync where Previo had them clean.

**Fix.**
- Correct the mapping in `previo-pms-sync/index.ts` to: `1 → "Untidy"`, `2 → "Clean"`, `3 → "Clean"`, `4 → "Untidy"`, `5 → "Untidy"`, unknown → `null` (skip update instead of forcing dirty).
- In `src/lib/pmsRefresh.ts` keep the current rule "Previo is source of truth" — already implemented; this fix just makes the upstream label correct so checkout rooms become `clean` when Previo says so, and stay `dirty` when Previo says dirty.
- The local Check-Out dialog will keep setting status to `dirty` at checkout time (that's the expected initial state); the next PMS sync overrides it with Previo's truth.

---

### 2. Multi-category room support (Onity 101 / Salto 101 / 101 etc.)

Previo can return several rooms with overlapping numeric names but different `roomKindName` (categories shown in the sidebar of the screenshot: KouzelneChaloupky, Pokoje pokus, Zakwaterowanie). Today the import keys rooms by `room_number` alone, which collapses them or causes wrong matches.

**Backend (previo-test only).**
- Import step (`previo-sync-rooms`, importLocal branch): store the full Previo `name` as `room_number` *as-is* (so "Onity 101", "Salto 101", "101" stay distinct) AND always set `pms_metadata.roomId` + `pms_metadata.roomKindName`. Use `pms_metadata->>roomId` as the unique upsert key instead of `(hotel, room_number)`.
- Add a `room_category` column on `rooms` (text, nullable) populated from `roomKindName` so the UI can group. Existing rows for non-`previo-test` hotels remain `NULL` and unaffected.
- Matching in `pmsRefresh.ts` already falls back to `pms_metadata->>roomId` — no change needed there once the upsert key is unique.

**Frontend (Rooms section + Housekeeping › Team View › Hotel Room Overview).**
- Group room cards/lists by `room_category` when the hotel has more than one distinct category. Category header shows `name (n rooms)`. Hotels with a single category (the normal case, including OttoFiori) render exactly as today — no visual change.
- Filter chips at the top: `All` + one chip per category, with counts.
- Search & sort already work on `room_number`; no change.

---

### 3. Nightly auto-sync + "new room" tag

**Cron.**
- Add a Postgres cron job (via `pg_cron` / `supabase_functions.http_request`) that runs daily at `00:15 UTC` and invokes `previo-sync-rooms` (importLocal=true) followed by `previo-pms-sync`, **only for `hotel_id = 'previo-test'`**. The job logs to `pms_sync_history` with `sync_type = 'nightly_auto'`.
- Hard guard inside both functions already rejects non-`previo-test`; cron will hit those guards if misconfigured, so OttoFiori stays safe.

**Eligible-user surface.**
- In Admin → PMS Configuration (and as a small badge in Rooms page header for admins/managers of `previo-test`), show `Last auto-sync: <timestamp> · <status>` sourced from the latest `pms_sync_history` row where `sync_type='nightly_auto'`. Reuses the existing `PmsSyncStatus` component pattern.

**"New" tag for 3 days.**
- On import, when a `rooms` row is INSERTED (not updated), stamp `created_at` (already exists) — no schema change needed; just render a small `NEW` badge in the Rooms list and Hotel Room Overview when `now() - created_at < 3 days` AND the row's `pms_metadata.roomId` is present (so it was Previo-imported, not manually created).
- Badge is rendered only for `previo-test`; OttoFiori is untouched.

---

### Files to change

```text
supabase/functions/previo-pms-sync/index.ts        # fix status mapping
supabase/functions/previo-sync-rooms/index.ts      # upsert by pms_metadata.roomId, set room_category
supabase/migrations/<new>.sql                      # add rooms.room_category; pg_cron job
src/lib/pmsRefresh.ts                              # no logic change; confirm fallback still wins
src/components/dashboard/HotelRoomOverview.tsx     # group + category chips + NEW badge
src/components/dashboard/RoomManagement.tsx        # same grouping + NEW badge in Rooms section
src/components/admin/PmsSyncStatus.tsx             # show last nightly auto-sync timestamp
```

### Out of scope / guarantees

- OttoFiori and every non-`previo-test` hotel: zero behavior change. All new logic is gated either by the existing `ALLOWED_HOTEL_ID` guard, by `pms_metadata.roomId IS NOT NULL`, or by the per-hotel chip rendering only when >1 category exists.
- No changes to assignments, attendance, or housekeeping workflows.

---

Ready to implement on approval.