I found two root causes to address:

1. **Housekeeping notes**: the app is still willing to fall back to the reservation/OTA note blob. That is why managers/admins and housekeepers can see complex reservation information instead of the dedicated Previo housekeeping note.
2. **Minibar approvals**: supervisor approval currently loads all uncleared minibar rows for a room, without limiting to today. So any old uncleared record can trigger the “minibar used” confirmation on a later day.

Plan:

1. **Previo housekeeping note extraction**
   - Extend the Previo sync parser to search for department-specific housekeeping notes, not just flat fields like `noteInternal`.
   - Support likely Previo structures such as nested note lists/tabs where a note has department/type/category labels like `Housekeeping`, `Reception`, `Kitchen`, etc.
   - Prefer only the housekeeping/internal/reception operational note; do **not** fall back to Booking.com/OTA reservation blobs for the room note shown in Hotel Care.

2. **Stop showing reservation blobs to managers/admins**
   - In PMS refresh, write `rooms.notes` only when the synced row contains a clean housekeeping/internal note.
   - If only `NoteOta` / reservation blob is present, clear or preserve manager-entered operational flags but do not display the reservation/pricing/commission text.
   - Keep `NoteOta` only in PMS metadata/audit fields if needed, not in the visible manager/admin/housekeeper note surface.

3. **Bed arrangement from housekeeping note only**
   - Move bed inference to use the clean housekeeping note only.
   - If the housekeeping note says “2 single beds”, “baby cot”, “two separate beds”, “beds together”, etc., auto-select the room’s bed configuration.
   - Do not treat existing default bed configuration like “Double Bed” as a special instruction unless it came from the housekeeping note for today.
   - On the housekeeper card, show a bed-arrangement special instruction only when it was inferred from the housekeeping note or manually set as an actual instruction, not just because the room has a default bed setup.

4. **Housekeeper special-instructions card cleanup**
   - Show the dedicated housekeeping note text prominently on the assignment card and start-cleaning warning dialog.
   - Remove generic/default “Bed Configuration: Double Bed” from the special-instructions warning when there is no actual special instruction.
   - Keep linen/towel operational flags, but checkout cleans will continue not to show redundant towel-change instructions.

5. **Minibar stale-data fix**
   - Change supervisor approval minibar lookup to only include minibar usage from the selected assignment date.
   - Add a self-healing cleanup before showing the popup: old uncleared rows before the selected date are marked cleared/ignored so they cannot appear as today’s consumption.
   - Keep today’s minibar records visible, but avoid yesterday’s water/nuts appearing for room 102.

6. **Validation**
   - Verify room 102 no longer shows yesterday’s water/nuts in today’s approval popup.
   - Verify a room with only a default “Double Bed” does not show it as special instructions.
   - Verify a Previo housekeeping note like `test - anu` or bed-arrangement text is passed into the housekeeper card and bed configuration is inferred only from that note.