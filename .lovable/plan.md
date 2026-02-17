

## Plan: Smart Learning from Manager Assignment Patterns

### How It Works

When a manager uses Auto Room Assignment, they often adjust the algorithm's suggestion by dragging rooms between housekeepers. When they click **Confirm**, the app will save the final room-to-housekeeper pairings as historical patterns. Over time, the algorithm will use this data to prefer groupings that managers have consistently chosen in the past.

### What Gets Recorded

Each confirmed assignment saves a snapshot of "room pairs" -- which rooms were assigned together to the same housekeeper. For example, if a manager consistently assigns rooms 101, 103, 105 to the same person, the algorithm learns that these rooms belong together.

### Database

**New table: `assignment_patterns`**

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| hotel | text | Hotel name (patterns are hotel-specific) |
| room_number_a | text | First room in the pair |
| room_number_b | text | Second room in the pair |
| pair_count | integer | How many times these two rooms were assigned together |
| last_seen_at | timestamp | When this pairing was last confirmed |
| organization_slug | text | Tenant isolation |
| created_at | timestamp | Record creation |

This stores room-pair affinity: every time rooms A and B end up assigned to the same housekeeper, their `pair_count` increments. The algorithm then uses high-count pairs to keep those rooms together.

### Algorithm Enhancement

The auto-assignment algorithm (`roomAssignmentAlgorithm.ts`) will receive an optional `roomAffinityMap` parameter. During the wing-splitting and rebalancing steps, when deciding which room to move or where to assign it, the algorithm will add a **affinity bonus** to keep high-affinity room pairs together with the same housekeeper.

Specifically:
- During STEP 3 (wing splitting): When a wing must be split across housekeepers, prefer keeping high-affinity pairs together
- During STEP 4 (rebalancing): Penalize moving a room away from its high-affinity partners
- During STEP 5 (count rebalancing): Same affinity penalty

### Code Changes

**1. New migration: Create `assignment_patterns` table**

```sql
CREATE TABLE assignment_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel text NOT NULL,
  room_number_a text NOT NULL,
  room_number_b text NOT NULL,
  pair_count integer NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  organization_slug text DEFAULT 'rdhotels',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hotel, room_number_a, room_number_b, organization_slug)
);

-- RLS: managers and admins can read/write
ALTER TABLE assignment_patterns ENABLE ROW LEVEL SECURITY;
-- SELECT for managers/admins
-- INSERT/UPDATE for managers/admins (upsert on confirm)
```

**2. `src/lib/roomAssignmentAlgorithm.ts`**

- Add a new exported type `RoomAffinityMap` -- a Map from `"roomA-roomB"` to affinity score (0-1)
- Add a new exported function `buildAffinityMap(patterns)` that converts raw DB rows into a normalized affinity map
- Modify `autoAssignRooms` to accept an optional `affinityMap` parameter
- In STEP 3 (wing splitting): When distributing rooms one-by-one from a split wing, check which housekeeper already has the highest affinity partner rooms, and add an affinity bonus (lower effective weight) to that housekeeper
- In STEP 4 and STEP 5 (rebalancing): Add an affinity penalty when a room move would separate high-affinity pairs -- only move if the balance improvement outweighs the affinity loss

**3. `src/components/dashboard/AutoRoomAssignment.tsx`**

- In `fetchData()`: Query `assignment_patterns` for the current hotel to build the affinity map, and pass it to `autoAssignRooms`
- In `handleConfirmAssignment()`: After inserting room_assignments, compute all room pairs from the final preview and upsert them into `assignment_patterns` (increment pair_count for existing pairs, insert new ones)

### How Affinity Scoring Works

```
affinityScore(roomA, roomB) = pair_count / max_pair_count_in_hotel
```

This normalizes scores to 0-1. A pair that's been confirmed together 20 times out of a max of 20 gets score 1.0. A pair seen 5 times gets 0.25.

During assignment, when deciding which housekeeper gets a room, the algorithm adds:
```
affinityBonus = sum of affinityScore(room, existingRoom) for all existingRooms of that housekeeper
```

This gently biases the algorithm toward historically proven groupings without overriding workload balancing.

### What This Does NOT Change

- Hotel Ottofiori and Budapest remain independent (patterns are stored per-hotel)
- The wing-based grouping remains the primary logic -- affinity is a secondary tiebreaker
- Managers can still freely drag-and-drop in the preview; those final choices feed back into learning
- No existing UI changes -- this is invisible intelligence behind the scenes

