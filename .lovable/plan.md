

## Plan: Fix Sub-tab Highlighting + PMS Room Status Logic

### Issue 1: Sub-tabs Not Highlighted

**Root Cause**: `HelpTooltip` uses `<TooltipTrigger asChild>` which merges its props onto the child `TabsTrigger`. This interferes with Radix's `data-[state=active]` attribute — the tooltip trigger intercepts the ref chain and the active state CSS doesn't apply visually.

In `HousekeepingTab.tsx`, every sub-tab is wrapped: `<HelpTooltip><TabsTrigger>...</TabsTrigger></HelpTooltip>` (lines 185-199, 208-218, 263-273).

**Fix**: Move the tooltip INSIDE the `TabsTrigger` instead of wrapping it. Change the pattern from:
```
<HelpTooltip hint={...}>
  <TabsTrigger value="manage">Team View</TabsTrigger>
</HelpTooltip>
```
to:
```
<TabsTrigger value="manage">
  <HelpTooltip hint={...}>
    <span className="flex items-center gap-1">Team View</span>
  </HelpTooltip>
</TabsTrigger>
```

This preserves tooltips while keeping `TabsTrigger` as the direct child of `TabsList`, ensuring `data-[state=active]` works.

**File**: `src/components/dashboard/HousekeepingTab.tsx` — update `renderTabTrigger()` and the two inline `HelpTooltip`-wrapped triggers (supervisor and assignments tabs).

---

### Issue 2: PMS Upload — Rooms 308 and 213 Incorrectly Marked Clean

**Root Cause**: The no-show detection at line 677 checks: `Occupied=No AND Status=Untidy AND Arrival exists`. This is too broad.

Looking at the uploaded PMS file:
- **Room 308** (`71ECDBL-308`): Occupied=No, Arrival=14:30, Night/Total=1/1, Status=**Untidy**, No Departure → hits no-show → marked **clean**. But this room had a previous guest who completed their 1-night stay. The room IS dirty.
- **Room 213** (`63TRP-213SH`): Occupied=No, Arrival=14:30, Night/Total=1/3, Status=**Untidy**, No Departure → same issue.

The problem: when PMS says Status=Untidy, the room IS dirty. The current logic overrides that to "clean" for supposed no-shows. A true no-show would have Status=Clean (room prepared but unused).

**Fix**: Change the no-show condition to only apply when PMS Status is NOT Untidy/Dirty. If PMS explicitly says "Untidy" or "Dirty", always mark as dirty regardless of occupancy/arrival status:

```
Line 677-681 changes:
} else if (isOccupiedNo(occupiedVal) && arrivalVal && 
           !String(statusVal).toLowerCase().includes('untidy') && 
           !String(statusVal).toLowerCase().includes('dirty')) {
  // True no-show: unoccupied, has arrival, but room status is Clean (not untidy)
  isNoShow = true;
  newStatus = 'clean';
} else if (statusVal && (String(statusVal).toLowerCase().includes('untidy') || 
           String(statusVal).toLowerCase().includes('dirty'))) {
  // Room marked as dirty/untidy in PMS — always dirty
  newStatus = 'dirty';
  needsCleaning = true;
}
```

Additionally, rooms like 308 (Occupied=No, Arrival=14:30, Status=Untidy) should be treated as **checkout rooms** (previous guest left, new one arriving). The fix will also mark these as `is_checkout_room = true` and add them to the checkout rooms list, since they need cleaning before the new guest arrives at 14:30.

**File**: `src/components/dashboard/PMSUpload.tsx` — restructure the status determination block (lines 677-690).

---

### Summary

| File | Changes |
|------|--------|
| `src/components/dashboard/HousekeepingTab.tsx` | Move `HelpTooltip` inside `TabsTrigger` so active state CSS works |
| `src/components/dashboard/PMSUpload.tsx` | Fix no-show detection: only mark clean when PMS status is Clean, not Untidy. Treat unoccupied+untidy+arrival rooms as checkout rooms |

