

## Plan: Improve Auto Assignment Preview - Group Rooms, Fix Legend, Add Summary

### Changes to Make

**1. Sort rooms: Checkouts first, then Daily, each group numerically**

Within each housekeeper's card, rooms will be grouped:
- Checkout rooms first (sorted by room number, lowest to highest)
- Daily rooms second (sorted by room number, lowest to highest)
- A subtle visual separator between the two groups

**2. Fix the legend and remove "Towel only" concept**

The current legend has "Towel only" (green) which is confusing. Replace with a clearer two-color system:
- Amber = Checkout room
- Blue = Daily room
- Red **T** = Towel change required
- Red **L** = Linen change required

Remove the green "Towel only" category entirely. A daily room that only needs towel change is still a blue daily room -- it just has a red **T** indicator.

**3. Add per-housekeeper summary line**

Below the housekeeper name, show a compact summary:
```
3 checkouts · 10 daily · 2T · 1L
```
This gives managers an instant count of checkout rooms, daily rooms, towel changes, and linen changes for each housekeeper.

**4. Room cleaning note**

Daily rooms requiring full room cleaning (linen change) are on-request -- the guest puts out the notice. The **L** indicator on a room chip tells the housekeeper which rooms have this request. No workflow change needed, just correct labeling.

### File to Modify

| File | Changes |
|------|---------|
| `src/components/dashboard/AutoRoomAssignment.tsx` | Update legend (remove green/towel-only), group rooms by checkout then daily with separator, add summary counts per housekeeper, make T and L uppercase red indicators |

### Technical Details

**Room sorting within each card (replaces current flat list):**
```typescript
const checkoutRooms = preview.rooms
  .filter(r => r.is_checkout_room)
  .sort((a, b) => parseInt(a.room_number) - parseInt(b.room_number));
const dailyRooms = preview.rooms
  .filter(r => !r.is_checkout_room)
  .sort((a, b) => parseInt(a.room_number) - parseInt(b.room_number));
```

**Summary counts:**
```typescript
const towelCount = preview.rooms.filter(r => r.towel_change_required).length;
const linenCount = preview.rooms.filter(r => r.linen_change_required).length;
```

**Updated legend:**
```
[amber square] Checkout  [blue square] Daily  T Towel change  L Linen change
```

**Room chip color:** All daily rooms use blue (no more green). Checkout rooms use amber. The T/L indicators appear as uppercase red letters on the chip.

