

## Plan: Fix Top Tab Active Styling, Missing Translations (Legend, Public Areas, AutoAssign)

### Problems

1. **Top-level tabs** (Tickets, Rooms, Housekeeping, Attendance) — the active state from `tabs.tsx` uses `bg-primary/10` but the Dashboard's TabsTriggers override with `data-[state=active]:shadow-md` and `data-[state=active]:font-bold`, which competes. The `bg-primary/10` is too subtle on the muted TabsList background. Need a stronger active indicator.

2. **Legend labels** in `HotelRoomOverview.tsx` (lines 932-946) — all 15 legend items ("Approved/Clean", "Dirty/Assigned", "In Progress", etc.) are hardcoded English.

3. **PublicAreaAssignment.tsx** — entire dialog is hardcoded English: title, labels, area names/descriptions, priority options, buttons.

4. **AutoRoomAssignment.tsx** — missing Hungarian translations for `autoAssign.checkoutRooms`, `autoAssign.dailyRooms`, `autoAssign.break`. Spanish, Vietnamese, and Mongolian are missing ALL autoAssign keys. Print template has hardcoded "Checkout"/"Daily" (line 758).

### Changes

#### 1. Stronger active tab styling — `src/components/ui/tabs.tsx`
Change active state to use solid primary background with white text instead of the subtle tint:
```
data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm
```
Remove the `border-b-2 border-primary` since the solid background is sufficient.

#### 2. Translate legend — `src/components/dashboard/HotelRoomOverview.tsx`
Replace all 15 hardcoded legend label strings with `t()` calls. Also translate the `hint` strings that aren't using `UI_HINTS`. Add ~15 new keys to `comprehensive-translations.ts`.

#### 3. Translate PublicAreaAssignment — `src/components/dashboard/PublicAreaAssignment.tsx`
- Add `useTranslation` hook
- Replace dialog title, labels, placeholder, priority options, buttons with `t()` calls
- Add translation keys for area names and descriptions (or keep area names as-is since they're proper nouns — but translate labels/buttons)
- Add ~12 new keys to `comprehensive-translations.ts`

#### 4. Add missing autoAssign translations — `src/lib/pms-translations.ts`
- Hungarian: add `autoAssign.checkoutRooms`, `autoAssign.dailyRooms`, `autoAssign.break` and other missing keys
- Spanish: add ALL ~80 autoAssign keys
- Vietnamese: add ALL ~80 autoAssign keys  
- Mongolian: add ALL ~80 autoAssign keys (check if mn section exists in pms-translations)

#### 5. Fix print template — `src/components/dashboard/AutoRoomAssignment.tsx`
Line 758: Replace hardcoded `'Checkout' : 'Daily'` with `t('autoAssign.checkout') : t('autoAssign.daily')`

#### 6. Add legend + public area translation keys — `src/lib/comprehensive-translations.ts`
New keys for all 5 languages:
- `legend.approvedClean`, `legend.dirtyAssigned`, `legend.inProgress`, `legend.pendingApproval`, `legend.overdue`, `legend.outOfOrder`, `legend.dnd`, `legend.noShow`, `legend.earlyCheckout`, `legend.towelChange`, `legend.bedLinenChange`, `legend.roomCleaning`, `legend.extraTowels`, `legend.readyToClean`, `legend.approved`, `legend.hideLegend`, `legend.showLegend`
- `publicArea.title`, `publicArea.selectHousekeeper`, `publicArea.choosePlaceholder`, `publicArea.selectAreas`, `publicArea.selected`, `publicArea.priority`, `publicArea.normal`, `publicArea.high`, `publicArea.urgent`, `publicArea.notes`, `publicArea.notesPlaceholder`, `publicArea.assign`, `publicArea.assigning`

### Files Changed

| File | Changes |
|------|---------|
| `src/components/ui/tabs.tsx` | Solid primary bg for active state |
| `src/components/dashboard/HotelRoomOverview.tsx` | Translate 15 legend labels + show/hide text |
| `src/components/dashboard/PublicAreaAssignment.tsx` | Add useTranslation, translate all UI strings |
| `src/components/dashboard/AutoRoomAssignment.tsx` | Fix print template hardcoded type labels |
| `src/lib/comprehensive-translations.ts` | Add legend + public area keys × 5 languages |
| `src/lib/pms-translations.ts` | Add autoAssign keys for hu (missing 3), es (~80), vi (~80), mn (~80) |

