# Team View: tap-to-assign instead of long drags (SLNT only)

Assignment on the board uses native HTML5 drag (`draggable` + `onDragStart`/`onDrop` in `HotelRoomOverview.tsx` and `HousekeepingManagerView.tsx`). That has two real problems:

- Native HTML5 drag does not fire from touch input, so on phones and tablets chips cannot be dragged at all.
- On desktop, a chip at the top of a long venue list has to be dragged past the whole board to reach the housekeeper cards, and the page does not auto-scroll during the drag.

Drag stays exactly as it is. We add a faster path that works identically on mobile and desktop.

## 1. Selection mode (primary way to assign)

- Tap/click a unit chip to select it; tap again to deselect. Selected chips get a check mark and a highlighted outline.
- Tap a venue header to select or deselect every unit in that venue at once.
- A "Select all in section" control on Checkout / Stayover headers.
- Selection count is shown in the action bar: "7 units selected".
- Opening the existing unit detail dialog moves to a long-press / dedicated icon on the chip so a plain tap always means select.

## 2. Assign bar

While anything is selected, a sticky bar sits at the bottom of the screen (above the existing pending-moves bar, merged into one bar when both apply):

- Horizontal row of housekeeper buttons — avatar, name, current unit count — tap one to stage the selected units onto that housekeeper.
- "Unassign" button to stage removal.
- "Clear selection".
- After staging, the selection clears and the chips move into the housekeeper card as they do today, still pending until "Apply".

This reuses the existing staged-move store, so auto-save, Undo last, Apply and Discard behave exactly as they do now.

## 3. Keeping everything at one glance

- The housekeeper strip inside the assign bar is horizontally scrollable, so no scrolling of the page is needed to reach a housekeeper.
- On mobile the bar is compact (avatar + count, name truncated); on desktop it shows full names in one row.
- Board scrolls normally underneath; the bar never covers the last row (bottom padding added while the bar is visible).

## 4. Drag improvements (kept as secondary)

- Auto-scroll the page while dragging near the top/bottom edge, so a chip from the top of the list can still reach the cards.
- Touch devices get the selection flow instead of drag; drag handlers stay untouched for mouse users.

## Technical notes

- All changes are in `src/components/dashboard/HotelRoomOverview.tsx`, `src/components/dashboard/HousekeepingManagerView.tsx`, and a small shared selection store next to `src/lib/stagedAssignments.ts` (same `useSyncExternalStore` pattern, so board and cards agree on what is selected).
- Gated by the same `canDragAssign` permission and SLNT tenant flag already used for drag, so RD Hotels and Ottofiori see no change.
- No database or edge function changes; writes still go through `assignRoomToStaff` / `unassignRoom` on Apply.

## Checks

- Phone: select 5 units across two venues, tap a housekeeper, Apply — all five land on that housekeeper.
- Desktop: existing drag still works; dragging near the bottom edge scrolls the board.
- Supervisor scope, housekeeper read-only view, and Ottofiori/RD Team View unchanged.
