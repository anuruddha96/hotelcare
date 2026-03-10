

## Plan: Service Badges on Room Chips, Dynamic Floor Map & AI-Enhanced Assignment Learning

### 1. Show Service Badges Visually on Room Chips in Hotel Room Overview

**Problem**: When a manager adds towel change, linen change, RC, or extra towels via the popover, the badges (T, LC, RC, 🧺) already appear on the chip. But **bed configuration** is not shown at all on room chips. Also, manager notes are not visually indicated.

**Changes in `HotelRoomOverview.tsx`**:
- Add a small bed config indicator on room chips when set (e.g., "DB" for Double Bed, "TW" for Twin, "EX" for Extra Cot) — tiny text below the room number, similar to the existing staff name display
- Add a small note indicator (📝) on room chips when manager notes exist
- These are already partially there but bed config is missing from the chip view

---

### 2. Dynamic Hotel Floor Map (Replace Hardcoded Wings)

**Problem**: The current `HotelFloorMap.tsx` has hardcoded `WING_INFO`, `FLOOR_ORDER`, `FLOOR_LABELS`, and `FLOOR_WINGS` constants specific to Hotel Memories Budapest. This makes it unusable for other hotels and non-configurable by admins.

**Solution**: Make the floor map fully dynamic — derive floors and wings from room data, and let admins configure everything.

**Changes in `HotelFloorMap.tsx`**:
- Remove all hardcoded `WING_INFO`, `FLOOR_ORDER`, `FLOOR_LABELS`, `FLOOR_WINGS` constants
- Derive floors and wings dynamically from the `rooms` prop: `rooms.forEach(r => { floors.add(r.floor_number); wings.add(r.wing); })`
- Sort floors numerically, generate labels automatically ("Ground Floor", "1st Floor", etc.)
- Group rooms by floor then wing dynamically
- Keep the drag/rotate/save layout functionality (already saves to `hotel_floor_layouts` DB table)
- Add admin edit capabilities:
  - Assign rooms to wings (drag room chips between wing cards, or a dropdown per room)
  - Create new wing groups
  - Set wing labels/views via inline editable text
  - Save wing assignments back to the `rooms` table (`wing` column)
- Show service badges (T, LC, RC, 🧺) on room chips in the map view too
- Show room chip colors matching the overview status colors (clean/dirty/in_progress etc.)

**Room-to-wing assignment UI** (admin edit mode):
- A panel appears showing "Unassigned Rooms" (rooms with no wing)
- Admins can click a room chip and then click a wing to assign it
- Or create a new wing and drag rooms into it
- Save persists to `rooms.wing` and `rooms.floor_number`

---

### 3. Floor Map Integration with Auto-Assignment

**Problem**: The auto-assignment already reads `hotel_floor_layouts` for proximity data and uses `wingZoneMapping` for Memories Budapest. Need to ensure the dynamic map feeds the algorithm properly.

**Changes in `AutoRoomAssignment.tsx`**:
- Currently uses hardcoded zone mapping for Hotel Memories Budapest — make this **configurable via a new DB table** or a JSON field in `hotel_configurations`
- Add a `wing_zone_mapping` JSONB column to `hotel_configurations` table
- On assignment generation, read the hotel's zone mapping from `hotel_configurations` instead of hardcoding
- If no custom mapping exists, fall back to using wings directly (current behavior for non-Memories hotels)

**Changes in `roomAssignmentAlgorithm.ts`**:
- No algorithm changes needed — it already supports `wingZoneMapping` config
- The data source just changes from hardcoded to DB-driven

---

### 4. AI-Enhanced Pattern Learning (Smarter Day-by-Day)

**Problem**: Current learning stores room-pair frequencies but doesn't analyze patterns intelligently. It's purely frequency-based.

**Solution**: Add an AI analysis step that runs after each confirmed assignment, using the Lovable AI Gateway to analyze patterns and generate optimization suggestions.

**New edge function: `supabase/functions/analyze-assignment-patterns/index.ts`**:
- Triggered after assignment confirmation
- Inputs: hotel name, org slug, today's assignments, last 14 days of patterns
- Uses `google/gemini-3-flash-preview` to analyze:
  - Which room groupings the manager keeps vs. changes
  - Floor/wing preferences per housekeeper
  - Checkout distribution preferences
  - Time-of-week patterns
- Returns structured output via tool calling:
  - `suggested_zone_mapping`: recommended wing groupings
  - `staff_preferences`: per-housekeeper room affinities
  - `optimization_notes`: human-readable insights
- Stores results in a new `assignment_insights` object in localStorage (per hotel) to avoid DB migration
- On next auto-assignment, these insights are loaded and passed as additional config to the algorithm

**Changes in `AutoRoomAssignment.tsx`**:
- After `handleConfirmAssignment` succeeds, invoke `analyze-assignment-patterns` in the background (non-blocking)
- Before generating preview, load cached AI insights and apply:
  - If AI suggests zone mapping adjustments, use those
  - If AI identifies staff-room preferences, boost affinity scores for those pairs
- Show a small "🧠 AI Learning" indicator in the assignment dialog footer
- Show AI optimization notes (if any) as a collapsible section in the preview step

**Changes in `roomAssignmentAlgorithm.ts`**:
- Add `staffPreferences?: Record<string, string[]>` to `HotelAssignmentConfig` — maps staff ID to preferred room number patterns
- When scoring candidates during wing-split, add a preference bonus if the staff member has an AI-identified preference for that room/zone

---

### 5. Configurable Zone Mapping via Hotel Settings

**Problem**: Zone mapping is hardcoded in `AutoRoomAssignment.tsx` for Memories Budapest.

**Solution**: Store zone mappings in `hotel_configurations` and provide an admin UI to edit them.

**Changes**:
- In the Floor Map admin edit mode, add a "Zone Grouping" panel where admins can:
  - See current wing-to-zone mapping
  - Drag wings into zones
  - Create/rename/delete zones
  - Save to `hotel_configurations.wing_zone_mapping`
- The auto-assignment reads from this config instead of hardcoded values

---

### Files Changed Summary

| File | Changes |
|------|---------|
| `HotelRoomOverview.tsx` | Add bed config + notes indicators to room chips |
| `HotelFloorMap.tsx` | Remove hardcoded constants, dynamic floor/wing derivation, admin room-to-wing assignment, zone grouping UI, service badges on map chips |
| `AutoRoomAssignment.tsx` | Read zone mapping from DB, load AI insights, trigger analysis after confirm, show AI learning indicator |
| `roomAssignmentAlgorithm.ts` | Add `staffPreferences` to config, preference bonus in scoring |
| `supabase/functions/analyze-assignment-patterns/index.ts` | **New** — AI pattern analysis edge function |
| `hotel_configurations` table | Add `wing_zone_mapping` JSONB column (needs migration or use existing columns) |

### Migration Note

Need to check if `hotel_configurations` has a suitable JSONB column or if we should store the zone mapping in the existing `hotel_floor_layouts` table. Will use the most pragmatic approach to avoid heavy migrations.

