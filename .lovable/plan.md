

## Plan: Enhance Team View with Room Overview, Auto-Assign Justification, and Public Area Assignments

This is a significant feature enhancement with 3 major parts. Here is the breakdown:

---

### Part 1: Room Status Overview in Team View

Add a visual "Hotel Room Overview" section at the top of the Team View tab that shows all hotel rooms as small compact icons, split into **Checkout** and **Daily** sections.

**What supervisors will see:**
- All rooms displayed as small colored badges/chips grouped by floor
- Rooms split into two sections: "Checkout Rooms" and "Daily Rooms"  
- Each room chip shows the room number and is color-coded by status:
  - Green = Clean, Orange = Dirty, Blue = In Progress, Red = Out of Order
  - Purple border = DND (Do Not Disturb)
  - Gray with strikethrough = No Show
- Hovering/tapping a room chip shows the assigned housekeeper's name
- Rooms with active assignments show the housekeeper's name/initials beneath
- Desktop: rooms flow horizontally in a grid; Mobile: compact scrollable view

**New Component:** `HotelRoomOverview.tsx`
- Fetches all rooms for the manager's hotel
- Fetches today's assignments to map rooms to housekeepers
- Groups rooms by floor, then splits by checkout vs daily
- Shows DND rooms with a special indicator

---

### Part 2: Auto-Assign Justification Display

Enhance the existing Auto-Assign preview (Step 2) to explain **why** each housekeeper got their specific assignment. This does NOT change the algorithm -- it adds transparency.

**What supervisors will see in the preview step:**
- A "Fairness Summary" card showing:
  - Average workload weight per housekeeper
  - Weight deviation percentage (how balanced the distribution is)
  - Checkout room distribution (e.g., "3 CO each" or "3-4 CO range")
- Per-housekeeper justification text, e.g.:
  - "3 checkout rooms (45 min each) + 4 daily rooms (15-25 min each)"
  - "Floor grouping: Floors 2, 3 -- minimizes walking distance"
  - "Workload: 5.2 weight (avg: 5.0) -- within fair range"
  - Time estimate with color indicator

**Changes to:** `AutoRoomAssignment.tsx` -- add fairness summary card and per-staff justification text in the preview step. No algorithm changes.

---

### Part 3: Public Area Assignments

Allow managers/admins to assign public area cleaning tasks to housekeepers through the auto-assign flow and a standalone option.

**Database:** Use the existing `general_tasks` table which already has:
- `task_name`, `task_description`, `task_type`, `assigned_to`, `assigned_by`
- `hotel`, `status`, `priority`, `estimated_duration`
- Proper RLS policies for managers to create and staff to view

**Predefined public area types:**
- Lobby, Reception, Back Office, Kitchen
- Guest Toilets (Men), Guest Toilets (Women)  
- Hotel Common Areas, Stairways, Corridors
- Breakfast Room, Dining Area

**Manager UI (in Team View):**
- New "Public Areas" button next to Auto Assign
- Opens a dialog where managers can:
  1. Select a housekeeper from dropdown
  2. Pick one or more public areas from a checklist
  3. Add optional notes/instructions
  4. Set priority
- Saves as `general_tasks` with `task_type` = the area type (e.g., `lobby_cleaning`)

**Housekeeper UI:**
- New section in both desktop (`HousekeepingStaffView`) and mobile (`MobileHousekeepingView`) views
- Shows "Public Area Tasks" below room assignments
- Each task card shows: area name, description, status, priority
- Housekeepers can start/complete tasks similar to room assignments

**Team View integration:**
- When supervisor clicks on a housekeeper card, also show their public area tasks
- The Room Overview section remains focused on rooms only

---

### Files to Create

| File | Purpose |
|------|---------|
| `src/components/dashboard/HotelRoomOverview.tsx` | Room status overview grid component |
| `src/components/dashboard/PublicAreaAssignment.tsx` | Dialog for assigning public area tasks |
| `src/components/dashboard/PublicAreaTaskCard.tsx` | Task card for housekeeper view |

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/dashboard/HousekeepingManagerView.tsx` | Add Room Overview section, Public Areas button, show public tasks in staff detail |
| `src/components/dashboard/AutoRoomAssignment.tsx` | Add fairness summary and per-staff justification in preview step |
| `src/components/dashboard/HousekeepingStaffView.tsx` | Add Public Area Tasks section below room assignments |
| `src/components/dashboard/MobileHousekeepingView.tsx` | Add Public Area Tasks section for mobile |

### No Changes To

| File | Reason |
|------|--------|
| `src/lib/roomAssignmentAlgorithm.ts` | Algorithm is working correctly -- we only add display justification |
| `src/components/dashboard/RoomAssignmentDialog.tsx` | Manual assignment stays exactly as-is |
| `src/components/dashboard/AssignedRoomCard.tsx` | Existing room cards unchanged |
| Database schema | Using existing `general_tasks` table for public areas |

---

### Technical Details

**HotelRoomOverview component structure:**
```text
+------------------------------------------+
| Hotel Room Overview                       |
+------------------------------------------+
| Checkout Rooms (8)                        |
| [F1] 102 103 104  [F2] 201 202 204      |
|      Ana  Ana  -       Nat  Nat  Qua    |
| [F3] 304 305                              |
|      Qua  -                               |
+------------------------------------------+
| Daily Rooms (13)        DND: 105, 402... |
| [F1] 101 105(DND)  [F2] 203 205         |
|      Ana  -             Nat  Nat         |
| ...                                       |
+------------------------------------------+
```

**Fairness justification in auto-assign preview:**
```text
+------------------------------------------+
| Fairness Summary                          |
| Avg workload: 5.2 | Deviation: +/-3%     |
| Checkout split: 3-3-2 (even)             |
+------------------------------------------+
| Ana (8 rooms)                             |
| 3 CO + 5 Daily | Floors: 1, 2            |
| Work: 4h 15m + 30m break = 4h 45m        |
| Weight: 5.3 (avg: 5.2) -- Fair           |
+------------------------------------------+
```

**Public area task flow:**
```text
Manager assigns --> general_tasks row created
                    --> task_type = 'lobby_cleaning'
                    --> status = 'assigned'
Housekeeper views --> sees in Public Area section
Housekeeper starts --> status = 'in_progress'  
Housekeeper completes --> status = 'completed'
Supervisor sees --> in team view staff detail
```

