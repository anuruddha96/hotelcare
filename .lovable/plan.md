
# Rollout plan

Three tracks in one plan. Each track is independent and can be released as it lands.

---

## Track A — Quick fixes

1. **DND 2nd attempt asks for 5 daily photos**
   - Investigate `AssignedRoomCard.tsx` markAsDND flow + completion photo requirement. On attempt 2 the room is in `dnd_pending_retry`, but the "Start/Complete" checklist path currently treats it as a normal cleaning and requires the 5 completion photos.
   - Fix: when `is_dnd || dnd_attempt_count > 0`, the second attempt must reopen the `EnhancedDNDPhotoCapture` (single DND photo), never the 5-photo completion sheet. Add a hard branch: DND button on retry = single DND photo capture with `attempt_number: 2`, then set `completed`.
   - Add clear UI copy on the retry card: "Second attempt — one DND photo is enough".

2. **Checkout Clean must not show "Towel Change Required"**
   - `CompletionDataView.tsx` (Special Requirements block) and any other card that surfaces `towel_change_needed`: suppress the badge whenever `cleaning_type === 'checkout_clean'`. Same guard already exists on `AssignedRoomCard.tsx`; extend to approval history + completion view.

3. **Pending Approvals badge "5" is stale**
   - `HousekeepingTab.tsx` pending count is derived from a one-shot fetch. Replace with realtime: subscribe to `room_assignments` (filter by hotel + today, status = `completed` + not approved) and to `dnd_photos`. Recompute count on INSERT/UPDATE/DELETE and on approval action. Also refresh on window focus.

4. **Admin-only training modules leak to non-admins**
   - `src/components/training/v2/curricula/index.ts` + `curriculaForRole()`: `adminPmsOverviewCurriculum` and any other admin curricula must set `roles: ['admin']` (or `top_management`). Verify `manager-*` curricula don't list `admin` steps that reference admin-only routes.
   - Filter in `TrainingCenter.tsx` by the real user role, not by "has any curriculum".

5. **Manager Reception curriculum**
   - `manager-reception.ts`: remove "Nightly Daily Overview upload" and "Breakfast lookup (/bb)" steps (or move them to an admin/night-reception curriculum). Reception managers see neither.
   - Wait — user says the Nightly Daily Overview upload is **missing** and should be restored, and Breakfast lookup should **not** appear in the manager module. So: restore the Daily Overview upload step in the reception/night-reception curriculum where it belongs, and delete the /bb Breakfast lookup step from the manager curriculum.

6. **Room 404 — housekeeping note from yesterday appearing today**
   - Root cause suspicion: `housekeeping_notes` has no date scoping in the query used by `AssignedRoomCard`. It pulls all non-resolved notes for the room. Add `assignment_date = today` filter (or `created_at >= start_of_today`) with a fallback "carry over unread" flag the manager sets explicitly.
   - This is superseded by Track C messaging, but ship the date-scope fix now so stale notes stop appearing.

---

## Track B — Revenue revamp

### B1. Hotel scoping
- When the user has an active hotel selected in `TenantContext`, `/rdhotels/revenue` auto-redirects to `/rdhotels/revenue/<hotel-slug>`. Overview page only reachable via explicit "All hotels" link (admin/top_management).
- `RevenueHotelDetail.tsx` becomes the default landing.
- Admin legacy title tree stays visible (breadcrumb: Revenue → Ottofiori → tab).

### B2. New "Rate Grid" tab (XL matrix)
New tab inside `RevenueHotelDetail.tsx` alongside existing tabs (Overview / Recommendations / Strategy / Settings / **Rate Grid**).

Layout (mirrors the Previo screenshot):
```text
              | Jul 20 Mon | Jul 21 Tue | Jul 22 Wed | ...
--------------+------------+------------+------------+---
Room type     | occ% | ✓/✗ | occ% | ...
  For sale    | 0    | 1    | ...
  Rate 1 pax  | €62  | €95  | ...   <-- editable
  Rate 2 pax  | €72  | €105 | ...   <-- editable
```
- Left frozen column: room types + rate-plan rows (1 pax, 2 pax, extras) from `room_types` × `rate_plans`.
- Top frozen row: dates (30/60/90-day windows, arrow nav + jump-to-today, "Show from today" toggle).
- Cell = current published rate for that (room_type, rate_plan, date). Colored background: green when sellable, orange when closed, red when overbooked (from occupancy + room_status).
- Inline edit → optimistic update → `previo-push-rates` edge function push. Failed pushes revert + show toast.
- Bulk select: shift-click column/row for range edit; apply +/− €, ×%, or set absolute.
- Data source: `previo-pull-rates` (existing) hydrates the grid on load; realtime subscription to `rate_calendar` and `rate_history` for live updates.

### B3. Data plumbing
- Extend `previo-pull-rates` to return per-(room_type, rate_plan, date) rates covering the visible window (add pagination if payload gets large).
- New view `public.v_rate_grid` joining `rate_calendar` + `room_types` + `rate_plans` + `occupancy_snapshots` for read; edits go through existing tables via edge function.
- No schema breakage — additive only.

### B4. Automation surface (visible, off by default)
- "Auto-price this window" button per row runs the existing `revenue-engine-tick` scoped to that room-type × window and previews suggested cells before push.
- Autopilot toggle already exists — keep, just surface here.

---

## Track C — Messaging (housekeeper ↔ manager)

### C1. Schema
New tables:
- `message_threads` — `hotel_id`, `organization_slug`, `subject`, `room_id` (nullable — per-room threads), `created_by`, `is_direct` (bool), timestamps.
- `thread_participants` — `thread_id`, `user_id`, `last_read_at`, `muted`.
- `messages` — `thread_id`, `sender_id`, `body` (original text), `source_lang`, `attachments jsonb`, `created_at`, `edited_at`.
- `message_translations` — `message_id`, `target_lang`, `translated_body`, `translated_at`. Cached per language so we don't retranslate.

RLS: user must be a `thread_participants` row to read/insert. Admins bypass. GRANTs to `authenticated` + `service_role`.

Storage bucket `message-attachments` (private) with per-thread folder RLS.

### C2. Edge functions (OpenAI, not Lovable AI, per user)
- `messages-translate`: given `message_id` + `target_lang`, calls OpenAI (`gpt-4o-mini`) using the existing `OPENAI_API_KEY` secret, stores translation in `message_translations`, returns it. Idempotent.
- `messages-notify`: on new message, fanout to participants (email/push via existing `send-email-notification`).

Trigger `after insert on messages` enqueues both.

### C3. UI
- Global header icon (`MessageCircle`) with unread badge (realtime via `messages` subscription filtered to my threads).
- `/messages` inbox page — thread list, unread indicator, search.
- Thread view — bubbles, sender name + role, attachment previews, auto-translate toggle (default ON: shows body in user's `useLanguagePreference` language; tap "Show original").
- Composer: text + attachment upload (image/pdf), tagline "Type in any language — the recipient reads it in theirs".
- Per-room entry point: on `AssignedRoomCard` and `HotelRoomOverview` a "Message" button opens (or creates) a thread scoped to that room (`room_id` set). Manager notes for a room become the first message in that room's thread and inherit the date-scoping.
- Notifications: sonner toast on new message when app open; badge always live.

### C4. Migration off `housekeeping_notes`
- Keep table for history but stop writing to it. New note UI writes to `messages` in the room's thread. Read path merges old notes (read-only) with new thread until we've fully deprecated.

---

## Technical section (implementation notes)

- Files touched (non-exhaustive):
  - `src/components/dashboard/AssignedRoomCard.tsx`, `HousekeepingTab.tsx`, `CompletionDataView.tsx`, `EnhancedDNDPhotoCapture.tsx`, `SupervisorApprovalView.tsx`
  - `src/components/training/v2/curricula/{index,manager-reception,admin-pms-overview}.ts`, `TrainingCenter.tsx`
  - `src/pages/Revenue.tsx`, `RevenueHotelDetail.tsx`
  - New: `src/components/revenue/RateGrid.tsx`, `src/components/revenue/RateGridCell.tsx`, `src/components/revenue/RateGridToolbar.tsx`
  - New: `src/pages/Messages.tsx`, `src/components/messages/{ThreadList,ThreadView,MessageComposer,MessageBubble,AttachmentUpload}.tsx`, `src/hooks/useUnreadMessages.ts`
  - New edge functions: `supabase/functions/messages-translate`, `messages-notify`
  - Extended: `supabase/functions/previo-pull-rates`
- Migrations: enum-safe additions; new tables with GRANTs + RLS in the same migration; new storage bucket via storage tool.
- Realtime: enable publication on `messages`, `room_assignments` (already?), `dnd_photos`, `rate_calendar`.
- Secrets: `OPENAI_API_KEY` already configured — reuse.

## Rollout order
1. Track A (small, immediate).
2. Track B (feature-flag `revenue_rate_grid` per org, admin toggle).
3. Track C (schema + inbox first, per-room threads second, translation last).
