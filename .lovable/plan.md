

## Plan: Fix Missing Translations, Hotel Care Branding & Translated ACT Tooltip

### Problems Identified

1. **Hardcoded English strings** scattered across multiple components — not going through `t()`:
   - `HousekeepingManagerView.tsx`: "Team View", "Early Sign-Out Approvals", "Auto Assign", "Public Areas"
   - `AttendanceTracker.tsx`: "Pending Early Sign-Out Approval", "Auto Signed Out", "Forgot Sign Out", early sign-out status messages
   - `PerformanceLeaderboard.tsx`: "Avg Rooms/Hour", "Outliers Filtered", "Needs Attention", "Rooms/Hr", "Hours", "Quality", tooltip contents, "rooms in X days", "outliers removed", "day streak", "reviews"
   - `SimplifiedDirtyLinenManagement.tsx`: "Export to CSV", "Total Collected", "X Housekeepers", "No data available..."
   - `RealtimeNotificationProvider.tsx`: All notification messages hardcoded in English ("New break request submitted", "Room completed and ready for approval", etc.)
   - `SupervisorApprovalView.tsx`: "Early Sign-Out Requests" section header and toast messages
   - `PMSUpload.tsx`: "PMS Upload Complete" notification

2. **ACT tooltip** in `HotelRoomOverview.tsx` (line 912) shows "Average Cleaning Time" in English only — not translated, and not using `UI_HINTS` system

3. **Hotel Care branding missing** from notifications — service worker, `useNotifications.tsx`, and `serviceWorkerManager.ts` all use `/favicon.ico` and titles like "RD Hotels" instead of "Hotel Care"

### Changes

#### 1. Add translation keys to `src/lib/comprehensive-translations.ts`
Add ~40 new keys across all 5 languages (en, es, hu, vi, mn):
- `manager.teamView`, `manager.earlySignOutApprovals`, `manager.autoAssign`, `manager.publicAreas`
- `attendance.pendingEarlySignOut`, `attendance.autoSignedOut`, `attendance.forgotSignOut`, `attendance.waitingSupervisor`, `attendance.earlySignOutApproved`, `attendance.earlySignOutRejected`, `attendance.approvedBy`
- `performance.avgRoomsHour`, `performance.outliersFiltered`, `performance.needsAttention`, `performance.roomsHr`, `performance.hours`, `performance.quality`, `performance.roomsInDays`, `performance.outliersRemoved`, `performance.dayStreak`, `performance.reviews`, `performance.noRatingsYet`
- `linen.exportCsv`, `linen.totalCollected`, `linen.housekeepersCount`, `linen.noData`
- `notifications.breakRequest`, `notifications.breakRequestTitle`, `notifications.roomReadyApproval`, `notifications.approvalRequired`, `notifications.maintenanceReview`, `notifications.maintenanceApproval`, `notifications.newTicketAssigned`, `notifications.newTicket`, `notifications.ticketStatusChanged`, `notifications.ticketUpdate`
- `room.actTooltip` (translated ACT tooltip for all languages)

#### 2. Update `src/lib/ui-hints.ts`
Make `room.act` hint translatable — change the hint system to support translated hints or add translated ACT hints directly.

Since `UI_HINTS` is a simple `Record<string, string>`, and the `HelpTooltip` component uses it directly, the simplest approach is to **not use UI_HINTS for ACT** and instead use `t('room.actTooltip')` directly in the tooltip content in `HotelRoomOverview.tsx`.

#### 3. Update components to use `t()` calls

**`HousekeepingManagerView.tsx`** (~lines 535-594):
- Replace "Team View" → `t('manager.teamView')`
- Replace "Early Sign-Out Approvals" → `t('manager.earlySignOutApprovals')`
- Replace "Auto Assign" → `t('manager.autoAssign')`
- Replace "Public Areas" → `t('manager.publicAreas')`
- Add `truncate` or `text-xs` responsive classes on tab triggers for long translations

**`AttendanceTracker.tsx`** (~lines 480-562):
- Replace hardcoded status badge texts with `t()` calls
- Replace early sign-out status messages with `t()` calls

**`PerformanceLeaderboard.tsx`** (~lines 589, 603, 562, 636, 651, 662-667, 689, 709, 718, 721, 736, 748, 762, 770):
- Replace all hardcoded metric labels and tooltip texts with `t()` calls

**`SimplifiedDirtyLinenManagement.tsx`** (~lines 218, 226, 283, 328, 343, 349):
- Replace "Export to CSV", "Total Collected", "Housekeepers", "No data available" with `t()` calls

**`RealtimeNotificationProvider.tsx`** (all notification strings):
- Replace all hardcoded notification messages with `t()` calls

**`SupervisorApprovalView.tsx`** (~lines 1096, 1147, 1151, 1179, 1183):
- Replace "Early Sign-Out Requests" and toast messages with `t()` calls

**`HotelRoomOverview.tsx`** (line 912):
- Replace `Average Cleaning Time` with `t('room.actTooltip')`

#### 4. Hotel Care branding for notifications

**`public/service-worker.js`** (lines 23-24):
- Change `title: 'RD Hotels'` → `title: 'Hotel Care'`
- Change `CACHE_NAME: 'rd-hotels-v1'` → `CACHE_NAME: 'hotelcare-v1'`

**`src/hooks/useNotifications.tsx`** (~lines 98, 171, 203, 245):
- Change notification title fallbacks from any hardcoded brand to 'Hotel Care'

**`src/lib/serviceWorkerManager.ts`** (lines 64-68):
- Already uses `/favicon.ico` for icon — keep as-is (the favicon should be Hotel Care branded)
- Change any hardcoded title references to 'Hotel Care'

**`src/components/dashboard/PMSUpload.tsx`** (line 834):
- Replace `'PMS Upload Complete'` → `t('notifications.pmsUploadComplete')`

#### 5. UI handling for long translations
- On tab triggers in `HousekeepingManagerView.tsx`, add `text-xs truncate` classes so Hungarian/Mongolian text doesn't break layout
- On buttons ("Auto Assign", "Public Areas"), use responsive text sizing (`text-xs sm:text-sm`) and allow wrapping with `whitespace-nowrap` removed where needed

### Files Changed

| File | Changes |
|------|---------|
| `src/lib/comprehensive-translations.ts` | ~40 new keys × 5 languages |
| `src/components/dashboard/HousekeepingManagerView.tsx` | Replace 4 hardcoded strings with `t()`, add responsive text classes |
| `src/components/dashboard/AttendanceTracker.tsx` | Replace ~6 hardcoded status/message strings with `t()` |
| `src/components/dashboard/PerformanceLeaderboard.tsx` | Replace ~15 hardcoded labels/tooltips with `t()` |
| `src/components/dashboard/SimplifiedDirtyLinenManagement.tsx` | Replace ~5 hardcoded strings with `t()` |
| `src/components/dashboard/RealtimeNotificationProvider.tsx` | Replace ~6 hardcoded notification messages with `t()` |
| `src/components/dashboard/SupervisorApprovalView.tsx` | Replace ~4 hardcoded strings with `t()` |
| `src/components/dashboard/HotelRoomOverview.tsx` | Translate ACT tooltip |
| `src/components/dashboard/PMSUpload.tsx` | Translate notification title |
| `public/service-worker.js` | Hotel Care branding |
| `src/hooks/useNotifications.tsx` | Hotel Care branding in notification titles |

