## Plan: 4 Fixes — UI, Approvals, Photo Enforcement, Hungarian i18n

### 1. Hotel Room Overview – better UI (mobile + desktop)

Refer to image 1. The current card is dense, header buttons wrap awkwardly on 390px, the legend chips wrap to 3+ lines, and floors are shown as long horizontal rows that overflow.

Changes in `src/components/dashboard/HotelRoomOverview.tsx`:

- **Header**: stack title + actions vertically on mobile; convert "Refresh" to icon-only on `< sm`; group "Map" + "Refresh" in a small action bar.
- **Stats row**: replace the chip strip ("21 rooms / 2 Early C/O / ACT: --") with a clean 3-up stat grid (Total · Early C/O · Active) using muted cards consistent with other dashboards.
- **Legend**: collapse by default on mobile; show as a 2-column compact grid (icon + short label) inside the popover/expand area; reduce icon size from current.
- **Floor sections**: use a sticky floor header (`F1`, `F2`, …) with a thin divider; render rooms in a responsive grid (`grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8`) so rooms align in tidy rows instead of one wrapping line per floor.
- **Room tile**: keep room number prominent; move RTC/M/S/T size badges into a single bottom strip (max-height capped, `text-[10px]`) so tiles are uniform height; housekeeper name truncated with `title=` tooltip.
- **Section split**: keep "Checkout Rooms" and "Daily Rooms" as collapsible sections with count badge, default expanded.

No data-shape changes.

### 2. Early sign-out request not reaching supervisor approval

Root cause found in `src/components/dashboard/AttendanceTracker.tsx` `performCheckOut()`:

```ts
const isEarlySignout = currentHour >= 20 || currentHour < 4;
```

A request is **only** created if the housekeeper signs out between 8 PM and 4 AM. If they try to sign out earlier (e.g. 3 PM, which is the realistic "early checkout" case), the code goes straight to the normal check-out branch — no row is inserted into `early_signout_requests`, so the supervisor's "Pending Approvals" stays empty (verified: the most recent rows in the table are from 2025-11, all already approved/rejected).

Fix:

- Define "early sign-out" as **before the staff member's scheduled end-of-shift** (or before a configurable threshold like 6 PM / 18:00). Use the existing shift end if available on the profile, otherwise fall back to `< 18:00` AND `> 04:00`.
- When that condition is true, insert into `early_signout_requests` and set the local state to pending.
- Also surface a confirmation dialog explaining the request was sent to the supervisor.
- In `EarlySignoutApprovalView.tsx`: keep the 10-minute auto-expire but increase the window so afternoon requests do not auto-expire before the manager sees them — change to **60 minutes** (the current 10 min hides the request from supervisors who do not refresh quickly).
- Make sure new requests trigger a notification to managers/supervisors via the existing `useNotifications` realtime channel (subscribe to `early_signout_requests` INSERT events for the same hotel and call `notify`).

DB: no schema change required.

### 3. Housekeepers submitting a daily room without all mandatory photos

Evidence (DB): rooms 102, 303, 401 (Apr 24) and Room 101 (Apr 23, 2 photos) are `status=completed` for `daily_cleaning` with `completion_photos` NULL or short. Image 2 shows Natali's room 101 awaiting approval with only 2 photos.

Causes in `SimplifiedPhotoCapture.tsx` + `AssignedRoomCard.tsx`:

1. Photo upload is **fire-and-forget** in `capturePhoto()` (line 316) — UI auto-advances and may show "complete" while the upload is still pending or has failed. If the housekeeper closes the dialog with `force=true` (e.g. via the save confirmation), the assignment is later marked complete with the partial `completion_photos` array.
2. The check in `AssignedRoomCard.updateAssignmentStatus` only validates `> 0` photos, not "all 5 categories present".
3. `markAsDND` and `markAsNoService` paths set `status='completed'` without any photo check — but those are intentional. The DND path *requires* a DND photo via a different dialog; verify it is enforced.
4. Closing the SimplifiedPhotoCapture dialog with `handleClose` only warns when there are unsaved photos, not when categories are missing.

Fix:

- In `AssignedRoomCard.updateAssignmentStatus` (daily_cleaning branch): require that `completion_photos` contains photos for **all 5 required categories** (`trash_bin`, `bathroom`, `bed`, `minibar`, `tea_coffee_table`). Detect by parsing the filename prefix as the capture flow already does. If not all present, block completion and reopen `SimplifiedPhotoCapture` with a clear error.
- In `SimplifiedPhotoCapture.capturePhoto`: await the upload before advancing to the next category (or at least await before allowing "Save"). Track per-photo upload state; disable the final "Save & Complete" button until all `uploadingPhotos` resolve and all 5 categories have an uploaded URL persisted to `completion_photos`.
- Add server-side guard via a DB trigger (migration) on `room_assignments` that prevents `UPDATE` to `status='completed'` when `assignment_type='daily_cleaning'` AND not all 5 category prefixes are present in `completion_photos`. Provides defense in depth so the bug cannot recur via stale clients.
- Improve `handleClose` warning to list missing categories explicitly.
- Backfill / cleanup is **not** in scope; only forward fix.

### 4. Hungarian translations + UI overflow (images 3–5)

Image 3 issues:
- "Függőben lévő jóváhagyások" tab pill overflows its container — text is wider than the pill background.
- Tab strip ("Jegyek / Szobák / Takarítás / Jelenlét") and sub-tab strip ("Személyzet / Approval / Csapat / Telj…") are cut off on the right; "Approval" itself is not translated.

Image 4: same overflow on history tab; "Approval History" not translated.

Image 5: section header **"Captured Data During Cleaning"** is hard-coded English in `src/components/dashboard/CompletionDataView.tsx:252`. Also "Room Photos", "Dirty Linen", "View photos", "View collected items" labels likely hard-coded.

Fixes:

- In `CompletionDataView.tsx`: replace hard-coded strings with `t('completion.capturedData')`, `t('completion.roomPhotos')`, `t('completion.dirtyLinen')`, `t('completion.viewPhotos')`, `t('completion.viewCollectedItems')`, `t('completion.noDataWarning')`, `t('completion.duration')`, `t('completion.fullCleaningTime')`. Add the keys for all 5 supported languages in `src/hooks/useTranslation.tsx` (and/or `src/lib/comprehensive-translations.ts` to stay consistent with existing pattern).
- Translate the sub-tab labels: `Approval` → `Jóváhagyás`, `Approval History` → `Jóváhagyási előzmények`. Find the tab label sites (likely in `HousekeepingManagerView.tsx` / `HousekeepingTab.tsx`) and switch to `t(...)` keys; add HU translations.
- **Tab/pill overflow**: the active pill is using a fixed inner width that does not grow with longer Hungarian text. In the tab list components, change to `flex-1 min-w-0` items with `truncate` and wrap the strip in `overflow-x-auto` with snap so longer translations either truncate cleanly or scroll horizontally on mobile. Add `px-2 text-xs sm:text-sm` so 4 pills fit at 390px without clipping.
- Verify the `useTranslation.test.tsx` smoke test still passes; add a new case asserting `completion.capturedData` resolves to "Rögzített adatok takarítás közben" (HU) and the other 4 languages.

### Files to change

| File | Change |
|---|---|
| `src/components/dashboard/HotelRoomOverview.tsx` | UI restructure |
| `src/components/dashboard/AttendanceTracker.tsx` | Early sign-out trigger window + confirmation |
| `src/components/dashboard/EarlySignoutApprovalView.tsx` | 60-min expiry, manager notification trigger |
| `src/hooks/useNotifications.tsx` | Subscribe to early_signout_requests INSERT for managers |
| `src/components/dashboard/SimplifiedPhotoCapture.tsx` | Await uploads, block save until all categories persisted |
| `src/components/dashboard/AssignedRoomCard.tsx` | Validate all 5 categories before status=completed |
| `supabase/migrations/<new>.sql` | Trigger blocking incomplete daily completions |
| `src/components/dashboard/CompletionDataView.tsx` | Replace hard-coded strings with `t(...)` |
| `src/components/dashboard/HousekeepingManagerView.tsx` / `HousekeepingTab.tsx` | Translate Approval / Approval History tab labels; fix overflow classes |
| `src/hooks/useTranslation.tsx` (+ `comprehensive-translations.ts`) | Add HU/EN/ES/VI/MN keys |
| `src/hooks/useTranslation.test.tsx` | Add assertions for new keys |

### Out of scope
- Backfilling old `completed` rooms with missing photos.
- Reworking the broader checkout-rooms card.
