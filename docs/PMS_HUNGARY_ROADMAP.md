# HotelCare PMS — Hungary Technical Roadmap

Status: architecture roadmap. Implement in phases; do not enable regulatory or OTA production writes until the relevant phase has passed testing/certification.

## Product direction

HotelCare should evolve from an operations + revenue platform into a property management system with one normalized internal model for rooms, guests, reservations, stays, folios, payments, housekeeping state and external-channel mappings.

The UI must not depend directly on Previo, Booking.com, Expedia, NTAK, VIZA or NAV payload shapes. External systems should connect through adapters with mapping, validation, idempotency, retry and audit layers.

---

## Phase 1 — Reservation board foundation (current)

Goal: replace the legacy front-desk experience with a fast, useful operational board without changing the legal/reporting stack yet.

- Rooms are rows; dates are columns.
- 14-day lazy/visible window rather than loading full reservation history.
- Sticky room column and compact stay bars.
- Arrival, in-house, departure, DND and checkout-room indicators.
- Existing room inventory is reused.
- Prefer normalized `reservations` data when present.
- Until normalized reservations are populated, read the existing live Previo `daily_overview_snapshots` as a read-only adapter.
- Keep legacy front-desk screen on a rollback route during validation.
- No heavy calendar/scheduler dependency.

Acceptance criteria before merge:

1. Hotel Mika shows all 33 configured rooms.
2. Current and future Previo stays render in the correct room/date cells.
3. DND/departure state agrees with housekeeping state.
4. Horizontal scrolling is smooth on phone/tablet and the room column remains visible.
5. No cross-property data can appear after hotel switching.
6. Board requests are bounded by active property + visible date window.

---

## Phase 2 — Native PMS reservation + stay core

Goal: make HotelCare's own normalized data authoritative enough for reception operations.

### Data model

- `reservations`: booking-level commercial record.
- `reservation_room_assignments`: one booking can occupy one or multiple rooms; assignments have their own stay dates/status.
- `guests` + `reservation_guests`: support multiple guests per reservation and lead-guest designation.
- `stay_events`: append-only operational events (created, modified, room assigned, check-in, room move, DND, check-out, no-show, cancellation).
- `external_references`: source system, property, external reservation ID, channel confirmation number, revision/version.
- `property_operating_settings`: check-in/check-out times, timezone, currency, business date/night-audit rules.

### Reception workflow

- Create/edit/cancel reservations.
- Assign/unassign a room.
- Drag a stay between rooms only after conflict validation.
- Detect overlaps/overbooking before committing a move.
- Check-in / reverse check-in with audit permission.
- Check-out / reverse check-out with audit permission.
- Room move with history.
- No-show and late-arrival states.
- Internal notes, guest requests, VIP flags and housekeeping hand-off.
- Quick filters: arrivals, departures, in-house, unassigned, DND, dirty/clean/inspected, balance due.
- Reservation side drawer to avoid a full page load for common actions.

### Migration/normalization

Build a Previo ingestion adapter that converts the existing live snapshot/API feed into the normalized reservation model. The adapter must be idempotent and preserve external IDs so re-syncing does not create duplicate guests or reservations.

---

## Phase 3 — Hungary compliance layer

Goal: make the software technically ready for Hungarian accommodation-provider requirements. Certification/registration and legal sign-off remain separate business steps.

### NTAK

Build an `ntak_adapter` isolated from the PMS UI:

- property NTAK configuration and certificate/version metadata;
- mapping from HotelCare room/stay/business events to the required NTAK statistical payload;
- technical closing/night-audit trigger;
- queue + idempotency key + retry/backoff + dead-letter state;
- request/response audit with sensitive-data redaction;
- compliance dashboard showing last successful submission and rejected items;
- test/sandbox and production environments separated;
- schema/version compatibility checks before sending.

Important architecture rule: NTAK reporting must be generated from the normalized PMS ledger, not scraped from the reservation-board UI.

### VIZA / guest document capture

Build an `identity_capture_adapter` and `viza_adapter`:

- document-reader SDK/device abstraction so HotelCare is not locked to one scanner brand;
- scan -> parse -> operator verification/correction -> encrypt -> transmit -> discard source image;
- manual correction/entry path when a reader cannot correctly extract a required field;
- required guest identity fields and stay start/planned end/actual end fields;
- age-aware document requirements;
- support an optional remote pre-arrival document-reading flow, followed by property identity verification;
- explicit processing state (not scanned / scanned / verified / transmitted / rejected);
- no raw passport/ID scan or document photograph stored in HotelCare storage;
- access to identity fields limited to authorized roles and logged.

### NAV Online Számla / invoicing

Create a provider-neutral invoicing domain first, then a NAV adapter:

- invoice/receipt/credit-note domain separate from reservation totals;
- seller legal entity per property/organization;
- customer billing profile and tax identifiers;
- continuous, unique invoice-number series controlled server-side;
- HUF and foreign-currency handling with tax/VAT representation;
- immutable issued document + correction/storno workflow instead of destructive edits;
- server-side encrypted storage for NAV technical-user configuration;
- configuration fields for technical username, password, XML signing key and XML exchange key;
- NAV API request signing, token exchange, submission, result polling and retry state machine;
- idempotency protection so retries cannot create duplicate invoice numbers/submissions;
- test and production credentials separated;
- key-rotation support without code deployment;
- audit trail for every issue/correction/submission/error.

Do not expose NAV secrets to the browser or store them in ordinary profile/settings tables.

### Guest email / transactional messaging

- provider adapter (Gmail/SMTP/transactional provider) rather than hard-coded mail calls;
- templates per property and language;
- reservation confirmation, pre-arrival, check-in information, invoice, cancellation and post-stay messages;
- delivery status and audit trail;
- separate transactional messages from marketing consent/preferences.

### GDPR/privacy controls

- privacy by design/default and data minimization;
- per-field purpose/retention classification;
- retention/deletion jobs for data no longer needed;
- role-based access and least privilege;
- audit logs for access to sensitive guest data;
- encryption for secrets and sensitive data in transit/at rest;
- export/rectification/deletion workflows where legally applicable;
- configurable privacy-notice/version acknowledgement metadata;
- processor/subprocessor configuration and security documentation;
- backups and restore procedures that respect retention/deletion policy.

Legal counsel should confirm the exact retention/legal-basis matrix before production. The software should make those rules configurable rather than embedding assumptions in UI code.

---

## Phase 4 — Channel manager / OTA connectivity

Goal: make HotelCare independently synchronize reservations, inventory, rates and restrictions.

### Common adapter contract

Each channel should implement an internal contract such as:

- `pullReservations` / reservation webhook ingestion
- `acknowledgeReservation`
- `pushAvailability`
- `pushRates`
- `pushRestrictions`
- `mapRoomTypes`
- `mapRatePlans`
- `healthCheck`
- `reconcile`

### Shared infrastructure

- external property/room/rate-plan mapping tables;
- inbox/outbox pattern for all channel messages;
- stable idempotency keys;
- version/revision handling for modifications and cancellations;
- retry with exponential backoff and dead-letter review;
- reconciliation job that compares HotelCare vs channel state;
- per-channel circuit breaker so one broken channel cannot block PMS operations;
- channel health page: last inbound reservation, last successful outbound update, errors and mapping gaps;
- never let an old retry overwrite a newer rate/inventory decision.

### Booking.com

Implement Reservations plus Rates & Availability first, then content/room-rate management only if needed. Design for Booking.com onboarding/certification and PII/PCI requirements before production activation.

### Expedia Group

Design around Expedia's core lodging connectivity capabilities: Availability & Rates, Reservation Management and Product Management. Keep capability-specific onboarding/versioning behind the Expedia adapter.

### Other channels

Add additional OTAs through the same contract (not new bespoke reservation tables). Direct booking engine and manual/walk-in reservations should use the same normalized reservation pipeline.

---

## Phase 5 — Folio, payment and accounting-grade PMS controls

- folio ledger with charges, payments, adjustments and refunds;
- split folios and company/agency billing;
- tax/VAT breakdown;
- deposits and prepayments;
- tokenized payment-provider integration — do not store raw card PAN/CVV;
- virtual-card workflow where supported by channels;
- cashier shifts and end-of-shift reconciliation;
- invoice linkage to folio transactions;
- audit trail and role permissions for financial reversals.

---

## Phase 6 — Certification and production readiness

Before representing HotelCare as a production-ready Hungarian PMS:

- complete the relevant NTAK software/certification process and appear on the applicable NTAK-compatible PMS list;
- validate VIZA document-reader and encrypted submission integration against the approved technical route;
- validate NAV Online Számla submissions in test before production keys are enabled;
- complete Booking.com / Expedia connectivity onboarding and certification requirements for the capabilities adopted;
- conduct security review and penetration testing;
- perform restore-from-backup test;
- load test room board, reservation ingestion and reporting queues;
- define support/runbooks for NTAK/VIZA/NAV/OTA outages;
- add operational monitoring, alerting, structured logs and reconciliation dashboards;
- beta with one property before portfolio rollout.

---

## Performance rules for the PMS UI

- Lazy-load PMS routes.
- Query by active property and visible date window.
- Prefer a few normalized queries over per-room requests.
- Cache room metadata and mapping data; invalidate on configuration changes.
- Virtualize rows only when property size makes it necessary; do not add a heavy scheduler package by default.
- Keep status updates optimistic only when rollback is safe.
- Use realtime subscriptions for small operational deltas, not full-board refetches on every event.
- Never block reception UI on an OTA/NTAK/VIZA/NAV request; write to an outbox and show sync state.

## Architectural principle

**HotelCare remains operationally available even when an external system is unavailable.** Regulatory/channel messages queue safely, retain ordering/version rules, surface failures to staff, and reconcile when the external service recovers.
