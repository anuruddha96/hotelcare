## Plan: Team View PMS Sync UX overhaul + reliability fixes

Scope covers seven distinct problems raised. I'll group them by area so the implementation stays reviewable.

---

### 1. Checkout Rooms categorization bug (302, 305, 204, 304, 202, 103, 101 missing)

**Diagnosis**: Reading the uploaded `cleaning-786631-2026-07-13.xlsx` will confirm, but the pattern matches: those rooms have `DepartureTomorrow=true` (i.e. departing on the 13th) while the daily overview was generated late on the 12th. `pmsRefresh.ts` already writes `pms_metadata.scheduledDepartureTomorrow` and `is_checkout_room=true` for them, but `HotelRoomOverview.tsx`'s partition into "Checkout Rooms" vs "Daily Rooms" is likely still reading only `is_checkout_room` OR `scheduledDepartureToday`, missing the tomorrow flag — OR the rooms have `is_checkout_room` reset by a later code path.

**Fix**: In `src/components/dashboard/HotelRoomOverview.tsx`, make the checkout-section predicate:
`isCheckout = room.is_checkout_room || pms_metadata.scheduledDepartureToday || pms_metadata.scheduledDepartureTomorrow || pms_metadata.checkedOutToday`.
Verify against the XLSX (I'll parse it in build mode) and confirm room IDs land in the checkout bucket.

---

### 2. Hotel Room Overview UI — Yesterday vs Today, NEW badge, mobile

Introduce a clean two-column ("Yesterday · Today") split for BOTH Checkout Rooms and Daily Rooms:

- **Desktop**: two side-by-side sub-columns per floor row. Left column = yesterday's assignments (opacity ~55%, muted border, small "Yesterday" label). Right column = today's rooms with full-saturation chips and blue **NEW** badge (last 2 h imports).
- **Mobile (<768 px)**: stack — a collapsed "Yesterday (n)" accordion above today's full-color grid, so mobile stays scannable.
- **NEW badge**: switch from green → `bg-blue-500 text-white` for contrast; keep the 2 h window.
- Clear the stale manual override on 203 as part of this pass (one-off write; safe because request explicitly asks to clear it).
- Add a subtle `animate-fade-in` when new rooms first appear post-sync.

Legend gets updated entries: "Yesterday", "New (last 2 h)", "C/O today", "C/O tomorrow".

---

### 3. PMS sync = manual only + double-sync guard

- **Remove any auto-trigger** on Team View tab mount. Audit `src/pages/*`, `src/components/dashboard/*`, and `LiveSyncContext` for calls to `runPmsRefresh` / `previo-sync-daily-overview` fired from `useEffect` on tab focus. Keep the button click as the only trigger.
- **Warning dialog on re-sync**: `PmsSyncControls` already reads `last_sync_at` + `last_sync_status`. Also fetch the last row of `pms_sync_history` (has `data`, plus we'll extend it with `synced_by_user_id`, `synced_by_name`) to show "Last synced 4 min ago by Anuruddha (admin). Sync again?" AlertDialog. Only shows on the 2nd+ click within the same session OR when a sync <10 min old exists. Proceed on confirm.
- Small migration: add `synced_by_user_id uuid`, `synced_by_name text` to `pms_sync_history`.

---

### 4. Spotlight onboarding for the PMS Refresh button

Reuse the existing `TrainingV2` curriculum machinery (`src/components/training/v2/`) — add one new step to `curricula/manager-team.ts` (or a dedicated `pms-refresh-intro.ts`) that:

- Targets the `PMS Refresh` button in Team View via a stable `data-training-id="pms-refresh-btn"`.
- Explains: "File upload is no longer required — click PMS Refresh here to sync. The PMS Upload page is still available if needed."
- Shown once per manager (persisted in `user_training_state`, already used by V2).

---

### 5. PMS Upload page — hide toggle + Kill-switch role gating + fix the failing sync

Two admin-facing controls:

a. **Hide PMS Upload page** — new boolean `hide_pms_upload_page` on `pms_configurations` (default `true` after this change, since Team View sync is preferred). Admin UI toggle in `PMSConfigurationManagement.tsx`. `PMSNavigation` / `AdminTabs` respect it; the tab is only visible to admin/super-admin OR when the flag is off.

b. **Kill-switch button visibility** — in `PmsSyncControls.tsx`, gate the Kill-switch badge/button behind `is_admin || is_super_admin` (via `useAuth` role check).

c. **Fix the 401 error on PMS Upload's sync**: the uploaded screenshot shows "Sync failed: Previo XML 401: Invalid login or password". Root cause is that the PMS Upload page path is calling `previo-pms-sync` with a hotel key that doesn't resolve credentials the same way Team View does (Team View uses the resolved `cfg.hotel_id`; PMS Upload likely passes the display name). Standardize on the same `resolveHotelKeys` + `cfg.hotel_id` used in `PmsSyncControls`.

---

### 6. Outbound status push — approved-room only

- Confirm the current path: manager approves room → `rooms.status` transitions to `clean` with `approved_by` set. Enqueue an outbound event only when approval is present.
- In whichever hook/component handles approval (search `room_assignments` + "approve"), on success `INSERT` into `pms_outbound_queue` with `{event: 'room_status', room_id, target_status: 'clean'}`. Never enqueue on plain status writes from the sync path or from housekeepers marking clean pre-approval.
- Verify `previo-outbound-worker` picks it up and calls Previo's `setHouseKeeping` XML endpoint. Add a small dry-run log line + retry counter check. Test with the live cfg.
- Guard: if `outbound_kill_switch=true` OR `status_push_enabled=false`, worker skips (already exists — just confirm).

---

### 7. Success animation + translations

- After a successful PMS Refresh: confetti-lite (a `framer-motion` sparkle or `sonner` rich toast + a `animate-scale-in` green check overlay on the button for ~1.2 s). Respect `prefers-reduced-motion`.
- Add i18n keys for every new string (spotlight copy, warning dialog, Yesterday/Today labels, NEW badge tooltip, hide-toggle label) across en/hu/es/vi/mn via the standard translation pipeline used elsewhere.

---

### Files to touch (grouped)

**Frontend**
- `src/components/dashboard/HotelRoomOverview.tsx` — categorization fix, Yesterday/Today split, NEW badge color, mobile layout, sync animation hook
- `src/components/pms/PmsSyncControls.tsx` — remove auto-refresh, warning dialog, kill-switch role gate, success animation, spotlight anchor
- `src/components/pms/PmsRefreshPreviewDialog.tsx` — pass through `synced_by` metadata
- `src/components/admin/PMSConfigurationManagement.tsx` — `hide_pms_upload_page` toggle, verify outbound push settings surface
- `src/components/layout/PMSNavigation.tsx` / `AdminTabs.tsx` — respect hide flag + role
- `src/components/training/v2/curricula/manager-team.ts` — add PMS Refresh spotlight step
- `src/pages/*` — remove any auto-sync `useEffect`s on Team View mount
- `src/hooks/useAuth.tsx` — confirm role helper exposed
- i18n files under `src/lib/*translations*` + `src/hooks/useTranslation.tsx` dictionaries

**Backend / edge functions**
- `supabase/functions/previo-pms-sync/index.ts` — accept caller identity, harden credential resolution so PMS Upload path works
- `supabase/functions/previo-outbound-worker/index.ts` — verify approval-gated enqueue + Previo XML `setHouseKeeping` call
- Wherever room approval is handled (server or client) — enqueue outbound only on approval

**Database migration**
- `pms_sync_history`: add `synced_by_user_id uuid`, `synced_by_name text`
- `pms_configurations`: add `hide_pms_upload_page boolean default true`
- One-time UPDATE: clear yesterday's stale manual override on Room 203 for Hotel Ottofiori
- GRANTs already exist for both tables (columns only, no new tables).

---

### Verification checklist

1. Parse `cleaning-786631-2026-07-13.xlsx` and confirm 302/305/204/304/202/103/101 now appear in Checkout Rooms after refresh.
2. Screenshot Team View at 1280 and 390 wide to confirm two-column vs stacked mobile layout + blue NEW badges.
3. Click PMS Refresh twice → warning dialog shows "last synced by …".
4. Approve a room → check `pms_outbound_queue` gets a row and the worker log shows the Previo API call succeeded.
5. Toggle "Hide PMS Upload" as admin → non-admin loses the tab.
6. Fresh manager login → spotlight appears once on the PMS Refresh button.
7. Confirm 401 on PMS Upload's sync is gone.
8. Confirm translations resolve (no raw keys) in hu/es/vi/mn.

Once you approve, I'll implement in the order above (fix #1 first because it unblocks the room-visibility complaint, then #3 + #5 credential fix, then UI #2/#7, then #4 spotlight, then outbound #6, finally translations).
