## Scope (revised)

Drop the Previo push entirely. Two changes only:

### 1. Hide Perishable Item Tracker
Remove the `<PerishablePlacementManager />` block from `src/components/dashboard/MinibarTrackingView.tsx` (around lines 886–887). Component file and its tables stay in the repo, dormant, so we can revive it later if brownies return.

### 2. Make minibar usage clearly visible

Today: `room_minibar_usage` collects rows from both `source = 'staff'` / `'reception'` (housekeeper +) and `source = 'guest'` (QR). The compact/organized room cards only show a total € badge; there's no per-item / per-source breakdown, and it's easy to miss.

Changes:

- **Room cards** (`CompactRoomCard.tsx`, `OrganizedRoomCard.tsx`): when `minibar_usage` has rows, show a small stacked list — one line per item with quantity, name, and a tiny icon distinguishing 👤 guest (QR) vs 🧹 staff (HK). Keep the € total badge as-is.
- **Room detail dialog** (`RoomDetailDialog.tsx`): existing minibar section gets a "Source" column (Guest QR / Housekeeper / Reception) and timestamp, sorted newest-first. No editing changes.
- **Manager reminder banner**: inside the minibar section of the room detail, add a subtle note: "Charge these items to the guest in Previo manually before checkout." Only shown to roles that can see minibar (managers/supervisors/reception) and only when there is at least one unclaimed usage row.
- **Visibility (`eligible users`)**: today `room_minibar_usage` RLS already lets housekeepers, supervisors, managers, reception, and admins read. Confirm the room detail dialog and the two room-card components render the section for all of those roles (currently gated in some views). No RLS change, only UI gating.

Nothing sent to Previo. No new tables. No edge function changes. No approval workflow.

## Files to change

- `src/components/dashboard/MinibarTrackingView.tsx` — remove Perishable block.
- `src/components/dashboard/CompactRoomCard.tsx` — per-item breakdown with source icon.
- `src/components/dashboard/OrganizedRoomCard.tsx` — same.
- `src/components/dashboard/RoomDetailDialog.tsx` — source column, timestamp, manager reminder banner, verify role gating.

## Open question

For the room-card breakdown, do you want **all items listed** (can get tall if a guest logs 5 things) or **just a count badge** ("3 items · €14.50") that expands only in the detail dialog? I'd default to the compact count badge on cards + full list in the dialog unless you say otherwise.