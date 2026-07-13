## Goal

Turn the left column of Hotel Room Overview into a true **read-only snapshot of yesterday's working day** (assignments, statuses, staff, done/pending as they stood at end of day). The right column stays the live "today" view. No changes to any live assignments — this is a rendering/wiring change only.

## Behavior

**Left column ("Yesterday — read-only"):**
- Header changes from "Yesterday / carried" to `Yesterday — {date}` with a `Read-only` badge.
- Shows every room that had an assignment on the most recent prior working day (default: `selectedDate - 1`; if that day has zero assignments, fall back to the latest earlier `assignment_date` that has any rows, so weekends/gaps still render something).
- Each chip reflects **yesterday's final state**, not today's:
  - assigned housekeeper (from yesterday's row)
  - status (completed / in_progress / assigned / not started)
  - supervisor_approved flag
  - checkout vs daily (from yesterday's `assignment_type`)
  - completion time if present
- Chips are fully non-interactive: no drag, no click-to-open editor, no context menu, no type switch, no "mark ready" — all handlers gated behind an `isReadOnly` prop on the chip renderer.
- Drag-and-drop drop target on the left column is disabled.

**Right column ("Today"):**
- Unchanged behavior. Shows current live assignments + PMS/manual rooms for `selectedDate`.
- Managers keep all existing edit/drag/assignment powers here.

**Carried-over rooms:** the current "carried incomplete" logic (`carriedRoomIds`) is removed from the split — it was conflating two ideas. Yesterday's snapshot naturally shows any unfinished rooms as `in_progress`/`assigned`. If a room genuinely needs redoing today, the manager creates a today assignment (already supported).

## Technical Plan

All work in `src/components/dashboard/HotelRoomOverview.tsx` + a couple of translation keys.

1. **Add "previous working day" resolver in `fetchData`:**
   - Query `room_assignments` for the max `assignment_date < selectedDate` scoped to this hotel's `room_id`s (single query with `order desc limit 1`).
   - Then fetch all `room_assignments` rows for that date, selecting: `room_id, assigned_to, status, assignment_type, supervisor_approved, ready_to_clean, started_at, completed_at, notes, assignment_date`.
   - Store in new state: `previousDayDate: string | null` and `previousAssignments: Record<string, YesterdayAssignment>` keyed by `room_id`.

2. **Replace `carriedRoomIds` split with snapshot-based split:**
   - `previousRooms` = rooms whose id is a key in `previousAssignments`.
   - `todayRooms` = every other room in the hotel list (same set as before).
   - A room appearing in both days shows on both sides (left = yesterday state, right = today state). This is intentional so managers can compare.

3. **Read-only chip path:**
   - Extract a lightweight `renderRoomChipReadOnly(room, yestAssignment)` (or pass `readOnly` + `overrideAssignment` props into the existing `renderRoomChip`). It reuses the same visual layout but:
     - Disables `onClick`, `onDragStart`, `draggable`, popover triggers, dropdown menus.
     - Sources `assigned_to`, `status`, `assignment_type`, `supervisor_approved`, `completed_at` from `yestAssignment` instead of live `assignments` state.
   - Wrap left-column chips in a container with `pointer-events-none` as a belt-and-braces guard, but keep the tooltip/name legible (wrap the label in a `pointer-events-auto` span if needed).

4. **Disable left-column drop target:**
   - In `renderSection`, when rendering the left panel, do not attach the `onDragOver/Drop` handlers to that sub-div, and pass `isReadOnly` down so the section header shows a small lock icon + "Read-only" badge.

5. **Header + labels:**
   - Left panel header: `Yesterday — {formatted previousDayDate}` + `Read-only` badge. If `previousDayDate` is null, show "No prior day data" and hide the panel body.
   - Update `t('team.yesterdayCarried')` copy in `src/lib/highlighted-translations.ts` for en/hu/es/vi/mn to "Yesterday" (plain), and add `team.readOnly` = "Read-only".

6. **No writes anywhere.** Confirm by grepping the new code path for `supabase.from('room_assignments').update|insert|delete` — must be zero in the read-only branch. No edge function redeploys.

7. **Realtime:** existing channel filter is `assignment_date=eq.${selectedDate}` (today only), so yesterday's snapshot won't churn — good. No changes needed.

## Files touched

- `src/components/dashboard/HotelRoomOverview.tsx` (fetch prior-day snapshot, split logic, read-only chip path, disable left-column DnD, header)
- `src/lib/highlighted-translations.ts` (label tweaks + `team.readOnly`)

## Out of scope

- No edge function changes, no migrations, no changes to live room_assignments, no PMS sync tweaks.
- Not touching the training module in this pass.
