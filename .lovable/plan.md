

## Plan: Fix RTC Badge Logic and Add Approved Tick Emoji

### Changes to `src/components/dashboard/HotelRoomOverview.tsx`

#### 1. Show RTC only on checkout rooms that are NOT yet cleaned/approved

Currently (line 353), the RTC badge shows on ANY room with `ready_to_clean === true`. This needs to be conditional:
- Only show on **checkout rooms** (`is_checkout_room` or `assignment_type === 'checkout_cleaning'`)
- Hide when the room is already **completed and supervisor-approved** (since the room is done, RTC is irrelevant)

#### 2. Add a checkmark emoji for supervisor-approved rooms

When `assignment.status === 'completed'` AND `assignment.supervisor_approved === true`, show a **tick emoji** on the room chip to indicate the room has been fully approved by the manager. This replaces the green color with a visible confirmation mark.

#### 3. Update the legend

- Remove "Ready to Clean" from the legend (or clarify it only applies to checkout rooms)
- Add an "Approved" legend entry with the tick emoji

### Technical Details

**RTC badge condition change (line 353):**
```typescript
// Before:
{assignment?.ready_to_clean && ( <RTC badge> )}

// After: Only show on checkout rooms that aren't completed+approved
{assignment?.ready_to_clean && 
 (room.is_checkout_room || assignment?.assignment_type === 'checkout_cleaning') &&
 !(assignment?.status === 'completed' && assignment?.supervisor_approved) && (
  <RTC badge>
)}
```

**Approved tick emoji (new, after line 367):**
```typescript
{assignmentStatus === 'completed' && assignment?.supervisor_approved && (
  <span className="ml-0.5 text-[9px]">✅</span>
)}
```

**Legend update (lines 551-573):**
- Change "Ready to Clean" entry to clarify it's for checkout rooms only: label becomes "Ready to Clean (Checkout)"
- Add new legend entry: `{ label: 'Approved', text: '✅' }` with the tick emoji

### Summary

| What | Change |
|------|--------|
| RTC badge | Only on checkout rooms, hidden once approved |
| Approved rooms | Show ✅ emoji on room chip |
| Legend | Add "Approved ✅", clarify "RTC" is checkout-only |

