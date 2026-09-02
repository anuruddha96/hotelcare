# PMS + Reception completion roadmap

## Done
- [x] Migration: hotel-scoped PMS access (`can_access_pms_hotel`, `can_access_reservation`), `has_pms_access` + `top_management_manager`, hotel-scoped RLS (reservations, guests, guest_folios, reservation_room_assignments, reservation_events), `reservation_events` audit table, `pms_guest_name`, indexes + unique previo ref, lifecycle RPCs (check-in/out, status, folio, create/update), availability/conflict helpers.
- [x] Security hardening: revoked PUBLIC/anon EXECUTE on all new functions (linter deltas resolved; remaining findings pre-date this work).
- [x] Shared Previo reservation XML parser + Deno tests (`_shared/previoReservations.ts`).
- [x] `previo-sync-reservations` rewritten as real idempotent importer (searchReservations XML, mapping via pms_room_mappings + rooms.pms_metadata.roomId, no invented guests, local-status preservation, pms_sync_history logging).
- [x] `src/lib/reservations.ts` helpers + vitest suite; `src/lib/pmsLifecycle.ts` RPC wrappers; `useOperationalHotel` hook.
- [x] PMSNavigation outer gate removed (item-level roles decide).
- [x] CheckInDialog (hotel-scoped available rooms, conflicts, warnings, atomic RPC), CheckOutDialog (balance acknowledgement, atomic RPC, no receptionist housekeeping assignment).
- [x] PmsSyncButton, FolioItemDialog, EditReservationDialog, GuestSearchSelect (scoped + quick-create), ReceptionDashboard (KPIs incl. real Available, arrivals/departures/in-house/late-arrival no-show, global search).
- [x] Reservations page rewrite (quick filters, source filter, search, room planner tab) + room-based ReservationCalendar planner.
- [x] Guests page hotel scoping.

## Remaining (next run)
- [ ] `src/pages/FrontDesk.tsx` → thin wrapper around ReceptionDashboard.
- [ ] `src/pages/ReceptionHome.tsx` → ReceptionDashboard + breakfast-upload link; move uploader to `src/pages/ReceptionBreakfastUpload.tsx`; add `/reception/breakfast-upload` route + lazy import in `src/App.tsx`.
- [ ] `src/pages/ReservationDetail.tsx` → lifecycle via RPCs/dialogs (no direct status writes), room join, audit timeline from reservation_events, folio charge/payment UI, PMS-managed banner, Edit dialog.
- [ ] Translations: create `src/lib/pms-reception-translations.ts` (keys: pms.fd.*, pms.sync.*, pms.err.*, pms.ci.*, pms.co.*, pms.res.*, pms.planner.*, pms.guestQuick.*) in en/hu/es/vi/mn/az/tl and register in `useTranslation.tsx` `getStaticTranslationBundle` after pmsTranslations.
- [ ] Run vitest (reservations + training tests) + full build; deploy edge function; verify importer against a Previo hotel.
