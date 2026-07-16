## Goal
Turn the raw HTML/PMS "notes" blob into a clean, manager-friendly summary that shows only what housekeeping/reception actually need: **bed arrangement** and **special guest requests**. Hide all the noise (commission, VCC, cancellation policy, partner XML metadata, HTML tags, etc.).

## What the raw note contains today
Example fields Previo dumps into `Note`:
- Recepce line (VCC price, reservation code, guest name, "Breakfast in")
- Systém block: Partner, Total price, Price per room, Commission, Created, Meals, Partner's room name, Note, Comment, Payment
- Booking.com "Special requests" (smoking preference, bed preference, late arrival, etc.)
- Children / extra bed / cot policy
- Cancellation policy
- Payment / VCC instructions

Of these, managers/housekeepers only need:
1. **Bed arrangement** (double / twin / twin separated / extra cot / baby cot)
2. **Special guest requests** (smoking preference, late arrival, high floor, quiet room, allergies, early check-in, etc.)
3. Optional light context: meals (breakfast yes/no), guests count, cot count

Everything else (VCC, commission, cancellation, partner XML, "You have received a virtual credit card…") is finance/reception noise and should be stripped from the housekeeping note.

## Implementation plan

1. **New parser: `src/lib/pmsNoteParser.ts`**
   - Input: raw note string (HTML-encoded, may contain `&lt;br&gt;`, `&amp;039;`, `<span>` blocks, "Systém - …" segments).
   - Steps:
     a. HTML-decode entities (`&lt;`, `&gt;`, `&amp;`, `&039;`, `&nbsp;`).
     b. Strip all HTML tags.
     c. Split into labelled segments using the `Label value` pattern Previo emits (Partner, Total price, Commission, Meals, Partner's room name, Note, Comment, Payment, etc.).
     d. Extract only whitelisted fields:
        - `specialRequests` (from the Booking.com "Special requests…" substring, up to next known section)
        - `mealsIncluded` (breakfast / half-board / none)
        - `bedPreferenceRaw` (any bed hint inside Special requests / Partner's room name / Note)
        - `extraCot`, `babyCot`, `guestsMax` (from Children and Extra Bed Policy text)
        - `smokingPreference`
        - `arrivalTimeHint` (e.g. "late arrival", "early check-in")
     e. Feed `bedPreferenceRaw` + partner room name through the existing `inferBedConfigFromNote` to get a canonical bed arrangement (`Double Bed`, `Twin Beds`, `Twin Beds Separated`, `Extra Cot Added`, `Baby Bed`).
     f. Drop everything else (VCC, commission, cancellation policy, created timestamp, price, "Recepce" line, RDO reservation code, payment instructions).
   - Output shape:
     ```ts
     {
       bedArrangement: string | null,          // canonical
       specialRequests: string[],              // short bullet strings
       meals: 'Breakfast' | 'Half board' | 'Full board' | null,
       smoking: 'Non-smoking' | 'Smoking' | null,
       extras: { babyCotMax?: number, guestsMax?: number, extraBeds?: number },
       raw: string                             // kept for debug/tooltip
     }
     ```

2. **Unit tests: `src/lib/pmsNoteParser.test.ts`**
   - Cover the exact sample the user pasted (must return: no bed arrangement stated, Non-smoking, Breakfast, guestsMax 2, cotsMax 1, no VCC/commission text leaking).
   - Cover twin/twin-separated/extra cot/baby cot variants.
   - Cover plain empty / unstructured note (returns nulls, `raw` unchanged, no crash).

3. **Render the structured note in the UI**
   - Add a small presentational component `src/components/pms/StructuredRoomNote.tsx` that takes the raw note and renders:
     - Bed arrangement chip (if detected)
     - "Special requests" list (only the bulletable requests)
     - Meals + smoking as small tags
     - Collapsible "Show original PMS note" for the raw text (so nothing is lost)
   - Wire it in where the pencil/note icon currently shows the raw string on the Checkout/Daily room chips (the same place shown in the screenshot). Only change the presentation — do not change data storage, PMS sync logic, or note persistence.

4. **Keep raw notes intact in the database**
   - Parsing is display-only. The `rooms.notes` (and PMS-derived note field) still stores the original string so reception/finance workflows and existing bed-config inference keep working.

5. **Verification**
   - Run vitest for the new parser tests.
   - Visually confirm on the current preview that the sample note renders as:
     - Meals: Breakfast
     - Smoking: Non-smoking
     - Max guests: 2, Max cots: 1
     - Special requests: (empty in this sample — Booking.com only sent "smoking preference Non-Smoking")
     - No VCC / commission / cancellation text visible
   - Confirm no regression on rooms whose note is already clean free text.

## Out of scope
- PMS sync/API changes (separate ongoing issue).
- Persisting the structured fields to the DB (can be a later step if managers want to filter/report on them).
