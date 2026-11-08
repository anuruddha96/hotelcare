# HotelCare In-Suite — implementation and guarded rollout

**Date:** 2026-11-08
**Branch:** `feature/insuite-guest-tablet-mvp-20261108`
**Status:** Pilot code, NOT approved for production / full hotel rollout.

## Working code in this change
- `/suite`: room tablet pairing screen (one-time, 15-minute code), branded guest screen, Wi-Fi and property information, service requests, reception chat, request tracking, EN/DE/HU selection and app-level maintenance PIN.
- `/:organizationSlug/insuite`: top-management / hotel-admin draft and publish controls; per-room pairing, staff PIN, tablet inventory, session reset and revocation; reception chat; guest-service work queue.
- Housekeeping: a separate **priority guest request** card above the existing room-cleaning dashboard, without modifying room cleaning states or Previo.
- Reception: direct navigation to the guest console from the reception home.
- Storage: dedicated tables for property configurations, devices, service requests, request-event history and chat; RLS enabled, direct anon/auth access revoked.
- Backend: `insuite-api`, one endpoint with server-checked staff JWT and tenant/hotel privileges or a hashed device token. PIN and pairing hashes never returned.

## Production deployment order — do not skip steps
1. Review the new SQL migration and the RLS/grant behavior in an isolated staging Supabase project.
2. Deploy the SQL migration. Check table and index creation. Configure the secret `INSUITE_PIN_PEPPER` (random, at least 32 characters) in the staging Edge Function environment; keep it private and back it up securely. Rotating it requires issuing new staff PINs.
3. Deploy `insuite-api` with `verify_jwt=false`; the function **must** authenticate every action internally, not rely on the route being hidden.
4. Deploy the frontend to staging. Verify that `VITE_SUPABASE_URL` or `VITE_SUPABASE_PROJECT_ID` points to staging.
5. As top management, select a staging hotel at `/rdhotels/insuite`, save a draft, check the source facts and publish.
6. Create a room tablet code, record the one-time maintenance PIN securely; pair the tablet at `/suite`.
7. Test a guest request, verify its route to the on-shift cleaner, and process it all the way to completion.
8. Send a reception message and reply. Test session reset before handing the tablet to the next guest.
9. Install and configure Android Enterprise dedicated-device Lock Task Mode or supervised iPad Single App Mode using an approved MDM.
10. Only then run a 2–5-device pilot with staff training and a clear fallback to telephone/reception.

## Important operational limits

This is a **pilot foundation**, not a finished concierge product.

**Not yet implemented:** automatic reservation/PMS checkout-triggered session reset, verified guest-name display, server-driven push/realtime transport, guaranteed notification delivery/escalation after shift changes, approvals integration, paid breakfast/room-service checkout, kitchen capacity or room charge posting, facility inventory and confirmed spa/taxi bookings, SIP/WebRTC voice calling, automatic public-information seeding and verification, OS-level kiosk restriction through MDM, translated property-content editing, and billing/licensing.

**Security gate:** Because automatic checkout reset is not yet integrated, front desk MUST reset each room tablet session immediately at checkout. Do not enable guest chat on unattended production tablets until this is automated and tested. Existing session messages are filtered to the device's current epoch and current page load, and management can rotate epochs manually.

**PIN caveat:** The in-app PIN only opens a staff maintenance information dialog. It cannot stop exiting, powering down, factory-resetting, or overriding operating-system settings. Only supervised/kiosk-managed hardware can enforce device restrictions.

**Connectivity:** Pilot uses background polling (20 seconds guest / 15 seconds staff), not a durable push-delivery guarantee. Requests and chat are persisted in the database, so staff can retrieve them on reconnect. A realtime event stream with server queues and escalations remains required before production.

**No paid charging:** The guest currently sees dining/minibar information only. The interface explicitly directs paid orders to reception. Never present a paid confirmation without charge-to-room reconciliation or payment.

## Acceptance test matrix

| Test | Expected result |
|---|---|
| Unpaired device calls guest API | 401, no room or property data |
| Invalid, expired or reused pairing code | 404/409, no token |
| Staff creates device for another tenant's room | Rejected, no token |
| Room A token requests Room B | No client-controllable room identifier; server uses device binding |
| Another hotel's receptionist opens first hotel's queue | Forbidden |
| Revoked device sends message | Rejected |
| Repeated identical guest request UUID | One record, same receipt |
| Flooding requests/messages | Server returns 429 |
| Wrong maintenance PIN five times | 15-minute lockout |
| Guest requests towels while cleaner signed in | Priority card on correct cleaner's My Tasks |
| Cleaner is off shift | Request stays visible as unassigned for management |
| Cleaner marks delivered | Guest request shows Completed; room cleanliness unchanged |
| Staff replies to current guest | Chat message appears in that room |
| Previous guest checks out | Staff rotates session; old chat becomes inaccessible to guest |
| Service is disabled for property | Service absent; API rejects new requests |
| Draft saved but not published | Guest tablet still sees published content |
| Property logo/brand changed | Correct property only, no cross-hotel leak |

## Future milestones
1. Integrate durable, transactionally consistent request/task dispatch with the existing Housekeeping and Approval workflows and proper notification fan-out.
2. Add real-time private events + offline retry queue + acknowledged SLA/escalation service.
3. Implement PMS-confirmed check-in/out and verified guest identity only with privacy-preserving room-session binding.
4. Add service availability and workflows for breakfast/food, minibar, transport, spa, sauna, gym, and partner providers.
5. Implement MDM-based device inventory, lock mode and remotely managed support.
6. Launch data-driven, admin-approved hotel FAQ/AI concierge, using budget controls and explicit human handoff.

No production mutation is performed by committing this branch. The feature is disabled by default until a hotel admin publishes verified content and pairs a specific tablet.
