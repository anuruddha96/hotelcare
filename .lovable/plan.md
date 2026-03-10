

## Plan: Room Service Terminology, Hover Popover Enhancements, Housekeeper Card Improvements & AI Translation

### Summary of Changes

This plan addresses 6 interconnected improvements across the Hotel Room Overview, housekeeper room cards, and manager workflow.

---

### 1. Fix Terminology: LC = Linen Change, RC = Room Cleaning

**Problem**: Currently `linen_change_required` badge shows "RC" on room chips — but RC should mean Room Cleaning (full clean). Linen Change should be "LC".

**Changes**:
- **`HotelRoomOverview.tsx`**: Change the badge text from `RC` to `LC` for `linen_change_required` on room chips (line 391) and in the legend (line 811)
- **`ui-hints.ts`**: Update the tooltip text for the linen change legend item
- No DB changes needed — `linen_change_required` remains the field for bed linen only

---

### 2. New Room Services: "Collect Extra Towels" & "Room Cleaning" (RC)

**Problem**: No way to flag "collect extra towels" or "room needs full cleaning" as separate toggles.

**Approach**: Store these as structured flags in the existing `notes` field using a parseable prefix pattern (e.g., `[COLLECT_EXTRA_TOWELS]`, `[ROOM_CLEANING]`). This avoids needing DB migrations while keeping the data queryable.

**Helper functions** (new file `src/lib/room-service-flags.ts`):
```typescript
export function parseRoomFlags(notes: string | null) {
  return {
    collectExtraTowels: notes?.includes('[COLLECT_EXTRA_TOWELS]') ?? false,
    roomCleaning: notes?.includes('[ROOM_CLEANING]') ?? false,
    cleanNotes: (notes || '')
      .replace('[COLLECT_EXTRA_TOWELS]', '')
      .replace('[ROOM_CLEANING]', '')
      .trim()
  };
}
export function buildRoomNotes(flags: {...}, freeText: string): string { ... }
```

**Room chip badges**: Add `RC` badge (green) for room cleaning flag, and a towel icon for collect extra towels.

---

### 3. Enhanced Hover Popover (HotelRoomOverview.tsx)

**Current**: Popover has Towel toggle, Linen toggle, Switch Type, Mark Clean/Dirty, Notes, Settings.

**Add to popover**:
- **Room Cleaning (RC)** toggle — full room clean flag
- **Collect Extra Towels** button — sets flag, shows prominently to housekeeper
- **Bed Configuration** quick-select dropdown (Twin, Double, King, etc.)
- **Ready to Clean** button for checkout rooms — make it visually distinct (larger, green, top of actions) to avoid confusion with Mark Clean/Dirty
- **Manager warning**: When toggling any service on a room that's already `completed`, show a confirmation toast: "This room was already cleaned. The housekeeper will need to be informed separately."

**UI layout for popover** (cleaner sections):
```text
┌──────────────────────────────┐
│ Room 406          [CLEAN]    │
├──────── Services ────────────┤
│ 🔄 Towel Change    [toggle]  │
│ 🛏️ Linen Change    [toggle]  │
│ 🧹 Room Cleaning   [toggle]  │
│ 🧺 Collect Towels  [toggle]  │
├──────── Bed Config ──────────┤
│ [Twin ▾]                     │
├──────── Status ──────────────┤
│ ✅ Ready to Clean  (checkout)│
│ ⇄ Switch to Daily           │
│ Mark as Dirty/Clean          │
├──────── Notes ───────────────┤
│ [__________] auto-save       │
│ ⚙️ Room Settings...          │
└──────────────────────────────┘
```

---

### 4. Housekeeper Room Cards — Cleaner UI with Service Banners

**Files**: `AssignedRoomCard.tsx` + `MobileHousekeepingCard.tsx`

**Changes**:
- Show service instructions at the **top** of the card as compact, color-coded banners:
  - 🔄 **Towel Change** (yellow)
  - 🛏️ **Linen Change** (purple) — labeled "Bed Linen Change" clearly
  - 🧹 **Room Cleaning** (blue) — new RC flag
  - 🧺 **Collect Extra Towels** (orange) — new, prominent alert
- Parse `notes` field for structured flags and display clean notes separately
- Manager notes shown in amber banner with **translate button**
- Remove redundant room details (hotel name, floor shown as compact inline instead of large blocks) to keep cards fitting the page
- Tighter padding and spacing for mobile

---

### 5. AI-Powered Note Translation for Housekeepers

**Problem**: Managers write notes in Hungarian/English, housekeepers speak Mongolian/Spanish. Currently `translateText()` uses a static dictionary which is very limited.

**Solution**: Add an AI translate button on the housekeeper's room card that calls a Supabase edge function to translate the manager's note into the housekeeper's preferred language.

**New edge function**: `supabase/functions/translate-note/index.ts`
- Uses Lovable AI Gateway (`google/gemini-3-flash-preview`)
- Input: `{ text: string, targetLanguage: string }`
- Output: `{ translatedText: string }`
- Non-streaming (simple invoke)

**UI in housekeeper card**:
- Below the manager notes banner, show a small "🌐 Translate" button
- On click, calls the edge function and replaces the note text with the translation
- Shows a loading spinner during translation
- Caches translations locally to avoid repeated API calls

---

### 6. Checkout Room "Ready to Clean" — Clearer UX

**Problem**: "Mark as Clean" and "Ready to Clean" are visually similar and confuse managers.

**Changes in popover and dialog**:
- For checkout rooms not yet ready: Show "Ready to Clean" as a **large, prominent green button** at the top of the popover, before any other actions
- Hide "Mark as Clean" for checkout rooms that aren't ready yet (cleaning can't happen before guest leaves)
- After marking ready, show "Ready ✅" as a disabled badge instead of the button
- In the legend, keep RTC with clearer tooltip: "Guest checked out — room is ready for housekeeper to start cleaning"

---

### Files Changed Summary

| File | Changes |
|------|---------|
| `src/lib/room-service-flags.ts` | **New** — parse/build structured flags from notes |
| `src/components/dashboard/HotelRoomOverview.tsx` | Fix LC/RC terminology, add new toggles to popover, bed config dropdown, improved checkout UX, manager warning for completed rooms |
| `src/components/dashboard/AssignedRoomCard.tsx` | Cleaner service banners at top, AI translate button for notes, tighter layout |
| `src/components/dashboard/MobileHousekeepingCard.tsx` | Same service banner improvements, translate button, compact layout |
| `src/lib/ui-hints.ts` | Update tooltip text for LC badge |
| `src/hooks/useTranslation.tsx` | Add translation keys for new services (collect extra towels, room cleaning, translate button) |
| `supabase/functions/translate-note/index.ts` | **New** — AI translation edge function using Lovable AI Gateway |

No database migrations needed — new flags stored in existing `notes` field with structured parsing.

