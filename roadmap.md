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

## Reception Phase 1 — Previo reservation fidelity (2026-11-11)
- [x] Parser reads both Previo response shapes; guest name no longer taken from `<guestCategory><name>`; reservation note no longer taken from a guest note.
- [x] Full Previo status map (1 option, 2 confirmed, 3 checked in, 6 waiting list, 7 cancelled, 8 no-show, 9 checked out). A HotelCare check-in/out is never changed by an import.
- [x] Previo payment state (`cpsId`) drives `balance_due` / `payment_status` for Previo bookings; stored raw in `pms_payment_status`.
- [x] New `pms_*` columns: reservation id, room-reservation id (comId), voucher, status id, payment status, channel, rate plan, option expiry, lock flag, group note, contact.
- [x] Room items matched by comId, so a room move inside a group booking updates the booking instead of duplicating it.
- [x] Incremental sync (`mode: "incremental"`, Previo `termType=modified`) every 10 minutes + full re-import when older than 6 hours, via `previo-sync-reservations-all` and pg_cron.
- [x] Reception UI: real channel badge/label, voucher, option / waiting list, "Paid in Previo"; search by voucher, channel, booker.

### Known limits (Phase 2)
- [ ] Nothing is written to Previo yet (create / modify / check-in / cancel).
- [ ] Previo's search response has no paid amount: a partially paid booking is labelled, the amount must be read in Previo (REST `account`).
- [ ] A folio charge added in HotelCare to a Previo-paid booking recalculates the balance from the HotelCare ledger; OTA prepayments are not ledger payments yet.
- [ ] Bookings that disappear from Previo's response are reported by `previo-reservation-reconciliation`, not removed.
