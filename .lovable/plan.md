

## Plan: Improve Housekeeper Room Card Special Instructions Visibility

### Current Issues
1. **MobileHousekeepingCard**: Towel/linen banners are buried below hotel info and room name. Assignment notes are at the very bottom after action buttons. No bed configuration or manager room notes shown at all.
2. **AssignedRoomCard**: Has banners in CardContent but they sit below the header badges. The assignment-level notes (`assignment.notes`) are rendered separately from room-level notes (`assignment.rooms?.notes`), which is confusing.
3. Both cards lack a unified "Special Instructions" section that's impossible to miss.

### Changes

#### 1. MobileHousekeepingCard — Move all instructions to top, add missing fields
- Move towel/linen change banners to immediately after the room number header (before hotel/floor info)
- Add bed configuration banner (currently missing entirely)
- Add manager room notes banner (currently missing — only assignment notes shown)
- Move assignment notes from bottom to the special instructions block at top
- Use consistent color-coded styling matching AssignedRoomCard

#### 2. AssignedRoomCard — Elevate special instructions into the header area
- Move the special instructions banners block from inside CardContent to directly after CardHeader, before room details grid
- Already has all four banner types (towel, linen, bed config, room notes) — just needs the assignment-level notes added to the same block
- Add a subtle pulsing left-border or top-border accent when any special instruction exists so the card visually "pops"

#### 3. Consolidate banner styling
- Create a shared `SpecialInstructionsBanner` inline section pattern used by both cards
- Keep the existing color scheme: yellow=towel, purple=linen, blue=bed config, amber=manager notes, amber-gradient=assignment notes
- Add a count indicator like "⚠️ 3 Special Instructions" as a summary badge in the card header when instructions exist

### Files to Edit
| File | Change |
|------|--------|
| `src/components/dashboard/MobileHousekeepingCard.tsx` | Restructure layout: move all instruction banners to top, add bed_configuration and room notes |
| `src/components/dashboard/AssignedRoomCard.tsx` | Move assignment notes into the special instructions block, add summary badge in header |

No new files needed. No database changes.

