# HotelCare PMS — A-to-Z Development Roadmap

## Mission

Turn HotelCare from an operations/revenue platform that currently consumes PMS data into a production-grade PMS, then add channel distribution so a hotel can operate reservations, inventory, front desk, housekeeping, rates and connected sales channels from HotelCare.

This is a controlled migration, not a big-bang replacement. Until an explicit hotel-by-hotel cutover, the existing Previo integration remains production-authoritative.

## Non-negotiable guardrails

- No PMS phase may silently change live hotel rates or channel settings.
- SLNT pricing/settings are outside this PMS program unless explicitly approved.
- Previo remains authoritative during the build and dual-run phases.
- New PMS components are additive and feature-gated until their phase exit criteria are met.
- Reservation and inventory writes must be transactional and auditable.
- External reservation events must be idempotent; retries cannot create duplicate bookings.
- Historical booked-night prices are snapshots and must not be rewritten by later rate changes.
- A confirmed reservation night cannot be accepted without a numeric booked rate.
- HotelCare becomes source of truth only after reconciliation and a controlled property cutover.

## Program phases

| Phase | Development | Main outcome | Exit criteria |
|---|---|---|---|
| 1 | Canonical reservation foundation | Independent PMS reservation domain, database ledger, lifecycle, idempotency and audit boundaries | Migration is additive; domain tests pass; no live runtime wiring; architecture documented |
| 2 | Reservations v2 + Front Desk | Fast reservation list/tape chart, reservation workspace, create/edit/cancel/no-show/check-in/check-out, room assignment/moves | Staff can execute the full reservation lifecycle in a sandbox/feature-flagged property; permission tests pass |
| 3 | Inventory, rooms, rate plans and restrictions | One daily inventory model plus room types, physical rooms, rate plans, min/max stay, CTA/CTD, stop-sell, blocks and out-of-order stock | Inventory calculation is deterministic; concurrency tests prevent double-selling; no price-less confirmed nights |
| 4 | Previo bridge + dual-run reconciliation | Current Previo data mirrors into the canonical ledger with durable inbox/outbox and discrepancy monitoring | Repeated sync is idempotent; changes/cancellations reconcile; HotelCare still does not overwrite Previo by default |
| 5 | Guest profile + CRM | Deduplicated primary/companion guests, stay history, preferences, notes and privacy controls | Guest matching works across repeat stays; access is role-scoped; retention/privacy rules are documented |
| 6 | Folio, payments, deposits, refunds and taxes | Operational guest ledger separate from reservation price snapshot | Folio balances reconcile; refunds/deposits are auditable; payment state cannot silently alter booked ADR |
| 7 | Operations integration | PMS reservation state drives housekeeping, extensions, checkout/daily changes, maintenance impact and guest requests | Extension/early departure/room move updates operations once, with audit trail and no status bounce |
| 8 | Hungary compliance | Implement the currently applicable Hungarian accommodation, guest-data, invoicing and tourist-tax workflows after re-verifying official requirements | Required integrations/exports pass vendor/regulatory testing; compliance data is access-controlled |
| 9 | Channel Manager core | Canonical ARI model, mappings, channel connection model, event inbox/outbox, retries, acknowledgements and reconciliation | Simulator tests prove rates/availability/restrictions and reservation events are lossless and retry-safe |
| 10 | Connectivity hub + OTA rollout | Connect the first supported connectivity provider, then Booking.com, Expedia, Agoda and Trip.com through certified/approved routes | Each channel passes mapping, reservation/modification/cancellation and ARI acknowledgement tests before enablement |
| 11 | Direct booking engine | Hotel website availability, offers, reservation creation and secure payment/deposit flow | Direct booking consumes the same PMS inventory transactionally and cannot oversell against OTA inventory |
| 12 | RMS integration | HotelCare revenue engine reads canonical pickup/occupancy and publishes approved prices through the channel layer | Rate decisions have guardrails, reason/audit metadata and publishing acknowledgement; rollback/reconciliation work |
| 13 | Reporting, night audit and accounting | Occupancy, ADR, RevPAR, pickup, source, cancellation/no-show, cashier/night-audit and accounting exports | Reports reconcile to reservation nights/folios; historical values are reproducible from ledger data |
| 14 | Security, reliability and scale hardening | Fine-grained RBAC, observability, queues/dead-letter, backups, restore drills, performance/accessibility/load tests | SLOs and incident alerts are defined; recovery is tested; high-volume reservation/calendar tests pass |
| 15 | Pilot property dual run | Operate one controlled property in parallel with Previo and compare every reservation/inventory/folio day | Zero unexplained material discrepancies through the agreed pilot window; staff sign-off and rollback plan ready |
| 16 | Hotel-by-hotel PMS cutover | HotelCare becomes authoritative only for explicitly approved properties | Each property has cutover checklist, mappings, opening balances/inventory, support coverage and rollback criteria |
| 17 | Direct OTA certification/optimization | Where commercially justified, replace or supplement the hub with direct certified channel integrations | Direct adapter passes each OTA’s current onboarding/certification requirements and production reconciliation |

## How existing work is reused

- Draft PR #24 contains an earlier reservation-board direction. Phase 2 should salvage useful UX/code after rebasing rather than creating a second competing board.
- Draft PR #74 contains an earlier distribution/channel foundation. Phase 9 should review and salvage compatible adapter/mapping concepts rather than duplicating them.
- Existing Previo sync stays intact through Phases 1–3. Phase 4 wraps/mirrors it into the canonical model instead of prematurely reversing authority.

## Canonical data principles

**Reservation truth:** reservation header + one or more reservation rooms + an explicit per-night booked-rate snapshot.

**Inventory truth:** `physical sellable inventory - active reserved inventory - out-of-order inventory - blocks + configured overbooking allowance`.

**Channel truth:** channels deliver reservations and receive ARI; they are not separate inventory masters inside HotelCare.

**History truth:** every state-changing operation must produce an audit event containing actor/source and enough before/after context to explain what happened.

**Integration truth:** receive external event -> persist durable inbox record -> deduplicate -> validate -> transactionally apply canonical change -> record audit event -> calculate downstream impact -> publish through an outbox -> wait for acknowledgement -> reconcile.

## Cutover policy

A property can move from Previo-authoritative to HotelCare-authoritative only when its reservation ledger, inventory, rooms/rate plans, payments/folios, operations workflows, required Hungary workflows, channel mappings and reconciliation checks are all ready. Authority is selected per property; it must never change globally as a side effect of deploying code.

## Definition of program completion

HotelCare is a complete PMS when a newly onboarded hotel can configure its property and room inventory, accept direct and channel reservations, operate front desk and housekeeping, manage booked-night prices/folios/payments, meet applicable Hungarian workflows, publish availability/rates/restrictions, reconcile every connected channel, run night audit/reporting, and recover safely from connector or platform failures without relying on another PMS as the operational source of truth.
