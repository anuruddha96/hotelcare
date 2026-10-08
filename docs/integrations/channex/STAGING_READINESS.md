# Channex integration readiness — HotelCare PMS (8 October 2026)

**Status: staging documentation + a read-only smoke-test helper only. NOT connected, certified, or enabled for production.**

## Existing HotelCare architecture: reuse, do not duplicate
- Strategic scope: [#551](https://github.com/anuruddha96/hotelcare/issues/551), [#553](https://github.com/anuruddha96/hotelcare/issues/553), Channex delivery [#556](https://github.com/anuruddha96/hotelcare/issues/556).
- Existing distribution foundation [PR #74](https://github.com/anuruddha96/hotelcare/pull/74) is an unmerged, currently non-mergeable draft on `feat/distribution-foundation`, not available on `main`. Contains `src/integrations/distribution`, secure connection metadata and `supabase/functions/distribution-channex`. Rebase/review its approach and security; avoid wholesale cherry-pick until re-evaluated.
- Current main has a separate `src/pages/ChannelManager.tsx` that creates **inactive drafts** and retains Previo as the inventory master. Do not treat a connection draft as live.
- On 2026-10-08, the Hotelcare Supabase project returned an **ACTIVE** deployed Edge Function named `distribution-channex`, version 3. The runtime already contains staging URL and env-based key logic, but staging credentials and successful authenticated API calls have **not** been verified. No matching invocations were found in one recent read-only query (not exhaustive). Production deployments must not be inferred from open PR files.

## Channex official documents
- [Integration start](https://channex.io/start-integration)
- [Docs index + Postman collection](https://docs.channex.io/)
- [PMS integration guide](https://docs.channex.io/guides/pms-integration-guide)
- [API reference/auth](https://docs.channex.io/api-v.1-documentation/api-reference)
- [Properties](https://docs.channex.io/api-v.1-documentation/hotels-collection)
- [Room types](https://docs.channex.io/api-v.1-documentation/room-types-collection)
- [Rate plans](https://docs.channex.io/api-v.1-documentation/rate-plans-collection)
- [Availability / rates / restrictions](https://docs.channex.io/api-v.1-documentation/ari)
- [Booking revisions and ACK](https://docs.channex.io/api-v.1-documentation/bookings-collection)
- [Webhooks and security](https://docs.channex.io/api-v.1-documentation/webhook-collection)
- [Rate limits](https://docs.channex.io/api-v.1-documentation/rate-limits)
- [Property Task logs](https://docs.channex.io/application-documentation/property-tasks)
- [Certification tests](https://docs.channex.io/api-v.1-documentation/pms-certification-tests)
- [Booking.com staging test accounts](https://docs.channex.io/guides/test-account-for-booking.com)
- [Airbnb staging requirements](https://docs.channex.io/guides/test-accounts-for-airbnb)

## Sandbox user action (account access required)
1. Create or sign in to a HotelCare-owned organization at **https://staging.channex.io/**. Staging is free; the live subscription is a separate commercial decision.
2. Create a **staging-only API key** (check Organization > API Keys or staging user-profile link as the UI may vary). Make it scoped appropriately. Save only in server-side Supabase secrets or a private secret manager, never browser code, Github issues, PRs, email or chat.
3. Read-only smoke test, on a trusted server/terminal with env `CHANNEX_STAGING_API_KEY` set:
   ```bash
   node scripts/distribution/channex-staging-check.mjs
   ```
   This performs only `GET https://staging.channex.io/api/v1/properties?pagination[page]=1&pagination[limit]=1`, prints status/property count, never changes inventory or bookings and never prints API keys/property/guest details.
4. Check that the staging account can create a **separate test property**, two room types and four rate plans using the official certification fixture (Twin/Double rooms, BAR + Breakfast, as documented in the certification test); do not create on a live customer account.
5. Channex's shared Booking.com test properties include **4372137 in EUR** (check current availability; test IDs can be reclaimed). Only attempt OTA testing after correct room + rate-plan mapping and channel activation. Another shared ID can reject because another developer has it connected.
6. Airbnb staging: Channex requires **two Airbnb Host IDs** registered as test accounts. Coordinate with Channex support. Do not create real-world Airbnb exposure inadvertently.

## Verified staging endpoints and contracts
| Action | Method / path | Notes |
|---|---|---|
| List properties | `GET /api/v1/properties` | Use `user-api-key` header; pages default to 10; max 100. |
| List rooms | `GET /api/v1/room_types` | Filter by Channex property UUID. |
| List rates | `GET /api/v1/rate_plans` | Use Channex property UUID and mapping. |
| Room availability | `GET /api/v1/availability` | Property and date range filters; room-type quantity. |
| Rate / restrictions | `GET /api/v1/restrictions` | Property, dates and fields (rate, min stay, stop sell etc). |
| Write availability | `POST /api/v1/availability` | **STAGING ONLY** when authorized; batch per property; no client direct calls. |
| Write rates/restrictions | `POST /api/v1/restrictions` | **STAGING ONLY** when authorized; can return HTTP 200 with per-item `meta.warnings`: not full acceptance. Rate may be a decimal string or minor-unit integer. |
| Read booking changes | `GET /api/v1/booking_revisions/feed` | All-property backup poll every 15–20 min; separate webhook for low latency. |
| Read one revision | `GET /api/v1/booking_revisions/:id` | Revision ID, status new/modified/cancelled, unique OTA reservation identity. |
| Acknowledge persisted revision | `POST /api/v1/booking_revisions/:id/ack` | **Only** after durable successful HotelCare commit; otherwise feed will repeat. |
| Webhooks | See Webhook Collection | `booking`, `ari`, `sync_error`, `sync_warning`, `rate_error`, unmapped booking alerts. |

All paths above are relative to `https://staging.channex.io`. Not every API feature is available on every OTA. HTTP 200 for ARI means acceptance/queuing, not proof the OTA shows the new rate; retain task IDs and independently verify.

## Logs: what can and cannot be viewed now
- Channex **Property Tasks** is the provider's activity log for availability, rate and restriction updates. It shows task type, UTC received time, waiting/execution durations, success flag and task details/JSON. View it **in the authenticated staging extranet** after a test operation. Without staging credentials and tasks there are no real Channex account logs to fetch.
- HotelCare should correlate every provider response `task.id`, property/channel ID, internal operation ID, affected period, duration, HTTP status, warnings, mapped room/rate IDs and readback. Never store API keys, raw credit-card details or guest PII in generic logs.
- Subscribe in staging to `sync_error`, `rate_error`, `booking_unmapped_room`, `booking_unmapped_rate` and `non_acked_booking` where supported. Channex webhooks **do not have built-in HMAC signatures**: configure a long random secret in custom webhook headers, HTTPS and optional allowlist. Do not expose unvalidated webhook.
- HotelCare's Supabase Edge Function logs are **not** Channex provider task logs; treat both separately in the eventual administrator UI.
- If a price write receives task ID but some rates fail later, show PARTIAL/FAILED and require reconciliation, do not mark COMPLETED solely by initial HTTP 200.

## Reliability controls before any write
- One inventory/ARI publisher per hotel: legacy Previo/YieldPlanet **or** HotelCare Native + Channex. Never dual-publish uncontrolled.
- Per-property batch (Channex recommends 30–60 seconds for many changes); availability and rates/restrictions are separate calls, full nightly refresh, <10MB payload. Rate limits listed as 10 availability and 10 restriction calls per property/minute; on 429 back off and retry safely.
- Every inbound booking revision idempotently keyed by OTA unique ID plus revision; use transaction, safe split/group reservation handling, currency/guest extensions, cancellations and source mapping; ACK only after commit.
- Inventory state = room type/date sellable stock adjusted for HotelCare reservations, room closures and existing external bookings. Importing future bookings via OTA may not itself reduce Channex stock; reconcile before first ARI publish.
- Synchronous webhook receiver responds rapidly but must **durably enqueue before HTTP 200**. Handle overbooking/conflicts in reconciliation and alert top managers rather than losing OTA messages.
- PCI-sensitive card handling remains out of general PMS API; use certified token/vault/payment provider path.

## First engineering PR sequence (after staging credentials are securely available)
1. Reconcile PR #74 with current main, ensure latest DB schema and no stale code; replace old `distribution-channex` only through tested non-production deployment.
2. Read-only **health/list_properties** API through a server-only role-scoped function; no raw secrets returned to browser.
3. Channex property, room type, rate plan create/map sandbox; log IDs and assert org/hotel scope.
4. STAGING-ONLY ARI outbox with source-of-truth gate, batcher, task-ID/warnings checks and readback.
5. Webhook with shared-secret validation, durable queue and idempotent reservation feed/ack worker; 15–20 min global fallback.
6. End-to-end certification scenarios through HotelCare interface, measured errors and screenshot/call evidence. Channex explicitly requires an application demo; Postman alone is insufficient.
7. Production partner terms, pricing/DPA, OTA owner authorization, Channex certification, controlled pilot; no auto-activation for RD/SLNT.

## Not yet established
- Staging account exists? **Unknown**.
- Staging API key set? **Unknown**; do not expose key while checking.
- Staging / provider logs? **Not retrieved**.
- Provider certified / booking channel mapping complete? **Not confirmed**.
- Existing PR #74 mergeable? **No**, open draft; needs independent remediation.
- Live OTA synchronization via Channex? **No confirmation**.
