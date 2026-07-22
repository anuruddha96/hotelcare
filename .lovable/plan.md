
# Phase: Translation, DND/No-Service workflow, and manager approval fixes

Scope: only the fixes listed below. All other in-flight work (Revenue rate grid revamp, full messaging system, etc.) is deferred to a later phase.

---

## 1. Translation gaps

### 1a. Housekeeper room card — Minibar & Dirty Linen
- `src/components/dashboard/RoomDetailDialog.tsx` (Minibar tab): category chips ("Beverage", "Alcohol", "Snack"), section labels, product names come from DB (`en`) — wire them through `useTranslation()` and the existing `guest-minibar-translations` / new `minibar` keys. Fall back to raw name when no key.
- `src/components/dashboard/DirtyLinenCart.tsx` (or wherever "My Dirty Linen Cart", "Today's Total", "0 Linen Items", "Detailed Records", "No items collected yet" live): route every literal through `t()`. Add missing keys to `src/hooks/useTranslation.tsx` for all 5 supported languages (en, hu, es, vi, mn, uk).
- Dirty linen item names ("Bed Sheets Queen Size", "Big Towel", "Bath Mat"…): they already map via `src/lib/linen-item-i18n.ts`. Extend translations for `hu, es, vi, mn, uk` under the `linen.*` namespace and make sure every consumer (add-to-cart list, cart summary, Dirty Linen Management manager table headers) uses `translateLinenItem()` instead of the raw `display_name`.

### 1b. Manager pages not translating (screenshot evidence)
- `HousekeepingTab.tsx`: "Team View" duplicate breadcrumb, sub-nav labels "Staff Management", "Team View", "Performance", "Dirty Linen", "Minibar Tracking", "Maintenance", "Early Sign-Out Approvals" — all use raw strings. Replace with `t()`.
- `HotelRoomOverview.tsx`: title "Hotel Room Overview", stat labels "TOTAL / EARLY C/O / NO-SHOW / ACT", legend chips ("Approved/Clean", "Dirty/Assigned", "In Progress", "Pending Approval", "Overdue", "Out of Order", "DND", "No-Show", "Early Checkout", "Towel Change", "Clean Room", "Room Cleaning", "Extra Towels", "Ready to Clean", "Approved", "Manual C/O", "Newly synced", "Departs tomorrow", "Shabbat", "No Service", "Has note"), "Hide Legend", "Checkout Rooms", "Map", "Refresh", "PMS SYNC / Up to date / X minutes ago", "PMS Refresh" — wire to `t()`.
- `AutoRoomAssignment.tsx` wizard: "Auto Room Assignment", "1. Staff / 2. Preview / 3. Confirm / 4. Public Areas", "Total Rooms / Checkouts / Daily", "Checkout rooms: 45 min | Daily rooms: 15 min | Break: 30 min", "No dirty rooms available for assignment", "Generate Preview" — wire to `t()`.
- Attendance page (housekeeper view, `AttendanceView` / `WorkStatusPanel`): title "Work Status & Attendance", "Wednesday, July 22nd" formatter (localize via `date-fns` locale), break-type option label "Lunch Break (30 minutes)" — wire to `t()` and pass the current language's `date-fns` locale to `format()`.
- Top bar chip "Reports" and role label "Менеджер · Hotel Ottofiori" — `Header.tsx`: translate "Reports" and the role name via existing `roleLabel(t, role)` helper.

Add all missing keys in one pass to `useTranslation.tsx` (en/hu/es/vi/mn/uk). Follow the existing pattern.

---

## 2. Tsvetkova_074 cannot log out

- Investigate `src/components/dashboard/AttendanceView.tsx` + `useAuth.tsx` sign-out path. Likely causes to check in order:
  1. Sign-out button gated by an active room assignment (blocked because a room is stuck `in_progress`/`dnd_pending_retry`).
  2. `signOut` fails silently when the session refresh token has expired — add a hard fallback that clears local storage and forces `/auth`.
  3. Ukrainian UI: the End Shift button label wraps and its click target is outside the tap region.
- Fix: allow shift end-out even when a room is `dnd_pending_retry` (that state means the housekeeper is not blocked); force clear session on sign-out failure; log the exact reason to console for the next occurrence.

Plan will confirm the exact cause once I read `AttendanceView.tsx` in build mode — the diagnosis above is a hypothesis, not verified state.

---

## 3. Early-checkout approvals must go to housekeepers, not managers

- Trace `send-work-assignment-notification` and any `notify-manager-*` edge function + the client hook that requests early-C/O approval (search for `early_checkout` / `earlyCheckout`).
- Current bug: the approval notification recipient list is set to role `manager` / `top_management`. Change to: the housekeeper assigned to that room (fallback: any signed-in housekeeper at that hotel today). Manager only sees it in the audit log, not as an actionable approval.
- UI: remove early-C/O rows from Manager "Pending Approvals" queue; add them to housekeeper's task list as a distinct card "Early checkout — approve to release room".

---

## 4. DND / No-Service workflow overhaul

### 4a. DND 2nd-attempt photo bug (still broken)
- Re-audit `AssignedRoomCard.tsx` on the retry path. When status is `dnd_pending_retry` and `dnd_retry_unlocked_at <= now`, tapping the DND action MUST open `EnhancedDNDPhotoCapture` with `attemptNumber: 2` — never `CompletionPhotoCapture`. There is currently a code path where "Start Cleaning" reappears on unlock and then routes into the 5-photo grid on completion. Fix by:
  - Splitting the retry action into two explicit buttons: "Still DND (take photo)" and "Actually clean it now".
  - "Still DND" → `EnhancedDNDPhotoCapture(attempt=2)` → on save, set `status='completed'`, `is_dnd=true`, enqueue for supervisor approval, attach both attempt photos.
  - "Actually clean it now" → normal cleaning flow.

### 4b. Relocate DND & add No-Service button next to it
- On `AssignedRoomCard` action row: place `[No Service]  [DND]  [Start Cleaning]` in that order so both no-open-door actions are reachable without entering the room.
- Both buttons visible on 1st and (where applicable) retry states.

### 4c. No-Service flow (new)
- Tapping "No Service" opens a small confirm dialog:
  - Copy: "Did the guest tell you they do not want cleaning today?" [Cancel] [Yes, guest confirmed]
  - Optional note field (short, free-text, translated placeholder).
- On confirm: mark assignment `status='completed'`, `no_service=true`, `no_service_note=<text>`, `completed_at=now()`; NO photo required. Goes straight to manager approval queue with the note visible.

### 4d. Schema
Small additive migration:
- `room_assignments.no_service boolean not null default false`
- `room_assignments.no_service_note text`
- (Optional) enum value already exists — reuse.
- GRANTs already cover the row; no new table.

### 4e. Manager approval view
- `SupervisorApprovalView` + `CompletionDataView`: render a full context block for every pending row:
  - Room number, cleaning type, assigned housekeeper, start/complete timestamps, duration.
  - DND rooms: both attempt photos side-by-side with timestamp badges (Attempt 1 / Attempt 2 final).
  - No-Service rooms: 🚫 badge, note text, "No photo required".
  - Early-C/O rooms: removed from this queue (see §3).
  - Room note (housekeeping-scoped only, per prior work).
  - Minibar consumption from today only, with recorder name & role.

---

## Rollout order (single build session)
1. Migration for `no_service` fields.
2. DND/No-Service UI (§4).
3. Early-C/O routing fix (§3).
4. Attendance sign-out fix (§2).
5. Translation sweep (§1) — batch add all keys in one edit to `useTranslation.tsx`, then wire the components.

Deferred: Revenue Rate Grid, full Messaging/DM inbox, OpenAI auto-translate for messages, and the training curricula visibility items left over from the previous plan — those go to the next phase.

---

## Technical section (implementation notes)

- Files to edit:
  - `src/hooks/useTranslation.tsx` (bulk key additions, 6 languages)
  - `src/lib/linen-item-i18n.ts` (extend map, add non-en translations under `linen.*`)
  - `src/components/dashboard/{AssignedRoomCard,RoomDetailDialog,DirtyLinenCart,HousekeepingTab,HotelRoomOverview,AutoRoomAssignment,SupervisorApprovalView,CompletionDataView,AttendanceView}.tsx`
  - `src/components/layout/Header.tsx`
  - `supabase/functions/send-work-assignment-notification/index.ts` (and any early-C/O notification path)
- Migration: `alter table public.room_assignments add column no_service boolean not null default false, add column no_service_note text;` — no new grants needed (existing policies cover new columns).
- No new edge functions this phase.
- Verify with a Playwright pass on `/rdhotels` in Ukrainian: attendance page, housekeeping sub-nav, auto-assign wizard, room card action row (No Service confirm + DND retry).
