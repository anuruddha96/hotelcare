# HotelCare PMS Phase 2 — Reservations v2 + Front Desk

## Objective

Turn the Phase 1 canonical reservation ledger into a usable property-scoped front desk while preserving the current production safety boundary: Previo remains authoritative for imported bookings during dual-run, while HotelCare can own newly-created HotelCare-native manual reservations.

## Delivered

### Front desk workspace

`/reservations` now opens Reservations v2 instead of redirecting to the legacy reception page.

The workspace includes:
- 14-day room × date tape chart with sticky room/date headers
- HotelCare-native stays visually separated from read-only Previo-backed stays
- responsive list view with search
- arrivals today, in-house, departures today and unassigned counters
- unassigned HotelCare-native reservation queue
- refresh and rolling-window navigation
- visible dual-run safety messaging

Reception Home links directly to Reservations v2. The existing reception workspace remains intact for rollback and workflows that have not moved to PMS v2 yet.

### Native reservation operations

Authorized reception/front-office/management roles can:
- create a one-room HotelCare-native manual reservation
- assign or unassign a physical room
- edit guest/contact information, dates, adults/children, nightly rate, currency and notes
- check in a confirmed reservation
- check out an in-house reservation
- cancel a tentative/confirmed reservation
- mark a confirmed reservation no-show

The reservation lifecycle is enforced server-side, not only in the React UI.

### Booked-rate integrity

Manual reservations require a numeric nightly booked rate. Creation writes one booked-rate row per stay night. Editing the Phase 2 flat nightly rate rebuilds the nightly snapshots transactionally and recalculates the reservation total.

This preserves the Phase 1 rule that the future PMS must not contain price-less booked nights.

### Room-assignment integrity

The server rejects overlapping active HotelCare-native reservations for the same physical room.

A database trigger additionally:
- verifies that every assigned room belongs to the same hotel as the reservation
- keeps `room_type_id` aligned to the selected physical room
- rejects overlap with another active canonical HotelCare reservation
- rejects overlap with the current Previo-backed `reservations` mirror

This is defense in depth against malformed clients, future integrations and accidental dual-run double booking.

### Authorization

Direct authenticated writes to `pms_*` tables remain unavailable.

Phase 2 exposes narrow `SECURITY DEFINER` RPCs which:
- verify `auth.uid()` against the HotelCare profile
- require matching organization
- require matching assigned property unless the role has organization-wide authority
- separate read-capable operational roles from reservation-management roles
- keep imported/Previo reservations read-only during dual-run

### Audit trail

Create, edit and lifecycle transitions append `pms_reservation_events` rows with actor, before/after state and front-desk entry-point metadata.

### Transitional Previo adapter

`pms_get_front_desk_feed` returns two independent sources:
1. canonical `pms_*` reservations owned by HotelCare
2. the existing Previo-backed `reservations` mirror, shaped as read-only stays for Reservations v2

The existing reservation mirror is used instead of relying on daily overview snapshots because it contains current and future Previo bookings and physical-room mappings. The UI never exposes HotelCare edit/status actions for those imported stays.

The live schema was checked read-only before finalizing Phase 2. At validation time the existing mirror contained 1,441 Previo reservations, including 939 current/future reservations and 853 current/future reservations already mapped to physical rooms. No production rows were modified by this validation.

## Files

- `supabase/migrations/20260915103000_pms_phase2_front_desk.sql`
- `supabase/migrations/20260915104500_pms_phase2_room_scope_guard.sql`
- `supabase/migrations/20260915105500_pms_phase2_dual_run_hardening.sql`
- `src/lib/pmsFrontDesk.ts`
- `src/lib/pmsFrontDesk.test.ts`
- `src/components/pms/PMSFrontDeskWorkspace.tsx`
- `src/pages/Reservations.tsx`
- `src/pages/ReceptionHome.tsx`

## Explicitly not part of Phase 2

- making HotelCare authoritative for existing Previo bookings
- writing reservation edits back to Previo
- OTA ARI/rate publishing
- Booking.com/Expedia/Agoda/Trip.com connectivity
- multi-room/group reservations
- derived/occupancy rate plans
- folios/payments/refunds
- NTAK/VIZA/NAV production transmission
- drag/drop room move writes on the board
- automatic housekeeping changes caused by PMS reservations

These belong to later phases so the reservation/front-desk layer can be validated independently.

## Exit criteria

Phase 2 is considered development-complete when:
- production frontend build succeeds
- new PMS front-desk unit tests pass
- Phase 1 PMS tests continue to pass
- no additional failure is introduced beyond the known repository test baseline
- live table/column compatibility is checked read-only for the migration dependencies
- branch remains safely stacked on Phase 1
- no live price/channel publishing or SLNT configuration is touched
- PR documents the existing repository-wide failing-test baseline separately from Phase 2 changes

## Validation workflow

The repository's Frontend CI workflow is configured only for pull requests targeting `main`. The stacked Phase 2 PR is therefore temporarily retargeted to `main` to run build/tests, then restored to the Phase 1 branch so review remains limited to the incremental Phase 2 diff.

## Next phase

Phase 3 builds authoritative room inventory and rate-plan/restriction primitives: physical inventory, OOO/blocks, rate plans, daily rates, min/max stay, stop-sell, CTA/CTD and availability calculation. It must consume this reservation ledger rather than creating a second inventory truth.
