# Roadmap

## PMS + Reception reservation system (current run)
- [ ] Migration: has_pms_access + hotel-scoped RLS (reservations/guests/folios/room-assignments), reservation_events audit, indexes, unique previo ref, pms_guest_name, triggers, availability helpers, lifecycle RPCs (check-in/out, status, folio, create/update)
- [ ] Shared previo reservation parser `_shared/previoReservations.ts` + test
- [ ] Rewrite `previo-sync-reservations` into idempotent importer (searchReservations XML, room mapping via pms_room_mappings/pms_metadata, counts, pms_sync_history)
- [ ] `src/lib/reservations.ts` pure helpers + tests; `useOperationalHotel` hook
- [ ] Fix PMSNavigation gate (item-role driven)
- [ ] Rewrite CheckInDialog / CheckOutDialog on atomic RPCs
- [ ] New EditReservationDialog; finish CreateReservationDialog (guest create, availability, walk-in)
- [ ] Reservations.tsx: filters/search/sync/list + room planner (ReservationCalendar room-based)
- [ ] ReservationDetail.tsx: lifecycle actions, folio UI, audit timeline, edit
- [ ] Shared ReceptionDashboard for /front-desk + /reception; move breakfast uploader to /reception/breakfast-upload
- [ ] Guests page hotel scoping
- [ ] Translations (en, hu, es, vi, mn, az, tl) for all new strings
- [ ] data-training attributes on key controls
- [ ] Tests + full build green

## Later / discovered
- (none yet)
