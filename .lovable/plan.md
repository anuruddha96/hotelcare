# Fix: Missing translations + clipped Hotel Switcher button

## 1. Hotel Switcher button UI fix (header, mobile)

**Problem:** In the mobile header, the Hotel Switcher button appears clipped — the Building2 icon is half-cut (looks like a partial "b" between the logo and language flag). Cause: `Header.tsx` puts everything in an `overflow-x-auto` row, but the logo block consumes `flex-1` and squeezes the right-side icons; the HotelSwitcher button (`size="sm"` + icon only on mobile) ends up overlapping/clipped against the logo area.

**Fix in `src/components/layout/HotelSwitcher.tsx`:**
- Add `shrink-0` to the trigger Button so it never collapses
- Add `aria-label` + proper min-width on mobile so the icon is never clipped
- Keep the hotel name hidden on mobile (current behavior), but make sure the button itself is a clean 36px icon button

**Fix in `src/components/layout/Header.tsx`:**
- Logo wrapper: change `flex-1 sm:flex-initial` → `shrink min-w-0` (don't grab all space on mobile) and tighten max-widths so the right-side icons get breathing room
- Right section: already has `overflow-x-auto`, but add `pl-2` and ensure inner `shrink-0` works (it does)

Result: HotelSwitcher renders as a clean icon button on mobile, no clipping, fully tappable.

## 2. Missing translations

The screenshots highlight untranslated English strings on these screens (visible while UI language = Hungarian):

| Screen | Untranslated strings |
|---|---|
| SupervisorApprovalView | "Room Completion Approvals", "Approve All", "Approve", "Details", "Started: X · Completed: Y" |
| Dashboard (Housekeeping > Approval) | "Hotel Ottofiori Management System" subtitle, "Late Minibar Additions", "Pending Approvals" date row, "Rooms / Maintenance / Flagged / Oldest" stat tiles, "May 16th, 2026" date label |
| HotelRoomOverview (Team tab) | "Hotel Room Overview", "TOTAL / EARLY C/O / NO-SHOW / ACT" labels, "Checkout Rooms", "11 PM · 0 manual" |
| PerformanceLeaderboard | "TOP PERFORMER", "TEAM AVERAGE", "X ranked", "X% on-time", "FIGYELMET IGÉNYEL" (this one is already HU but mixed casing) |
| LostAndFoundManagement | "Lost & Found Management", "Add Item", "Search by room number…", "Shoes / Room / Hotel / Found / By" labels, "View", "Claim", "pending" badge |
| DNDPhotosManagement | "Do Not Disturb (DND) Photos Management", "Today" filter, "All Hotels", "No DND photos found for the selected period" |
| AttendanceTracker (HR / Break Types) | "Duration (minutes)", "Existing Break Types", "Lunch Break" (default seeded name OK to leave), Icon label "Coffee" stays English |
| RoomManagement (mobile) | "Search by room number or hotel…", "All Hotels", "All Status", "All Types", "Out of Order / Nem elérhető" mixed |

### Approach

1. Add the missing keys to `src/hooks/useTranslation.tsx` (the canonical i18n dictionary) under appropriate namespaces (`approvals.*`, `dashboard.*`, `team.*`, `performance.*`, `lostFound.*`, `dnd.*`, `attendance.*`, `rooms.*`), with full translations for the 5 supported languages: en, hu, es, vi, mn.
2. Replace the hardcoded English strings in the corresponding components with `t('namespace.key')` calls. Files to edit:
   - `src/components/dashboard/SupervisorApprovalView.tsx`
   - `src/components/dashboard/Dashboard.tsx` (subtitle line and stat-tile labels)
   - `src/components/dashboard/HotelRoomOverview.tsx`
   - `src/components/dashboard/PerformanceLeaderboard.tsx`
   - `src/components/dashboard/LostAndFoundManagement.tsx`
   - `src/components/dashboard/DNDPhotosManagement.tsx`
   - `src/components/dashboard/AttendanceTracker.tsx` (Break Types card)
   - `src/components/dashboard/RoomManagement.tsx` (filters)
3. For date labels ("May 16th, 2026") use the existing locale-aware formatter or `toLocaleDateString(language)` so the date itself follows the UI language.

### Scope guard

- No backend, no schema, no logic changes — purely UI strings + one small flex/shrink CSS adjustment in the header.
- No changes to the Previo auto-poll / push-to-Previo work; Ottofiori and live hotels remain untouched.

### Out of scope (won't change unless you confirm)

- Seeded data values like the "Lunch Break" name and icon name "Coffee" — those live in the DB, not in code. Tell me if you want those translated at render time too.
- "ottofiori" location pill on Room Management — that's a hotel slug from the DB, not a translatable string.
