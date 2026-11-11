# HotelCare In-Suite — phased development and guarded rollout

**Last updated:** 2026-11-09  
**Repository:** `anuruddha96/hotelcare`  
**Branch:** `feature/insuite-guest-tablet-mvp-20261108`  
**PR:** https://github.com/anuruddha96/hotelcare/pull/769 (DRAFT — do not merge/deploy without review)  
**Status:** Implementation committed and subject to automated CI. Supabase migrations and Edge Function have **not** been applied to production. Full device and PMS tests are still required.

## Delivered in the proposed code

### Guest room tablet (`/suite`)
- One-time (15-minute) device pairing to a physical property/room; 64-character random bearer token, stored only as a SHA-256 digest on the server.
- Hotel-specific logo, color, welcome, help, guest Wi-Fi, restaurant, minibar, travel, house rules and sustainability information.
- EN/DE/HU navigation and basic guest interface; property descriptions and commerce details still require translation support.
- Hotel-enabled guest requests (towels, pillows, amenities, cleaning, water, maintenance, reception callback), quantity/details and tracked status.
- Reception chat with persistent, stay-scoped history; server-side verification of the room's current checked-in reservation before guests can send.
- Hotel-specific breakfast, room service, minibar catalog display, quantities and a server-priced **request** for staff confirmation. No payment, hotel folio posting, minibar consumption recording or automatic kitchen posting.
- Taxi, gym, spa, sauna and jacuzzi **booking requests** with desired date/time and party size. Staff verifies capacity and confirms or declines; there are no third-party operator API integrations.
- Guest state refresh polling approximately every 20 seconds; changes to the device's current stay/session epoch clear previous guest messages/orders and views.

### Staff (`/:organizationSlug/insuite`)
- Separate per-property admin draft and publish controls, service toggles, existing-hotel branding prefill, editable content and unpublished menu management.
- Canonical room/device mapping, one-time pairing, staff PIN, remote app-session reset/reconcile/revoke, last seen.
- Reception chat inbox and staff reply. Open guest-service request queue with room number and verified guest name where an unambiguous checked-in stay exists.
- High-priority independent room delivery card for the assigned on-duty housekeeper, without changing housekeeping cleanliness, RTC, room assignment or Previo state.
- An existing Approvals view link to the In-Suite service queue.
- A manager/reception assignment workflow showing eligible on-duty staff scoped to the employee's assigned hotel and department.
- Separate staff order queue, receipt item lines, status progression, guest-staff-confirmed facility/transport reservations and hotel menu editor.
- Server-persisted staff alerts with acknowledgments. HotelCare's existing opt-in Web Push infrastructure is used when configured; the persistent queue remains authoritative if push fails. Reception refreshes its queue approximately every 15 seconds.

### Data isolation and backend
- Tables: `insuite_property_configs`, `insuite_devices`, `insuite_service_requests`, `insuite_request_events`, `insuite_messages`, `insuite_staff_alerts`, `insuite_catalog_items`, `insuite_orders`, `insuite_order_lines`, `insuite_booking_requests`.
- RLS enabled and direct access revoked for `anon`/`authenticated`; approved actions go through the `insuite-api` Edge Function using validated Supabase staff JWT or hashed room-bound device bearer tokens. Never expose the service-role key in the browser.
- Six-digit staff maintenance PIN hashed with a server-only HMAC secret (`INSUITE_PIN_PEPPER`, at least 32 characters). Wrong PIN attempts are throttled and locked out.
- Server-side order pricing: `insuite_create_order` atomically snapshots item names, currency, quantities and prices from the hotel-specific active catalog, independent of client-supplied amounts. Idempotent client UUIDs and request throttles prevent common duplicates.
- Protected, conditional database trigger fanout into a durable staff notification queue and, when possible, opted-in Web Push.
- Overdue open requests escalate to management/reception from an idempotent `insuite_escalate_overdue` SQL function. The migration schedules its 1-minute check through `pg_cron` where the extension exists; confirm the named job is installed exactly once in staging.

## Check-in/check-out protection (critical)

A device's room mapping is permanent, but **guest services become available only when that device is attached to one verified `checked_in` reservation**. A hotel tablet never gives the guest an option to select/impersonate another room.

- Local HotelCare reservation status change to checked in: where unambiguous and correctly mapped, a reservation trigger rotates the session and binds the new active reservation.
- Local checkout, cancellation, no-show or room reassignment: the trigger clears the old reservation binding and rotates its session, but only when the device is still attached to **that same reservation** (to protect a newly checked-in next guest).
- A Previo **verified physical checkout** `pms_change_events` record also clears the matching session. This requires `event_type='checkout_confirmed'`, `source='poll_checkouts'`, `auto_applied=true`, the same canonical room/hotel and **exactly matching** Previo reservation ID (`previo_reservation_id` vs `reservations.source_reservation_id`). Ambiguous records cannot reset an unrelated guest.
- Front desk can manually reconcile a tablet to an exactly-one currently checked-in HotelCare reservation or reset/revoke the device; manual intervention remains needed if an external PMS signal is missing or stale.
- Atomic INSERT guards for guest chat/service requests and booking requests protect against checkout races with database row locks.

**Important limitation:** External PMS sync may retain stale local `checked_in` records even after a physical checkout; the exact-match Previo event guard covers verified signals only. If there is no exact verified signal, front desk MUST reconcile/reset the tablet before the next guest, and service access should remain supervised until this lifecycle is tested against each integrated PMS. Guest identity is deliberately omitted where overlaps are ambiguous.

## Notification and escalation rules

- Request creation: durable alert to assigned housekeeper and eligible hotel management/reception recipients, with opted-in push attempts via `hotelcare_dispatch_push`.
- Reassignment: new durable alert for the newly assigned staff member.
- Chat message: new reception alert; guest names only to authorized staff with an unambiguous active in-house reservation.
- Orders and facility/transport requests: staff queue and durable alert; no claim of a guaranteed kitchen/driver booking.
- SLA check: unresolved submitted requests after 5 minutes, accepted after 15, in-progress after 30 trigger a once-only escalation. The scheduled job runs every minute where `pg_cron` is enabled.
- Persistent alerts are acknowledged by the recipient; acknowledgments never silently complete the underlying task.
- **Still required for full production:** per-team delivery/availability monitoring, non-polling private realtime updates, push reliability verification across iOS and Android, shift-change reassignment and a complete escalations audit/management dashboard.

## Safe source-code merge while database is not activated

The standalone In-Suite routes and console are included in the frontend source for authorized roles, but a property cannot serve guests until its backend, tables, secret and approved content are configured. The housekeeping component **must not poll** the In-Suite backend on every cleaner's phone before deployment. It is disabled by default and only starts when the frontend build is configured with `VITE_INSUITE_ENABLED=true` **after** the Edge Function and DB migrations have been deployed and verified.

The source-code merge alone does not install database migrations or enable guest orders, payments or kiosk locking. The Admin tab remains restricted to its pre-existing permissions; top-management manager accounts, including Anu_000, can manage In-Suite property settings for their authorized organization without becoming global super-admins.

## Required staging deployment sequence

1. Create or select an **isolated staging Supabase project** with sanitized test rooms/reservations and appropriate environment URLs. Do not point staging frontend back at production.
2. Review and apply migrations, strictly in order:
   - `20261108210000_insuite_guest_service_foundation.sql`
   - `20261109075500_insuite_checkout_and_staff_alerts.sql`
   - `20261109082000_insuite_orders_and_bookings.sql`
3. Inspect Supabase Data API settings and verify new tables/RPCs are exposed **only to the intended server role**; check RLS/grants, tenant isolation, and no sensitive data leaked via the browser.
4. Set a secure, randomly generated `INSUITE_PIN_PEPPER` (minimum 32 chars) in staging Edge Function secrets. Retain and back it up securely: rotation invalidates all existing staff PIN hashes.
5. Deploy `insuite-api` to staging with `verify_jwt=false`, as it verifies its own device bearer and staff JWT authorization for each action. Confirm request rate limits, device pairing and cross-tenant rejections. Never put service-role credentials in the app.
6. Verify `hotelcare_dispatch_push` dependencies and install/check the named `pg_cron` job `insuite-escalation-1m` exactly once. Test the job without modifying hotel cleanliness/room assignment.
7. Deploy frontend with staging-specific Supabase URL, then activate **one test hotel only** by saving and publishing verified hotel content and menu. Ensure all non-existent facilities are switched off.
8. Pair a dedicated test tablet at `/suite`, check active reservation binding, staff and guest chat, requests, cleaning card, order quotes, booking approvals, and session reset after actual HotelCare and Previo checkouts.
9. For real devices, separately configure **Android Enterprise Lock Task Mode** or **supervised iPad Single App Mode** via approved MDM; test full-screen, app restart, power cycle, offline mode, physical controls and authorized staff maintenance.
10. Pilot with 2–5 devices, live-shift test scripts, a clear reception telephone fallback, and daily guest-support review. Only promote to production after security/privacy/ops approval.

## Acceptance test checklist

| Scenario | Expected result |
|---|---|
| Unpaired or revoked tablet sends a guest request | Rejected without data leakage |
| Device mapped to Room A attempts to control Room B | Room A identity remains server-bound |
| Tablet with no current checked-in reservation | Content available, guest transactions disabled |
| HotelCare checkout or room move | Only the old reservation's session rotates |
| Verified Previo checkout with exact source reservation ID | Matching tablet session rotates |
| Late/ambiguous Previo checkout from earlier guest | Cannot reset the next guest's session |
| Checkout races with an order/chat/request INSERT | Reject invalid session, no post-checkout operation |
| Employee in another organization/hotel receives API request | Denied |
| Cleaner is off-shift | Request remains available to manager for reassignment |
| Manager assigns work to on-duty authorized staff | Durable alert and priority card |
| Same client request UUID retried | One service request/order/booking |
| Menu item price changes after guest submits order | Historical item snapshot and quoted total remain stable |
| Mixed-currency guest basket | Rejected |
| Staff declines an unavailable facility slot | Guest sees declined status; no booking charged |
| Staff confirms a food order | Guest sees confirmed; no folio charge posted |
| Browser push is denied/offline | Persistent alert remains visible on staff inbox after reconnect |
| Guest session reset during chat | Previous guest's thread not shown in current epoch |
| Disconnected tablet later reconnects | No data from previous guest's session |
| Draft changes not published | Guest sees prior published content |
| Wrong PIN five times | Maintenance PIN lockout |
| Tablet exits OS app | Restricted by configured MDM, not by website alone |

## Remaining engineering work (not claimed complete)

- Direct real-time private channel events, robust reconnect handling and assured notification routing across shifts.
- Verified staff delivery receipts, alert escalation acknowledgement, manager SLA metrics and business-hours scheduling.
- Kitchen/KDS/POS integration, service fees/VAT, paid transaction authorization, Previo guest folio posting and payment reconciliation.
- Provider APIs and inventory for confirmed spa, gym, taxi bookings. Currently **request → staff verifies externally → manually confirms**.
- Automatic room-content localization, hotel-specific accessibility, broader translation coverage, and editorial verification of facts gathered from public internet sources.
- Dedicated MDM enrollment/device lockdown policies (cannot be implemented securely by website JavaScript or a six-digit PIN).
- A grounded, budget-controlled AI concierge with approved property knowledge and human escalation.
- Integration tests against an isolated staging database, full SQL migration execution, tenant/RLS checks, real hardware and reservation-sync scenarios.

## Non-production status

All work in this PR is a proposed code change. Production HotelCare Supabase and existing pricing/housekeeping workflows are intentionally unchanged. **Do not merge, deploy, enroll live tablets or enable guest payment flows without completing staging verification.**
