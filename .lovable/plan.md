

## Plan: Improve Auto-Assignment Feature

After reviewing the full 1179-line `AutoRoomAssignment.tsx` and the 696-line algorithm, here are the most impactful improvements:

### 1. Room Exclusion Toggle (Step 1)
Allow managers to deselect specific dirty rooms they don't want assigned today (e.g., VIP rooms being held, rooms under maintenance review). Currently ALL dirty rooms are forced into the assignment.

**File: `AutoRoomAssignment.tsx`**
- Add `excludedRoomIds` state (`Set<string>`)
- In the towel-change section, add a secondary row of room chips with a "strike-through" toggle to exclude rooms
- Filter out excluded rooms before passing to `autoAssignRooms()`
- Show excluded count in the stats bar

### 2. Linen Change Pre-Assignment Toggle (Step 1)
Identical to the existing towel-change collapsible but for linen. Currently there's no way to bulk-set linen changes before generating assignments.

**File: `AutoRoomAssignment.tsx`**
- Add a second collapsible section "Pre-Assignment: Linen Change" below the towel section
- Same chip-toggle UI with purple styling instead of yellow
- "Select All" / "Deselect All" button
- Updates `rooms.linen_change_required` in DB and local state

### 3. Undo/Redo for Drag-and-Drop Moves (Step 2)
Currently drag-drop changes in the preview are irreversible. Add an undo stack.

**File: `AutoRoomAssignment.tsx`**
- Add `previewHistory` state (array of `AssignmentPreview[]` snapshots, max 20)
- Before each `moveRoom` call, push current state to history
- Add "Undo" button in the preview footer (shows count of available undos)
- Keyboard shortcut Ctrl+Z support

### 4. Print/Export Assignment Sheets
Managers often need to print daily assignment sheets for housekeepers who don't use the app.

**File: `AutoRoomAssignment.tsx`**
- Add "Print Assignments" button in the confirm step
- Opens a new window with a clean printable layout: one page per housekeeper
- Shows: staff name, date, room list (number, type, floor, special instructions), estimated time

### 5. Translate All Hardcoded Strings
The component has ~50+ hardcoded English strings (button labels, headings, toast messages, step labels).

**Files: `AutoRoomAssignment.tsx` + `src/lib/pms-translations.ts`**
- Add `autoAssign.*` translation keys (~50 keys across 5 languages)
- Replace all hardcoded strings with `t()` calls
- Covers: step labels, stats labels, room chip labels, button text, toast messages, dialog titles, info text

### Files Changed Summary

| File | Changes |
|------|---------|
| `AutoRoomAssignment.tsx` | Room exclusion, linen toggle, undo/redo, print, translations |
| `src/lib/pms-translations.ts` | Add ~50 `autoAssign.*` keys in en/hu/mn/es/vi |

No database migrations needed -- all changes use existing columns (`linen_change_required` already exists on `rooms`).

