
## Plan: Reception Enhancements -- Room Search, Data Visibility Fix, and Team View Access

Three issues to address:

---

### 1. Fix: Room Number, Hotel, and Recorded By showing as "N/A" / "Unknown" for Reception Users

**Root Cause**: The `rooms` table RLS policy does not include the `reception` role. When reception users query `room_minibar_usage` with a join to `rooms`, Supabase returns `null` for the room data due to RLS restrictions. Similarly, `profiles` RLS doesn't let reception users see other staff profiles, so "Recorded By" shows "Unknown".

**Fix**: Add RLS policies so reception users can read rooms and profiles for their assigned hotel.

| Change | Details |
|--------|---------|
| Database migration | Add SELECT policy on `rooms` for `reception` role, scoped to same hotel. Add SELECT policy on `profiles` for `reception` role (limited to same organization). |

**Migration SQL:**
```sql
-- Allow reception to view rooms in their hotel
CREATE POLICY "Reception can view rooms in their hotel"
ON public.rooms FOR SELECT
USING (
  get_user_role(auth.uid()) = 'reception'::user_role
  AND organization_slug = get_user_organization_slug(auth.uid())
);

-- Allow reception to view profiles in their organization
CREATE POLICY "Reception can view profiles"
ON public.profiles FOR SELECT
USING (
  get_user_role(auth.uid()) = 'reception'::user_role
  AND organization_slug = get_user_organization_slug(auth.uid())
);
```

---

### 2. Add Room Number Search to Minibar Tracking View

Add a search input that lets reception users filter minibar records by room number.

| File | Change |
|------|--------|
| `src/components/dashboard/MinibarTrackingView.tsx` | Add a `searchRoom` state and a search input field next to the date picker. Filter `usageRecords` by room number before rendering. |

---

### 3. Give Reception Access to Housekeeping Team Management (Read-Only)

Reception should see the "Housekeeping" tab in the main navigation, which loads the `HousekeepingTab` component. Inside, they should only see the "Team View" sub-tab (read-only, same as what managers see in Team Management).

| File | Change |
|------|--------|
| `src/components/dashboard/Dashboard.tsx` | Add a "Housekeeping" tab to the reception tab list (lines 420-438). Add corresponding `TabsContent` for reception. Update `grid-cols-4` to `grid-cols-5`. |
| `src/components/dashboard/HousekeepingTab.tsx` | Update `canAccessHousekeeping` check (line 146) to include `reception`. When role is `reception`, show only the "Team View" (`manage`) tab in read-only mode -- hide all other tabs like Staff Management, PMS Upload, etc. |

---

### Technical Details

**Search filter in MinibarTrackingView.tsx:**
```typescript
const [searchRoom, setSearchRoom] = useState('');

// Filter records by search
const filteredRecords = usageRecords.filter(record =>
  !searchRoom || record.room_number.toLowerCase().includes(searchRoom.toLowerCase())
);
// Use filteredRecords instead of usageRecords in the table render
```

**Reception tab layout change (Dashboard.tsx line 421):**
```typescript
<TabsList className="flex w-full min-w-[400px] max-w-xl h-10 sm:h-12">
  <TabsTrigger value="tickets" ...>Tickets</TabsTrigger>
  <TabsTrigger value="rooms" ...>Rooms</TabsTrigger>
  <TabsTrigger value="housekeeping" ...>Team View</TabsTrigger>
  <TabsTrigger value="minibar" ...>Minibar</TabsTrigger>
  <TabsTrigger value="lost-found" ...>Lost & Found</TabsTrigger>
</TabsList>
```

**HousekeepingTab.tsx -- reception-only tab filtering:**
```typescript
const canAccessHousekeeping = hasManagerAccess 
  || ['housekeeping', 'reception'].includes(userRole);

// For reception, only show 'manage' (Team View) tab
const isReceptionReadOnly = userRole === 'reception';
// Filter available tabs to just ['manage'] for reception
```

---

### Summary of All Changes

| Area | Change |
|------|--------|
| Database migration | Add rooms SELECT RLS for reception; Add profiles SELECT RLS for reception |
| `src/components/dashboard/MinibarTrackingView.tsx` | Add room number search input and filtering |
| `src/components/dashboard/Dashboard.tsx` | Add "Team View" tab to reception navigation |
| `src/components/dashboard/HousekeepingTab.tsx` | Allow reception access, restrict to Team View tab only (read-only) |
