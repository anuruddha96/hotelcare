# Translation completeness + 2 UI fixes

## Goal
Bring Filipino (`tl`), Spanish (`es`), and the other supported languages (`hu, vi, mn, az`) to full coverage for the screens shown in the screenshots, and fix two specific UI issues that prevent housekeepers from understanding what's actionable.

## Part A — UI fixes (independent of translations)

### A1. "Hold to complete" hint clipped on active room card
`AssignedRoomCard.tsx` (the room currently being cleaned) renders the hold-text under the green "Tapos na" button. With a long localized phrase like *"Pindutin at hawakan para tapusin"* it currently overflows the card edge.

Fix in `AssignedRoomCard.tsx` only:
- Move the hint into the same constrained width as the button (full card width, `px-3`).
- Apply `text-[11px] sm:text-xs leading-tight text-center break-words` so the string wraps to 2 lines instead of overflowing.
- Same treatment to the matching "Press & hold to start" hint shown above non-active rooms (`housekeeping.holdToStart`) where Filipino/Spanish are also longer than English.

### A2. "Detalyadong Record" list looks non-scrollable in linen cart
`LinenCart.tsx` (the bottom-sheet shown in screenshot 8) lists per-room entries inside a fixed-height container, but there is no visual cue that more content exists below.

Fix in `LinenCart.tsx` only:
- Wrap the list in a relatively-positioned div with `flex-1 min-h-0 overflow-y-auto pr-1`.
- Force the scrollbar to remain visible on touch devices: `scrollbar-thin scrollbar-thumb-muted-foreground/30 [&::-webkit-scrollbar]:w-1.5`.
- Add a bottom fade-out gradient overlay (`pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background to-transparent`) that hides automatically when the user has scrolled to the end (toggle via a small `onScroll` state).
- Add a tiny "↓ Mag-scroll para makita ang lahat" (translated) hint above the list when the content is taller than the viewport.

No business logic changes.

## Part B — Translation completeness

Approach: keep existing modules, only add missing keys per language. Where a string is currently rendered as a hardcoded English literal (e.g. *"Hotel Ottofiori Management System"*, *"Hotel Assignment:"*, ticket stat labels), replace with a `t('...')` call and add the key to every language bundle. English fallback remains automatic.

### B1. Strings to translate (grouped by screen)

**Manager → Housekeeping → Pending Approvals (screenshots 1 & 2)**
- `dashboard.subtitleManagement` — *"{hotel} Management System"* (currently hardcoded literal)
- `approvals.title`, `approvals.subtitle` (*Manage approvals and review history*)
- `approvals.tabPending`, `approvals.tabLateMinibar` (*Mga Huling Idinagdag sa Minibar*), `approvals.tabHistory`
- `approvals.reviewCleaningTasks`, `approvals.roomsCount`, `approvals.maintenanceCount`, `approvals.flaggedCount`, `approvals.oldestLabel`
- `approvals.roomCompletionTitle` (*Approval sa Pagkatapos ng Kuwarto*)
- `approvals.approveAll`, `approvals.approve`, `approvals.pendingBreakRequests`
- `approvals.cleaningTrend.normal`, `cleaningTrend.fast`, `cleaningTrend.slow` plus the existing tooltip *Items with unusually fast or slow completion times* (`approvals.trendTooltip`)

**Housekeeper mobile dashboard (screenshots 3, 4, 5, 6)**
- `housekeeping.myTasksButton` (the big "My Tasks" CTA)
- `housekeeping.workSchedule`, `housekeeping.totalTasksToday`, `housekeeping.done`, `housekeeping.inProgressShort`, `housekeeping.waiting`
- `housekeeping.todaysAssignments` (already exists?), `housekeeping.tasksCount` for the pill count
- `housekeeping.hotelAssignmentLabel` (*Hotel Assignment:*)
- Room status badges: `housekeeping.status.inProgress` (GINAGAWA PA), `status.pending` (NAGHIHINTAY), `status.dirty`, `status.checkoutClean`, `status.dailyClean`, `status.towelChange` (already), `status.night2`, `status.night3`, `status.mediumPriority`
- Room card sections: `housekeeping.todoTitle` (Kailangang gawin), `housekeeping.dndPhoto` (Larawan ng DND), `housekeeping.dirtyLinen`, `housekeeping.minibar`, `housekeeping.lostFound`, `housekeeping.maintenance`
- Buttons: `housekeeping.markDone` (Tapos na), `housekeeping.startCleaning` (Simulan ang paglilinis), `housekeeping.noService` (Walang serbisyo), `housekeeping.holdToStart`, `housekeeping.holdToComplete`, `housekeeping.addNote` (Magdagdag ng note), `housekeeping.details`
- Messages: `housekeeping.messagesLabel` (MGA MENSAHE), `housekeeping.messagePlaceholder` (Mag-type ng mensahe…)

**Attendance / Settings (screenshot 7)**
- Top tab label `dashboard.attendance` (the third tab still says "Attendance" because the key is missing in `tl`)
- Settings field labels — `settings.email` already exists but missing `tl`; same for `settings.role` (Tungkulin), `settings.assignedHotel` (Nakatalagang Hotel), `settings.nickname` (Palayaw), `settings.lastLogin` (Huling pag-login)
- Location-access card keys (already added in previous turn) — verify `tl` translations appear; if missing extend `location-translations.ts`

**Linen Cart (screenshot 8)**
- Cart chrome: `linenCart.title` (Aking Linen Cart), `linenCart.totalToday` (Kabuuan ngayong araw), `linenCart.totalSuffix` (Mga Linen), `linenCart.breakdown` (Hati-hati ayon sa uri), `linenCart.detailedRecord` (Detalyadong Record), `linenCart.scrollHint`, `linenCart.empty`
- Linen item names — these come from a DB enum/lookup currently rendered raw. Add a translation map `linen.item.bathMat`, `linen.item.bigTowel`, `linen.item.smallTowel`, `linen.item.bigPillow`, `linen.item.duvetCovers`, `linen.item.bedSheetsQueen`, `linen.item.bedSheetsKing`, etc. Create a tiny helper `tLinenItem(name)` that maps the DB code/English label to the translation key with English fallback. Apply in both the breakdown list and the per-room rows.

**Tickets (screenshot 9)**
- Header: `tickets.allTickets`, `tickets.manageFor` (Pamahalaan ang mga gawain para sa {hotel})
- Stats: `tickets.totalLabel`, `tickets.openLabel`, `tickets.inProgressLabel`, `tickets.completedLabel`
- Filters: `tickets.searchPlaceholder` (already), `tickets.allStatus`, `tickets.allPriority`, `tickets.allDepartments` (Lahat ng Department — currently truncated as "Lahat ng De|")
- Empty state: `tickets.noResults` (No tickets found) — verify `tl`
- Button: `tickets.new` (New)

### B2. Language coverage rule
For every key above, add translations in this order with this fallback rule:
1. `en` — canonical source
2. `tl`, `es`, `hu`, `vi`, `mn`, `az` — full translations for every new key

Filipino, Spanish, Hungarian, Vietnamese, Mongolian, Azerbaijani — all get the same key list. Where translation is uncertain we use natural phrasing aligned with the existing tone (informal "you" for housekeepers in `tl/vi/mn`, formal "usted" in `es`).

### B3. Module placement
- General/UI strings → `src/lib/comprehensive-translations.ts`
- Housekeeping mobile dashboard → `src/lib/expanded-translations.ts`
- Approvals screen → `src/lib/screen-translations.ts`
- Linen cart + linen item names → new `src/lib/linen-translations.ts` registered in `useTranslation.tsx`
- Tickets list → `src/lib/comprehensive-translations.ts`

### B4. Component edits to swap hardcoded literals to `t()`

- `HousekeepingManagerView.tsx` (subtitle, approvals tabs, approval card titles, "Approve All")
- `PendingApprovalsTab.tsx` / `ApprovalCard.tsx` (stat cards, approval row labels)
- `MyTasksMobile.tsx` (or equivalent) — My Tasks button, schedule labels, stat cards, "Hotel Assignment:"
- `AssignedRoomCard.tsx` — *GINAGAWA PA* badge, todo title, action labels, hold-to-* hints
- `LinenCart.tsx` — all chrome strings + per-item names via `tLinenItem`
- `TicketsList.tsx` / `TicketsHeader.tsx` — title, subtitle, New button, stat labels, filter placeholders, empty state
- `SettingsDialog.tsx` — verify all field labels go through `t()`

No DB changes, no API changes.

## Out of scope
- No new auth, RLS, edge functions.
- No layout/structural changes besides the 2 UI fixes in Part A.
- Training translations (already complete in `tl`).

## Files

**New**
- `src/lib/linen-translations.ts`

**Edited**
- `src/hooks/useTranslation.tsx` (register linen module)
- `src/lib/comprehensive-translations.ts`, `expanded-translations.ts`, `screen-translations.ts`, `location-translations.ts`
- `src/components/dashboard/HousekeepingManagerView.tsx`
- `src/components/dashboard/PendingApprovalsTab.tsx`, `ApprovalCard.tsx` (or equivalent)
- `src/components/dashboard/MyTasksMobile.tsx` (or equivalent housekeeper mobile dashboard)
- `src/components/dashboard/AssignedRoomCard.tsx` (UI fix A1 + translation swaps)
- `src/components/dashboard/LinenCart.tsx` (UI fix A2 + translation swaps)
- `src/components/dashboard/TicketsList.tsx` / header (translation swaps)
- `src/components/dashboard/SettingsDialog.tsx` (translation swaps)
