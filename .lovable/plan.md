

## Plan: Fix Room Card UI Issues, Missing Translations, Stray "0", and Add DND/No Service Filters

### Issue 1: Missing Translations — "ROOMCARD.MESSAGES" and "roomCard.typeMessage" placeholders

**Root Cause**: The keys `roomCard.messages`, `roomCard.typeMessage`, and `roomCard.messageSent` are not in `comprehensive-translations.ts`. The `t()` function returns the raw key, and the fallback `|| 'Messages'` works for the heading but the placeholder still shows the raw key.

**Fix**: Add `roomCard.messages`, `roomCard.typeMessage`, and `roomCard.messageSent` to all language blocks in `src/lib/comprehensive-translations.ts`.

---

### Issue 2: Stray "0" Number on Room Cards

**Root Cause**: Line 789 in `AssignedRoomCard.tsx`:
```jsx
{assignment.rooms?.guest_nights_stayed && assignment.rooms.guest_nights_stayed > 0 && (...)}
```
When `guest_nights_stayed` is `0`, JavaScript evaluates `0 && ...` as `0`, and React renders `0` as visible text.

**Fix**: Change to `{(assignment.rooms?.guest_nights_stayed ?? 0) > 0 && (...)}` to prevent falsy `0` from rendering.

---

### Issue 3: No Service Button UI Overlap with "Press & Hold to Start"

**Root Cause**: The Start button (HoldButton) at line 971 and the No Service button at line 995 are both inside a `flex flex-col` container (line 969). The HoldButton renders "Press & Hold to Start" text below itself (via its internal `holdText` prop), and the No Service button sits directly underneath, causing visual overlap.

**Fix**: 
- Add proper spacing between the Start HoldButton and the No Service button. The HoldButton already has `pb-8` wrapper on its `relative` div — but the No Service button is a sibling outside that wrapper. Wrap the Start button area with proper margin-bottom, and ensure the No Service button has clear separation.
- Remove the `pb-8` hack from the Start button wrapper and instead use proper `gap` spacing in the parent flex container.

---

### Issue 4: Header Badge Layout — Too Many Badges Cluttering the Top

**Current state**: The header area has two rows of flex-wrapped badges (status, checkout indicator, towel change, linen change, night count, priority, in-progress, assignment type). On mobile these wrap messily.

**Fix**: Reorganize badge layout:
- Row 1: Room number + Status badge + special instruction count badge (keep as-is)
- Row 2: Assignment type + key requirement badges (towel, linen, priority) in a single clean flex-wrap row with consistent small sizing
- Remove duplicate "In Progress" badge (it's already shown in the status badge)

---

### Issue 5: DND and No Service Filter Buttons for Housekeepers

**Current state**: Filter cards only show: Total, Completed, In Progress, Waiting. No way to filter DND or No Service rooms.

**Fix** in both `HousekeepingStaffView.tsx` and `MobileHousekeepingView.tsx`:
1. Expand `statusFilter` type to include `'no_service'` and `'dnd'`
2. Count DND rooms (where `is_dnd === true`) and No Service rooms (where notes contain `[NO_SERVICE]`) from the full assignment list
3. Add two additional small filter cards below the main 4: "🚫 No Service" (gray) and "🔕 DND" (orange) — only show when count > 0
4. When filtering by `no_service`, show assignments where notes include `[NO_SERVICE]`; when filtering by `dnd`, show assignments where `is_dnd === true`
5. Update the fetch query to NOT filter by status when these special filters are active (since no-service rooms are marked as 'completed')

---

### Summary of Changes

| File | Changes |
|------|---------|
| `src/lib/comprehensive-translations.ts` | Add `roomCard.messages`, `roomCard.typeMessage`, `roomCard.messageSent` in all languages |
| `src/components/dashboard/AssignedRoomCard.tsx` | Fix `guest_nights_stayed` falsy 0 render; fix Start/No Service button spacing; clean up duplicate In Progress badge; reorganize badge layout |
| `src/components/dashboard/HousekeepingStaffView.tsx` | Add DND and No Service filter cards; expand statusFilter type; compute DND/NS counts |
| `src/components/dashboard/MobileHousekeepingView.tsx` | Same DND and No Service filter cards for mobile view |

