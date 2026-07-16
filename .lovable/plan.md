# Fix bed-configuration inference from PMS notes

## Root cause

`src/lib/pmsRefresh.ts` calls `inferBedConfigFromNote(row.Note)` with the **full raw Previo note** — which includes Booking.com policy boilerplate like:

- "You **haven't added any extra beds**." → matches keyword `extra bed` → sets **Extra Cot Added**
- "The maximum number of cots is 1." → matches `cot` → could set **Baby Bed**
- "Deluxe Double or Twin Room" (partner category label) → matches `double` / `twin`

`bedConfigInference.ts` does naive `haystack.includes(keyword)` with no word boundaries and no negation handling, so any occurrence — even inside a negation or a room-category label — flips `rooms.bed_configuration`.

Confirmed on live DB: rooms 103, 105, 201, 202, 304, 406 (Hotel Ottofiori) all have `bed_configuration = "Extra Cot Added"` written by the algorithm with `pms_metadata.inferredBedConfig.keyword = "extra bed"`, but there is no real guest request.

## Fix (all algorithmic — no AI)

### 1. `src/lib/bedConfigInference.ts`
- Match keywords with **word boundaries** (`\b<kw>\b`) instead of substring `includes`.
- Reject matches whose preceding ~30 chars contain a **negation** (`no`, `not`, `without`, `haven't`, `hasn't`, `don't`, `doesn't`, `any` after `haven't added`, `0 `, `zero`).
- Reject matches inside a **capacity/policy phrase** window: `maximum number of`, `policy`, `included`, `commission`, `you haven't`, `extra bed policy`.
- Keep the existing priority order (separated > extra cot > baby bed > twin > single > double).

### 2. `src/lib/pmsRefresh.ts` (line ~413)
Replace `inferBedConfigFromNote(row.Note ...)` with a call that **only inspects the guest special-requests slice**, reusing the existing `parsePmsNote` logic:

```ts
import { parsePmsNote } from "@/lib/pmsNoteParser";
const parsed = parsePmsNote(row.Note ? String(row.Note) : null);
const inferredBed = reservationDataAuthoritative && parsed.bedArrangement
  ? { value: parsed.bedArrangement, matchedKeyword: "special-requests" }
  : null;
```

This reuses the parser that already:
- extracts only the `Special requests…` segment,
- ignores the "Double or Twin" partner room-name ambiguity,
- drops finance / policy noise.

### 3. Tests
Extend `bedConfigInference.test.ts` with negative cases that currently regress:

- `"You haven't added any extra beds. The maximum number of cots is 1."` → `null`
- `"Children and Extra Bed Policy: children of any age are allowed."` → `null`
- `"The maximum number of guests is 2."` → `null`
- `"Deluxe Double or Twin Room"` → `null`

Extend `pmsNoteParser.test.ts` with the full Booking.com sample already in the file, asserting `bedArrangement === null` when the only "extra bed" mention is in the policy block.

### 4. Data repair (one-off SQL migration)
For every room whose `pms_metadata->'inferredBedConfig'->>'keyword'` is set AND whose current raw note (or absence of note) no longer justifies it under the new algorithm:

```sql
UPDATE rooms
SET bed_configuration = NULL,
    pms_metadata = pms_metadata - 'inferredBedConfig'
WHERE pms_metadata ? 'inferredBedConfig'
  AND pms_metadata->'inferredBedConfig'->>'keyword' IN ('extra bed','cot','twin','double','king','queen');
```

Scoped only to algorithm-written values (rows carrying the `inferredBedConfig` marker) — manager-set bed configs never had that marker and are untouched.

### 5. Verification
- `bun run test src/lib/bedConfigInference.test.ts src/lib/pmsNoteParser.test.ts`.
- Query the same 6 Ottofiori rooms — `bed_configuration` should be `NULL`.
- Trigger a PMS refresh from the client; confirm the same rooms stay `NULL` (no note has a real special-request bed phrase).
- Confirm rooms with a **real** request (e.g. "Special requests: twin beds separated") still get the correct value on next refresh.

## Files changed
- `src/lib/bedConfigInference.ts` — word-boundary + negation guards
- `src/lib/pmsRefresh.ts` — route inference through `parsePmsNote`
- `src/lib/bedConfigInference.test.ts` — new negative cases
- `src/lib/pmsNoteParser.test.ts` — assert Booking.com sample yields no bed arrangement
- new migration under `supabase/migrations/` — clears algorithm-written false positives
