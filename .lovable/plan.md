
## 1. Fix room number mapping on `/bb`

The Memories Budapest daily overview uses codes like `66EC.QRP216` (no dash) and `64TWIN-214SH` (with `SH` suffix). Today:

- The upload normalizer in `breakfast-roster-upload` extracts the last digit run (good for `216`/`214`), but
- The shared parser `supabase/functions/_shared/roomCode.ts` `parseRoomCode()` for `memories-budapest` requires a `-`, so `66EC.QRP216` returns `null` and falls through wherever the parser is used (room mapping / lookups), producing the "no room" badge for 216.

Changes:
- Update `parseRoomCode()` Memories branch: if no `-`, fall back to regex `^(\d+)([A-Z.]+?)(\d{2,}(?:SH)?)$` → type `EC.QRP`, room `216`. Keep the existing dash branch unchanged.
- Tighten `64TWIN-214SH` handling: already covered by `stripSh`, but verify suffix `SH` is preserved on output so the room badge shows "214 · SH" consistently with how dashed codes render today.
- Mirror the same dash-less fallback inside `breakfast-roster-upload`'s `normalizeRoomNumber` so the stored `room_number` is always the bare number (`216`, `214`) regardless of source format. Re-upload of the file then maps cleanly.

No DB migration needed — the fix is parser-only and takes effect on the next upload.

## 2. Reception/front-office self-serve upload

Goal: when a `reception` or `front_office` user logs in, the first (and primary) thing they see is a clean "Upload tonight's Daily Overview" screen. Everything else they can reach is read-only until further notice.

### Landing page

New route `/:organizationSlug/reception` rendering a new `ReceptionHome` page:

- Big card: **"Upload Daily Overview (Previo XLSX)"**
  - Hotel auto-selected from `profile.assigned_hotel` (no picker — single hotel per user).
  - Date defaults to *tomorrow* (next day's breakfast) with a date input to override.
  - Drag-and-drop + click-to-pick file zone (reuse `BreakfastRosterUpload` UI, restyled larger).
  - On success: toast `Uploaded N rows for <date>`, show last-upload summary (file name, rows, sheet dates detected, any warnings).
- Secondary card: **"Recent uploads"** — last 5 rows from `breakfast_roster` grouped by `stay_date` for this hotel (count + uploaded_by + time), so the night receptionist can see at a glance whether tonight is already done.
- Tertiary links (read-only): Tickets, Rooms, Housekeeping, Attendance — open the existing dashboard in a read-only view (see below).

### Routing / redirect

`src/pages/Index.tsx`:
- Add `RECEPTION_ROLES = ['reception', 'front_office']`.
- If `profile.role` is in `RECEPTION_ROLES`, redirect to `/:org/reception` (mirror the breakfast_staff pattern).

`src/App.tsx`:
- Register new route `/:organizationSlug/reception` → `ReceptionHome` (auth-guarded).

### Read-only access elsewhere

A lightweight gating helper `isReadOnlyRole(role)` returning true for `reception`/`front_office`. Wire it into the existing dashboard pages so reception can browse but not mutate:

- Hide/disable primary action buttons (Create ticket, Start cleaning, Edit room, Create reservation, Check-in/out actions, etc.) when `isReadOnlyRole` is true.
- `MainTabsBar`: add `reception`/`front_office` to `VISIBLE_ROLES` so they can navigate, but no exec tabs (Revenue/Invoices stay hidden).
- Server-side: rely on existing RLS — reception already lacks write policies on most tables; the UI change is the visible layer. No new RLS work in this pass (the upload endpoint already accepts `reception`/`front_office`).

### Permissions sanity check

`breakfast-roster-upload` already allows `reception` and `front_office` in its role allowlist, so once the UI exists, uploads from a receptionist account will succeed with no backend change.

## Technical details

Files touched:
- `supabase/functions/_shared/roomCode.ts` — dash-less Memories fallback.
- `supabase/functions/breakfast-roster-upload/index.ts` — same fallback inside `normalizeRoomNumber` (defensive).
- `src/pages/ReceptionHome.tsx` *(new)* — landing page.
- `src/components/dashboard/BreakfastRosterUpload.tsx` — extract a larger "primary" variant or accept a `size="hero"` prop; default hotel from profile.
- `src/pages/Index.tsx` — reception redirect.
- `src/App.tsx` — new route.
- `src/components/layout/MainTabsBar.tsx` — include reception roles, no exec tabs.
- `src/lib/roleAccess.ts` *(new, small)* — `isReadOnlyRole`, `RECEPTION_ROLES`.
- Action-button sites (tickets, rooms, housekeeping, attendance dashboards) — guard with `isReadOnlyRole`. Scope kept to hiding/disabling top-level create/edit actions; deeper mutation guards can follow once you confirm what reception should *eventually* be able to do.

Out of scope (ask before doing): allowing reception write access to specific modules later, adding multi-hotel picker for reception, automating sheet date selection beyond "tomorrow".
