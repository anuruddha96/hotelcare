# SLNT PMS upload: two files, cleaner UI, no assignment loss

## What changes

### 1. Two labelled upload slots (SLNT only)
On the PMS Upload screen for SLNT Group, replace the single drop area with two compact slots:

```text
[ PMS file 1  (782407) ]   [ PMS file 2  (783103) ]
   choose / drop file          choose / drop file
            [ Run PMS update ]
```

- Either slot alone, or both together, is valid. One button runs them sequentially (file 1, then file 2) and shows a single combined summary (rooms processed / updated / checkout / daily, per file).
- Slots keep their filename and a clear/remove control after selection; a spinner marks which file is currently running.
- Every other hotel keeps the exact single-file drop zone it has today.

### 2. UI cleanup
- Merge the three stacked coloured banners ("Hotel Filter Active", "Data Reset Warning") into one compact inline info line showing the target property and the update mode.
- Use semantic tokens instead of the hardcoded `bg-blue-50 / bg-amber-50 / text-blue-800` colours so it matches the rest of the app and dark mode.
- Tighten spacing so the card fits without the oversized 8-unit padding drop zone.

### 3. Non-destructive upload (SLNT only)
For SLNT Group the upload becomes status-only. It will **not**:
- delete today's `room_assignments`,
- blanket-reset DND, towel/linen flags or `bed_configuration` across all units.

It will still:
- update each unit's occupancy, guest/night info, notes, checkout time,
- flip `is_checkout_room` on/off per unit as the file says (daily → checkout and back),
- set ready-to-clean on existing checkout assignments when PMS confirms departure,
- reset per-unit flags only for the units present in the file, and only where the file gives a new value.

Housekeepers keep their existing assignments and units; only the status on the card changes.

Ottofiori / RD Hotels and every other hotel keep today's reset-on-upload behaviour byte-for-byte — the new path is behind an SLNT tenant flag, and the second banner/second slot never render for them.

### 4. Warning dialog wording
The "second upload today" confirm dialog gets SLNT-specific copy: it explains that assignments are preserved and only statuses refresh, instead of the current data-loss warning.

## Technical notes
- `src/lib/tenantFeatures.ts`: add `nonDestructivePmsUpload` and `dualPmsUpload` flags, true only for the `slnt` org slug.
- `src/components/dashboard/PMSUpload.tsx`:
  - extract the reset block (lines ~420-506) behind `if (!nonDestructive)`; in non-destructive mode skip the `room_assignments` delete and the three blanket `rooms.update(...).in('hotel', hotelKeys)` calls.
  - per-row updates already run per `room.id`, so status changes still land; add explicit per-row clearing of DND / towel / linen only when the row supplies a value.
  - `processFile` gains an options arg (`{ silent, label }`) and returns its result so a new `runQueue()` can await file 1 then file 2 and aggregate into one `results` object.
  - new local state `fileSlots: [File|null, File|null]`; dropzone stays for non-SLNT, two `Input type="file"` slots for SLNT.
  - `pms_upload_summary` gets one row per file, tagged with the source filename.
- No database migration, no edge function change.

## Acceptance checks
- SLNT: upload only file 1 → 9 units updated, existing assignments still present in Team View.
- SLNT: upload both → 61 units covered, one combined summary, no duplicate work.
- SLNT: a unit that was daily yesterday and is a departure today flips to Checkout without its assignment being deleted; RTC updates on the existing checkout task.
- Ottofiori: upload behaves exactly as before (assignments for the day reset, single drop zone, same warnings).
