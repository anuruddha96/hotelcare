## Goal

Fix four things in `HotelRoomOverview`:

1. **Daily rooms showing as "clean" when they aren't** (Ottofiori manager could not assign daily rooms because chips looked already-cleaned).
2. **Mobile view for managers**: hide the "Yesterday's rooms" column on mobile for `manager` role. Keep it on mobile for `admin` / `top_management`. Desktop unchanged (both columns visible for everyone).
3. **Yesterday's snapshot chips missing legend indicators** (DND, No-Show, Early Checkout, Towel Change, Linen Change, RC, extra towels, bed config).
4. **Legend expanded by default**.

No changes to live data, edge functions, DB, or training module.

## Technical Plan (only `src/components/dashboard/HotelRoomOverview.tsx`)

### 1. Fix "all daily rooms show as cleaned"
In `renderRoomChip` (line ~500), the status fallback is:
```ts
else statusKey = room.status || 'dirty';
```
`rooms.status` persists as `'clean'` from prior days, so a room without a today assignment renders green. Change the fallback so that when the room appears in a section (checkout/daily) but has **no `assignment` for today**, we always render it as `'dirty'` (needs cleaning), ignoring the stale `room.status`. Only use `room.status` when it explicitly signals a non-clean state (e.g. `dirty`, `in_progress`, `out_of_service`).

Concretely:
```ts
else if (!assignment) statusKey = 'dirty';
else statusKey = room.status && room.status !== 'clean' ? room.status : 'dirty';
```
This restores the manager's ability to see which rooms still need to be assigned today.

### 2. Hide left column on mobile for managers
`useIsMobile()` + existing role flags are already imported. In `renderSection`, wrap the two-column grid so the LEFT (yesterday) panel is not rendered when `isMobile && role === 'manager'`. Admins/top_management keep both columns on mobile. Right column becomes full-width in the mobile-manager case (drop the `md:grid-cols-[...]` and render only the right panel).

### 3. Add legend indicators to read-only yesterday chips
Extend `renderReadOnlyChip` to mirror the same visual affordances as `renderRoomChip`, using the room's current fields (best available proxy for yesterday's state — the DB doesn't store per-day snapshots of these flags):
- Ring colors: `is_dnd` → purple ring, `isNoShow(room)` → red ring, `isEarlyCheckout(room)` → orange ring.
- Inline badges: `towel_change_required` → `T`, `linen_change_required` → `C`, `roomFlags.roomCleaning` → `RC`, `roomFlags.collectExtraTowels` → 🧺, `bed_type === 'shabath'` → `SH`.
- Emoji indicators: 🚫 (DND), ⚠️ (no-show), 🔶 (early checkout).
- Bed configuration abbreviation and `📝` for clean notes under the chip.
- Keep existing yesterday-only markers (✅ approved / ⏳ pending / ⏱ in-progress, C/O tag, completion time, staff name).
- Still fully non-interactive (`pointer-events-none` container, no popover/drag/click handlers).

### 4. Legend expanded by default
Change `const [showLegend, setShowLegend] = useState(false)` → `useState(true)`.

## Out of scope
- No DB migrations, no edge function changes, no live-assignment writes.
- No changes to the training module or to any other screen.
- No change to desktop layout for any role.
