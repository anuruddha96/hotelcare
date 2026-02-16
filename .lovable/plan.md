
## Plan: Fix RLS Policy Blocking Manager PMS Uploads + Cleaning Cycle

### Root Cause

The `rooms` table UPDATE RLS policy compares `profiles.assigned_hotel = hotel` directly. Managers have `assigned_hotel = 'memories-budapest'` (hotel_id) but the rooms table stores `hotel = 'Hotel Memories Budapest'` (hotel_name). This comparison always fails for managers.

Supabase silently ignores RLS-blocked updates (returns no error, updates 0 rows), so the upload code reports "71 rooms updated" but nothing actually changes in the database.

This causes ALL three reported issues:
1. Room 002 DND not clearing (batch reset blocked by RLS)
2. Every daily room showing stale towel change "T" (per-room updates blocked)
3. The corrected cleaning cycle logic never saves to the database

### Fix

**1. SQL Migration: Update rooms UPDATE RLS policy**

Add a `hotel_configurations` join to the UPDATE policy so managers whose `assigned_hotel` matches either `hotel_id` or `hotel_name` can update rooms. This mirrors what the SELECT policy already does.

Current policy (broken for managers):
```
assigned_hotel = hotel
```

Fixed policy:
```
assigned_hotel = hotel 
OR EXISTS (
  SELECT 1 FROM hotel_configurations hc
  WHERE (assigned_hotel = hc.hotel_id OR assigned_hotel = hc.hotel_name)
    AND (rooms.hotel = hc.hotel_id OR rooms.hotel = hc.hotel_name)
)
```

**2. Code: Add update verification in PMSUpload.tsx**

After the batch resets, verify at least one row was affected by doing a quick check query. Log a warning if 0 rows were updated (helps catch silent RLS failures in the future).

Also add a `count` check on per-room updates to detect silent failures.

**3. Code: Cleaning cycle is already correct**

The last edit already fixed the cycle (Day 3=T, Day 5=T, Day 7=RC, etc.). Once the RLS policy allows manager writes, the correct values will save to the database.

### Files to Change

| File | Changes |
|------|---------|
| New migration SQL | Drop and recreate the rooms UPDATE policy with hotel_configurations join |
| `src/components/dashboard/PMSUpload.tsx` | Add verification after batch resets to detect silent RLS failures; add count-based update check for per-room writes |

### Technical Detail: Migration SQL

```sql
DROP POLICY IF EXISTS "Secure room updates" ON rooms;

CREATE POLICY "Secure room updates" ON rooms
FOR UPDATE USING (
  is_super_admin(auth.uid()) 
  OR (
    organization_slug = get_user_organization_slug(auth.uid()) 
    AND (
      get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'top_management'::user_role])
      OR (SELECT profiles.assigned_hotel FROM profiles WHERE profiles.id = auth.uid()) = hotel
      OR EXISTS (
        SELECT 1 FROM hotel_configurations hc
        WHERE (
          (SELECT p.assigned_hotel FROM profiles p WHERE p.id = auth.uid()) = hc.hotel_id
          OR (SELECT p.assigned_hotel FROM profiles p WHERE p.id = auth.uid()) = hc.hotel_name
        )
        AND (rooms.hotel = hc.hotel_id OR rooms.hotel = hc.hotel_name)
      )
    )
  )
);
```

### Technical Detail: Update Verification

After each batch reset, add a verification query:

```typescript
// After DND reset
const { count: dndCount } = await supabase
  .from('rooms')
  .select('id', { count: 'exact', head: true })
  .eq('hotel', hotelNameForFilter)
  .eq('is_dnd', true);

if (dndCount && dndCount > 0) {
  console.error(`DND reset FAILED - ${dndCount} rooms still have DND=true. Likely RLS issue.`);
}
```

### What This Fixes

Once the RLS policy is updated:
- Batch reset clears DND, towel change, checkout flags for all rooms before processing
- Per-room updates save the correct cleaning cycle (T on day 3/5, RC on day 7, etc.)
- Rooms on day 1-2 will have no T/RC badge
- Room 002 DND will clear on next upload
- All managers can perform PMS uploads successfully
