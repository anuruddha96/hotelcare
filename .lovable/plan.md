## Plan — Use Previo's dedicated housekeeping/internal note instead of the OTA reservation note

### Problem

Today the Previo sync pulls exactly one note field from each reservation — `<note>` in the XML `searchReservations` response (`supabase/functions/previo-pms-sync/index.ts:338`) or `res.note ?? res.notes ?? res.comment` in the REST path (line 459). That field is the **OTA/reservation blob**: Booking.com special requests, Commission note, Virtual Credit Card, Cancellation Policy, pricing, timestamps — the exact content the user is complaining about.

There is a separate, cleaner note maintained by reception in Previo (visible in the Previo UI as an internal/hotel/housekeeping note). We currently never fetch or store it.

### Approach

Two-step: probe → wire.

**Step 1 — Discover the exact Previo field name (diagnostic, one call).**

Extend the existing `previo-probe` edge function to dump the full raw XML for one reservation (not just first 8000 chars) and, in parallel, hit Previo's `getReservation` REST endpoint for a single reservation ID that has a known reception note. Return the raw payload so we can identify the exact tag name Previo uses for the internal note. Previo XML commonly exposes one of: `<noteInternal>`, `<noteHousekeeping>`, `<hotelNote>`, `<noteHotel>`, `<noteReception>`, `<internalNote>`, `<notice>`, `<comment>` — the tenant's actual response tells us which. The REST reservation object usually mirrors these as `noteInternal`, `hotelNote`, `internalNote`, etc.

Result of Step 1: the exact tag/field name for this tenant. Adds no user-facing change yet.

**Step 2 — Prefer the internal note across all Previo sync paths.**

Once the field name is confirmed, update the sync so `rooms.notes` is populated from the internal note when present, and only falls back to the OTA note (via the existing `pmsNoteParser` cleanup) when the internal note is empty. Concretely:

- `supabase/functions/previo-pms-sync/index.ts`
  - XML block parsing (~line 338): additionally extract every candidate internal-note tag (`noteInternal`, `noteHotel`, `hotelNote`, `noteHousekeeping`, `internalNote`, `noteReception`) and pass an `internalNote` alongside the existing `note` into `indexReservation`.
  - REST embedded reservation (~line 459) and REST reservation probe (~line 507): read the same candidate fields off `res.*` and expose as `internalNote`.
  - Final normalized reservation (~line 685): change `Note: res?.note ?? null` to prefer `res.internalNote` when non-empty, otherwise fall back to the OTA `note`.
- `supabase/functions/_shared/pmsNormalizer.ts`
  - Add `internalNote?: string | null` to the `PrevioApiRow.reservation` type (near lines 58–71).
  - In `normalizeApiRow` (lines 98–142) set `notes = res?.internalNote?.trim() || res?.note?.trim() || null`.
  - Also stash both raw fields under `pms_metadata` (`pms_metadata.reservation_note_ota` and `pms_metadata.reservation_note_internal`) so nothing is lost and we can revert cleanly if the field name changes.
- Keep `src/lib/pmsNoteParser.ts` and `src/components/pms/StructuredRoomNote.tsx` unchanged — when `notes` is already the clean internal note, `parsePmsNote` naturally renders it as free text without triggering the finance-blob stripping (its `looksLikePmsNote` gate keys off Booking.com/commission markers, so clean text falls through untouched).

**Excel/CSV uploader — no change.** The user chose "Previo API — dedicated housekeeping/internal note" and left the sample-column question blank. The Excel path stays as-is; if a separate column shows up later we can revisit.

### What I need from you before Step 2

One thing after Step 1 runs: the output of the extended `previo-probe` for a reservation that you know has a reception note in Previo. Ideally give me a Room number + arrival date that currently shows the wrong long OTA note in the housekeeping card and also has a short reception note in the Previo UI — I'll probe that reservation and confirm the exact field name before wiring it in.

### Files touched

- `supabase/functions/previo-probe/index.ts` — extended diagnostic dump (Step 1).
- `supabase/functions/previo-pms-sync/index.ts` — extract and prefer internal note (Step 2).
- `supabase/functions/_shared/pmsNormalizer.ts` — new `internalNote` field, prefer it in `notes` (Step 2).

No DB migrations, no frontend changes, no changes to `pmsNoteParser` or `StructuredRoomNote`.