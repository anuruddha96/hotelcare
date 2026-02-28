

## Plan: Improve Room Chip Dialog UX

### File: `src/components/dashboard/HotelRoomOverview.tsx`

**1. Fix scrolling — dialog content not scrollable (line 634)**
- Change `<DialogContent className="max-w-sm">` to `<DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto">`

**2. Rename "Special Instructions" → "Towel & Linen Change" (line 744)**
- Change label from `Special Instructions` to `Towel & Linen Change`

**3. Rename "Room Status" → "Change Room Status" (line 648)**
- Change label from `Room Status` to `Change Room Status`
- Add a helper text below: `"Manually update this room's cleaning status"`

**4. Improve dialog UI for better usability**
- Add a colored status badge in the dialog header showing current room status (clean/dirty/in_progress) so users know at a glance
- Add icons to section headers (e.g., 🔄 for status, 🧺 for towel/linen, 📝 for notes, ⚡ for quick actions, ⚙️ for settings)
- Make towel/linen toggle buttons more descriptive: `"🔄 Towel Change: Required"` / `"🔄 Towel Change: Not Required"` instead of just `ON/OFF`
- Similarly for linen: `"🛏️ Linen Change: Required"` / `"🛏️ Linen Change: Not Required"`

### Summary of Changes

| Change | Location | Detail |
|--------|----------|--------|
| Fix scrolling | Line 634 | Add `max-h-[85vh] overflow-y-auto` to DialogContent |
| Rename section | Line 744 | "Special Instructions" → "Towel & Linen Change" |
| Rename section | Line 648 | "Room Status" → "Change Room Status" + helper text |
| Better toggle labels | Lines 773, 802 | ON/OFF → Required/Not Required |
| Status badge in header | Line 636 | Show current status visually |
| Section icons | Multiple | Add icons to all section headers |

