## Scope

Four independent improvements to the housekeeping app. None touch the Revenue module or break existing housekeeping flows.

---

## 1. Allow Minibar Updates on Completed Rooms (with Re-Approval)

**Problem:** Once a housekeeper completes a room, the Minibar button is hidden (only shows during `in_progress`). They can't add forgotten items, causing operational pain.

**Solution:** Allow minibar additions for rooms in `completed` status, with an audit trail and supervisor re-approval flow.

### DB changes (migration)
Add columns to `room_minibar_usage`:
- `added_after_completion boolean DEFAULT false` — set true when housekeeper adds after assignment was completed
- `pending_supervisor_review boolean DEFAULT false` — true if added after supervisor already approved
- `reviewed_by uuid`, `reviewed_at timestamptz` — supervisor who approved the late addition
- Existing RLS unchanged; add policy so housekeeper can INSERT for their own assigned rooms even after completion (scoped by `assigned_hotel`).

### UI changes

**`AssignedRoomCard.tsx`** (the completed-room block at lines 1284–1300):
- Add a "Minibar" button next to "Update Dirty Linen" that opens the existing minibar dialog.
- When inserting a row from a completed assignment:
  - Set `added_after_completion = true`.
  - If the assignment is **not yet** supervisor-approved → flip the assignment back so it re-appears in Pending Approvals with an "Updated by housekeeper" badge (set `supervisor_approved=false` only if it was previously auto-approved; otherwise just keep it pending and tag the row).
  - If the assignment **was already** supervisor-approved → set `pending_supervisor_review=true` on the new minibar row and notify supervisors. The room stays approved; only the new minibar item needs review.

**`SupervisorApprovalView.tsx`** & `CompletionDataView.tsx`:
- Show a yellow "Added after completion" badge on minibar items where `added_after_completion=true`.
- Add a new "Late Minibar Additions" section in the Approval inbox listing rows where `pending_supervisor_review=true`. Each row shows: room, item, qty, price, housekeeper, timestamp, plus Approve / Reject buttons. Approve sets `reviewed_by/at` and `pending_supervisor_review=false`. Reject deletes the row (with confirmation).
- Counter in `usePendingApprovals` adds these pending late-additions to the badge (still strictly hotel-scoped — same fix as last loop).

### Translation keys
Add: `minibar.addedAfterCompletion`, `minibar.pendingReview`, `minibar.lateAdditions`, `minibar.approveLate`, `minibar.rejectLate`, `roomCard.addMinibarLate` across all 6 languages.

---

## 2. Add Azerbaijani (`az`) Language

### Files
- `src/components/dashboard/LanguageSwitcher.tsx` — add `{ code: 'az', name: 'Azərbaycanca', flag: '🇦🇿' }`.
- `src/hooks/useTranslation.tsx` — add `'az'` to `supportedLanguages`, add full `az: { ... }` block matching the English keyset, fallback to English for any missing key.
- `src/lib/comprehensive-translations.ts`, `expanded-translations.ts`, `notification-translations.ts`, `pms-translations.ts`, `maintenance-translations.ts`, `training-translations.ts`, `guest-minibar-translations.ts` — add `az: { ... }` blocks with translated values for every existing key.
- `src/lib/translation-utils.ts` — include `az` in any language list.

Translations will mirror the existing 5-language structure (no new keys needed beyond the minibar/notification ones in this plan). Volume: ~5,000 string entries — produced in bulk per file.

### Fallback safety
Confirm `useTranslation` returns the English string when an `az` key is missing, so partial coverage never crashes the UI.

---

## 3. Mobile-Friendly Attendance Records

**Problem:** `AttendanceReports.tsx` uses a wide HTML `<Table>` that overflows on 390px screens (per uploaded screenshot — columns wrap awkwardly).

**Fix:** Responsive layout in `AttendanceReports.tsx` (lines 320–376):
- On `md+`: keep current table.
- On mobile (`< md`): render each record as a stacked card showing Date (bold header), Check In / Check Out / Hours in a 3-col grid, then Status badge, Location, Notes.
- Wrap the desktop table in `<div className="hidden md:block overflow-x-auto">` and the mobile cards in `<div className="md:hidden space-y-3">`.
- Also stack the 4 summary cards (Total Days / Hours / Avg / Punctual) one-per-row on mobile (already `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` — verify and tighten spacing).

No data/logic changes.

---

## 4. Branded PWA Push Notifications in User's Language

**Goal:** When the PWA is installed (iOS/Android home screen) and an event happens (new approval pending, room status change, new assignment, etc.), show a system notification:
- Branded as "Hotel Care" with the app icon.
- Short, event-specific body (e.g., "Room 402 awaiting approval", "New assignment: Room 215").
- In the user's currently selected app language (read from `localStorage` / language preference).

### Changes

**`public/service-worker.js`**
- Update `notificationData` defaults to use `/icon-192.png` (branded) instead of `/favicon.ico` for `icon`, and `/icon-maskable-512.png` for `badge`.
- Set `tag` per event type so duplicates collapse rather than spam.
- Keep `requireInteraction` and vibration.

**`src/hooks/useNotifications.tsx`** (lines 200–280)
- In `showNotification` and the foreground `new Notification(...)` calls, switch `icon` to `/icon-192.png` and `badge` to `/icon-maskable-512.png`.
- Always pass a short, translated `title` and `body` — never raw event text. Use existing `t()` (already wired) so the user's selected language drives the strings.
- Add per-event short body templates via `t()`:
  - `notifications.short.newAssignment` → "New room assigned"
  - `notifications.short.pendingApproval` → "Room awaiting approval"
  - `notifications.short.roomStatusChange` → "Room status updated"
  - `notifications.short.lateMinibar` → "Late minibar item to review"
  - `notifications.short.breakRequest` → "Break request"
  - `notifications.short.ticketUpdate` → "Maintenance update"
- Update all `showNotification(...)` call sites in `RealtimeNotificationProvider.tsx`, `SupervisorApprovalView.tsx`, `HousekeepingStaffView.tsx`, etc. to pass the matching short title/body.

**Language persistence in SW**
The service worker can't read React state. We pass the body string already translated from the page (foreground notifications). For background push (future server-sent push), we'd send the translated string from the edge function based on the recipient's `profile.language`. For now, all notifications in this app are triggered from the foreground via realtime subscriptions, so `t()` covers the language requirement immediately.

**iOS PWA note:** Existing iOS-standalone check in `requestNotificationPermission` is preserved.

---

## Technical Summary (per file)

```text
DB:
  supabase/migrations/<ts>_minibar_late_additions.sql
    - alter room_minibar_usage add columns + RLS policy

Frontend:
  src/components/dashboard/AssignedRoomCard.tsx       (add Minibar btn for completed)
  src/components/dashboard/SupervisorApprovalView.tsx (Late Additions section)
  src/components/dashboard/CompletionDataView.tsx     ("Added after completion" badge)
  src/components/dashboard/AttendanceReports.tsx      (mobile card layout)
  src/components/dashboard/LanguageSwitcher.tsx       (+az option)
  src/hooks/useTranslation.tsx                        (+az in supportedLanguages + base block)
  src/hooks/useNotifications.tsx                      (branded icons, short translated titles)
  src/hooks/usePendingApprovals.tsx                   (count late minibar items)
  src/lib/*-translations.ts (7 files)                 (+az blocks, +new minibar/notification keys)
  public/service-worker.js                            (branded icon defaults + tag)
```

## Testing checklist (manual after build)
- Housekeeper completes Room 402 → sees Minibar button → adds item → if not yet approved, supervisor sees it back in pending with "Updated" badge; if already approved, supervisor sees it in "Late Minibar Additions" → can approve.
- Switch app language to Azerbaijani → all major screens render in `az`, untranslated keys fall back to English (no crashes).
- Open Attendance on 390px viewport → records render as readable cards, no horizontal scroll.
- Install app to iOS/Android home screen → trigger a new assignment → system notification shows Hotel Care icon, short translated body matching app language.
- Confirm housekeeping flows (start/complete cleaning, DND, dirty linen, photos) and Revenue module are unaffected.