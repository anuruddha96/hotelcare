## Root cause

Two separate issues are producing the leftover English strings shown in the screenshots:

1. **Translation resolver only keeps top-level string entries.** In `src/hooks/useTranslation.tsx`, `toStringBundle()` walks each language module and skips any value that isn't a string. But several modules store entries as nested objects, e.g. in `comprehensive-translations.ts`:

   ```ts
   'housekeeping.assignmentType': { dailyClean: 'Daily Clean', checkoutClean: 'Checkout Clean', ... },
   'housekeeping.priority':       { medium: 'Medium Priority', high: 'High Priority', ... },
   ```

   The component calls `t('housekeeping.assignmentType.checkoutClean')` and `t('housekeeping.priority.medium')`. The nested form is dropped by the resolver, so these keys only ever resolve when someone manually duplicated a flat version. Today that flat version exists only in the `en` and `hu` blocks of `useTranslation.tsx`. Every other language (`tl`, `es`, `vi`, `mn`, `az`) falls through to the English flat key, which is why housekeepers in Filipino still see `Checkout Clean`, `Daily Clean`, `Medium Priority`, `Maintenance`, etc.

2. **A handful of flat keys are missing in `tl`** (and sometimes other languages) — `rooms.dirty`, `roomCard.night`, `dashboard.attendance` (currently set to the English word "Attendance"), the room status alert badge phrases, and the entire `hr.*` + `periods.*` bundles used by `AttendanceReports.tsx` (the "Attendance Reports", "Total Days", "Total Hours", "Avg Hours/Day", "Punctual Days", "Export CSV", "This Week" etc. card seen in screenshot 3).

## Part A — Make the resolver understand nested keys

Edit `src/hooks/useTranslation.tsx` only.

Replace `toStringBundle` with a recursive flattener that produces flat dotted keys. Pseudocode:

```ts
const flattenBundle = (
  source: Record<string, unknown> | undefined,
  prefix = '',
  out: Record<string, string> = {},
) => {
  if (!source) return out;
  for (const [key, value] of Object.entries(source)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenBundle(value as Record<string, unknown>, next, out);
    } else if (typeof value === 'string') {
      out[next] = value;
    }
  }
  return out;
};
```

Use `flattenBundle` wherever `toStringBundle` was used inside `getStaticTranslationBundle()`. No other behavior changes — strings still win, and the existing flat entries continue to load. This single change immediately exposes the nested `housekeeping.assignmentType.*`, `housekeeping.priority.*`, `housekeeping.status.*`, `roomCard.*` nested groups, and any similar nested blocks in `expanded-translations.ts`, `comprehensive-translations.ts`, etc. for **all** languages.

After this, for Filipino (`tl`), the `housekeeping.priority` and `housekeeping.assignmentType` entries already defined in `comprehensive-translations.ts` (lines around 3895–3970) will start resolving, so the room-card badges in screenshots 1 & 2 will render in Filipino without any other change.

## Part B — Fill in remaining missing Filipino (and peer-language) strings

These keys are referenced by the screens in the screenshots but have no Filipino entry (or no entry beyond English) anywhere. Add them to `src/lib/comprehensive-translations.ts` in the appropriate language block (the `tl` block lives at the bottom of the file, around lines 3760–4207).

For each key, add `tl, es, vi, mn, az, hu` translations (English already canonical in `useTranslation.tsx`):

### B1. Room status badge and night badge (`AssignedRoomCard.tsx`)

- `rooms.dirty` → tl: `Marumi` (already present in `room-overview-translations.ts` under a different key, but `rooms.dirty` itself is missing in `tl`. Add it to the tl block of `highlighted-translations.ts` alongside the other language entries.)
- `rooms.maintenance`, `rooms.outOfOrder` — confirm `tl` exists; add if missing.
- `roomCard.night` → tl: `Gabi`, az: `Gecə` (es/hu/vi/mn already exist).

### B2. Filipino "Attendance" tab heading

`dashboard.attendance` and `dashboard.workStatus` are currently set to the English literal `Attendance` in the `tl` block (`comprehensive-translations.ts` lines 4075 and 4181). Change both to `Pagdalo` (or keep `Attendance` as loan word — confirm with user; default to `Pagdalo`).

### B3. Attendance Reports card (`AttendanceReports.tsx`, screenshot 3)

Add the following keys to every non-English language block (`tl, es, vi, mn, az`) — Hungarian already has them. Filipino values shown for reference:

```
hr.management        → 'Mga Ulat sa Pagdalo'
hr.totalDays         → 'Kabuuang Araw'
hr.totalHours        → 'Kabuuang Oras'
hr.avgHoursPerDay    → 'Average Oras / Araw'
hr.punctualDays      → 'Mga Maagang Araw'
hr.attendanceRecords → 'Mga Talaan ng Pagdalo'
hr.date              → 'Petsa'
hr.employee          → 'Empleyado'
hr.checkIn           → 'Pagpasok'
hr.checkOut          → 'Paglabas'
hr.hours             → 'Oras'
hr.status            → 'Status'
hr.location          → 'Lokasyon'
hr.notes             → 'Mga Note'
hr.exportCsv         → 'I-export ang CSV'
hr.noRecordsFound    → 'Walang nahanap na talaan'
periods.today        → 'Ngayong Araw'
periods.thisWeek     → 'Ngayong Linggo'
periods.thisMonth    → 'Ngayong Buwan'
periods.last30Days   → 'Huling 30 Araw'
periods.allEmployees → 'Lahat ng Empleyado'
attendance.working   → 'Nagtatrabaho'
attendance.completed → 'Tapos na'
attendance.notSignedOut → 'Hindi naka-sign out'
```

Provide equivalent translations for `es`, `vi`, `mn`, `az`.

### B4. Action buttons on the in-progress room card (screenshots 1 & 2)

These are already wired through `t('actions.*')`. The `tl` block has the strings (`actions.dndPhoto`, `actions.dirtyLinen`, `actions.minibar`, `actions.lostAndFound`, `actions.maintenance`), but `Lost & Found`, `Minibar`, `Maintenance` are loan words for `tl`. Replace with:

```
actions.lostAndFound → 'Nahanap/Nawala'
actions.minibar      → 'Minibar' (kept as brand term — keep)
actions.maintenance  → 'Pagkukumpuni'
```

Repeat for `es` ("Objetos perdidos", "Mantenimiento"), `vi`, `mn`, `az`. The "Minibar" label can stay as-is across all languages.

### B5. `housekeeping.assignmentType.*` and `housekeeping.priority.*` for `tl`

Already declared in nested form in `comprehensive-translations.ts`; after Part A they resolve automatically. Verify the Filipino values render as:

- `Checkout Clean` → `Paglilinis pagkatapos ng check-out`
- `Daily Clean`    → `Araw-araw na paglilinis`
- `Medium Priority` → `Karaniwang priyoridad`
- `High Priority`  → `Mataas na priyoridad`
- `Maintenance`    → `Pagkukumpuni`

If any of these are still English or empty in the nested `tl` block, update them in place.

## Part C — Verification

After editing:

1. Run `bunx vitest run src/hooks/useTranslation.test.tsx` to confirm the resolver change doesn't break existing tests.
2. Manually flip the LanguageSwitcher to Filipino and walk through:
   - Housekeeper "My Tasks" page → confirm Room card badges read in Filipino (Checkout/Daily Clean, Night N, Medium Priority, Dirty status badge).
   - "Attendance" bottom tab heading shows Filipino.
   - "Attendance Reports" card titles, period dropdown, stat cards, status badges all read Filipino.

## Files

**Edited**
- `src/hooks/useTranslation.tsx` — replace `toStringBundle` with recursive `flattenBundle`; add missing `hr.*`, `periods.*`, `attendance.working/completed/notSignedOut`, `rooms.dirty`, `roomCard.night`, `dashboard.attendance` flat entries to every language block.
- `src/lib/comprehensive-translations.ts` — fix `tl` values for `dashboard.attendance`, `actions.lostAndFound`, `actions.maintenance`; confirm nested `housekeeping.assignmentType` and `housekeeping.priority` entries are translated.
- `src/lib/highlighted-translations.ts` — add `rooms.dirty` (and any other missing room-status keys) for `tl` and `az`.

No DB, edge function, auth, or layout changes. No new files.

## Out of scope
- Re-translating screens that already render correctly in Filipino.
- Restructuring any other parts of the dashboard.
- Changing the language switcher itself.
