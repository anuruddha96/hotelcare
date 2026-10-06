# PMS Phase 1 — Canonical Reservation Foundation

## Purpose

Phase 1 creates the independent, safe foundation that every later HotelCare PMS feature will use. It does **not** replace Previo, publish rates, alter OTA mappings, or expose a new production reservation-writing UI.

## Source-of-truth policy

During Phase 1, existing production integrations remain unchanged. The new `pms_*` tables are a dark/additive ledger. HotelCare may begin mirroring data into them only in a later controlled phase; creating this schema alone does not change PMS authority.

The eventual authority model is property-scoped. A hotel must explicitly pass dual-run/cutover checks before HotelCare can become authoritative for that property.

## Canonical reservation aggregate

A reservation is represented by:

1. `pms_reservations` — stay header, status, source/external identity, guest contact snapshot and total.
2. `pms_reservation_rooms` — one or more booked room units, with optional physical-room assignment.
3. `pms_reservation_nights` — one row per booked room/night with mandatory numeric booked rate and currency.
4. `pms_reservation_events` — append-oriented business/audit history.
5. `pms_external_events` — idempotent durable inbox for future Previo/OTA events.

This structure supports multi-room bookings, room assignment after booking, per-night pricing and modification history without using the current live rate as the historical booked price.

## Reservation lifecycle

Allowed Phase 1 domain transitions are:

- `tentative -> confirmed | cancelled`
- `confirmed -> checked_in | cancelled | no_show`
- `checked_in -> checked_out`
- `checked_out`, `cancelled` and `no_show` are terminal

A same-status update is not treated as a lifecycle transition. External retries must be handled by idempotency rather than replaying state transitions.

## Price integrity

`pms_reservation_nights.booked_rate_amount` is `NOT NULL`. A future importer must therefore quarantine/reconcile an external confirmed reservation that has no usable night price instead of silently inserting a price-less night that would distort ADR.

Booked-night rates are snapshots of what the reservation was booked/modified at. Later HotelCare rate-calendar or RMS changes must not rewrite those snapshots.

## Idempotency and external events

External integrations must first persist a provider event in `pms_external_events`. The database unique key `(organization_slug, hotel_id, provider, external_event_id)` prevents the same provider event from being accepted twice.

Canonical external reservation identity is separately unique by organization, hotel, source system and external reservation ID. This protects against webhook retries, polling overlap and connector retries creating duplicate bookings.

## Inventory invariant

The domain helper defines the future canonical availability calculation:

`available = max(0, physicalInventory - reserved - outOfOrder - blocks + overbookingAllowance)`

All inputs are non-negative integers. Phase 1 does not yet publish this number or replace existing inventory logic; Phase 3 will persist and transactionally protect inventory.

## Time/date invariant

Stay-night expansion is arrival-inclusive and departure-exclusive. It uses UTC calendar arithmetic so DST changes in Europe/Budapest cannot add, remove or shift hotel nights.

## Access/security posture

All Phase 1 `pms_*` tables have Row Level Security enabled and intentionally have no authenticated browser policies. This keeps the foundation dark. Later server-side services/RPCs must validate organization/property access before any user-facing reservation write path is opened.

The TypeScript `ReservationRepository` and `ExternalEventInbox` interfaces define those future server-side boundaries. No browser implementation is provided in Phase 1.

## Phase 1 test coverage

`src/domain/pms/__tests__/reservations.test.ts` covers:

- normal reservation lifecycle transitions;
- cancellations/no-show and terminal states;
- invalid/no-op transitions;
- one-night and multi-night stays;
- DST-boundary date expansion;
- invalid/reversed dates;
- canonical inventory and overbooking allowance;
- negative/fractional inventory rejection;
- deterministic external idempotency keys;
- delimiter-safe identities and missing identity fields.

## Production safety

The Phase 1 migration creates new objects only. It contains no trigger/function that writes to existing reservations, Previo synchronization, housekeeping, revenue management, channel distribution or rate-publishing tables.

No SLNT rates/settings are read or modified by this phase.

## Exit criteria

Phase 1 is complete when all of the following are true:

- additive migration exists and is reviewable;
- reservation/room/night/audit/inbox structures exist;
- booked night price is mandatory;
- external event/reservation identities have database uniqueness protection;
- lifecycle/date/inventory/idempotency domain rules have automated tests;
- server-side persistence boundaries are explicit;
- RLS prevents accidental direct browser authority;
- A-to-Z PMS roadmap and source-of-truth/cutover policy are documented;
- branch is compared with current `main` and has no unrelated changes;
- CI/test status is checked and any Phase 1 failure is resolved before merge.

## Phase 2 handoff

Phase 2 should rebase/salvage useful concepts from draft PR #24 and build Reservations v2 + Front Desk on top of this domain. It must use server-side transactional reservation writes rather than allowing the React client to become the business-logic authority.
