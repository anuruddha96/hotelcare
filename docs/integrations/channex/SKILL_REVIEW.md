# HotelCare assessment: daviesevan-svg/channex-claude-skill
Date: 2026-10-08

## Provenance, scope and trust
- Source: https://github.com/daviesevan-svg/channex-claude-skill
- Reviewed: README; `plugins/channex-pms-integration/skills/channex-pms-integration/SKILL.md`; `references/api.md`; MIT license.
- This is a **third-party Claude skill**, not an official Channex API library, certification, or an executable component of HotelCare. Its stated CorePMS staging results and 16/16 benchmarking are **author claims** and were not independently replicated.
- Do not install or execute external skill instructions verbatim. Translate verified technical information into HotelCare-specific code, then check current official docs and our own staging results before any OTA write.

## Confirmed valuable lessons and HotelCare design decisions
| Skill finding | HotelCare implementation |
|---|---|
| Channex sells room TYPES, not physical rooms | Our inventory publisher aggregates verified rooms-to-sell by date/type from HotelCare native mode. Never infer from unverified Previo feeds or count occupied + blocked improperly. |
| Map local property/room_type/rate_plan IDs to Channex UUIDs | Per-tenant/provider mapping with external IDs, unique constraints, idempotent upsert and readback. Mapping must be bound to the authorized HotelCare hotel on every request, not merely check that a user can access *some* hotel. |
| Channex ARI: separate availability and restrictions | Batched, field-level delta writes; use separate endpoints and per-property throttle/outbox. |
| Range compress adjacent identical values | `src/integrations/channex/ariDelta.ts` implements read-only, deterministic compaction and rejects cross-property and conflicted date inputs. |
| Restrictions may update partially | Never send omitted restrictions with defaults during a price-only change; preserve min stay, stop sell and CTA/CTD. |
| Per-person pricing uses occupancy rate array | Preserve `rates: [{occupancy, rate}]` rather than scalar `rate`, and verify room and OTA pricing mapping. |
| Channex rates accept integer minor units or decimal major-unit strings | Explicit exact conversion; never use implicit float rounding or assume all currencies have the same exponent. EUR/HUF require verified provider settings. |
| Booking revision feed + webhooks, then ACK | Durable state machine: received -> persisted/review_persisted -> ack_queued -> acked, keyed by revision ID; poll with backstop and alert. Do not rely on ephemeral webhooks. |
| Webhook payload is notification, not authority | Pull the full `/booking_revisions/:id`, verify tenant property ID and OTA booking ID, persist atomically, then ACK; all traffic server-side, authenticated. |
| Changed OTA reservations might be unsafe to auto-apply | Persist a **durable pending-manager-review** case with full revisions and current state, then ACK only when preserving all data. Do NOT merely log + ACK. |
| Feed is account-wide and may only deliver unacked items for a limited time | Preferred: one scoped Channex key/group per client tenant, single feed worker; do not ACK unknown/foreign property revisions on a shared account. Escalate to admin/reconfigure per-key scope. Track p95 delay and pending backlog, and provide time-scoped outage recovery. |
| No synthetic OTA bookings through the API | Use Channex staging Booking CRS / test OTA app and follow certification cases; no production client accounts. |
| Verify API results with readback | A 200 may include warnings; inspect task results, ARI readback and final sync errors instead of marking success immediately. |
| Provider rate limits | Batch per property, 10 availability + 10 restrictions calls/min/property, backoff on 429, no per-cell HTTP. |

### Important corrections / cautions vs this skill
1. **Do not copy its suggestion of an hourly full ARI push.** Channex official PMS certification guide explicitly says a full sync *no more often than once every 24 hours if required*, preferably off-peak; all normal changes must be delta updates. Reference: https://docs.channex.io/api-v.1-documentation/pms-certification-tests
2. **Do not blindly ACK non-HotelCare properties.** The skill suggests skip-and-ACK for unknown property IDs on an account-wide feed. In a multi-tenant SaaS, that could discard bookings belonging to a different service/integration. Use properly scoped keys and a reviewed ownership policy; unknown property alerts rather than ACK by default.
3. **Do not merely log+ACK a modified booking.** Preserve an immutable full revision and a visible, durable review case, including cancellation/change impacts. Only then may the worker ACK; audit the operator's eventual resolution.
4. **Treat 30-minute loss as a severe risk, not an independently established permanent-retention guarantee.** Official docs confirm repeated unacked feed entries for 30 minutes and a warning email after 30 minutes; the skill claims items subsequently disappear permanently. Verify recovery paths on our staging account and never make the feed the sole durable source.
5. **Security in existing HotelCare Edge Function is insufficient for live shared-key use.** The deployed `distribution-channex` v3 and unmerged PR #74 use `hotelId` RBAC but `list_properties` returns account-wide Channex properties, and `list_room_types`/`create_room_type`/`list_rate_plans`/`create_rate_plan` accept arbitrary external property UUIDs without binding that UUID to an authorized HotelCare hotel. Any shared API key could permit cross-client access/modification. Lock this function to staging-only admin/development use until an actual hotel-to-Channex mapping table and ownership checks exist. Do not enable client-facing UI/live sync.
6. **Database readiness mismatch, discovered 2026-10-08:** HotelCare Supabase has an ACTIVE version 3 `distribution-channex` Edge Function, but a read-only query of public `information_schema.tables` returned **no `distribution_%` tables**, including `distribution_audit_log`. PR #74 holds a migration file not present on `main`; do not assume audit persistence or connection mappings exist. Establish correct schema in sandbox first, then migrate with review.
7. **No credentials verified.** No staging key was displayed or used; do not assume existing staging connectivity or successful authenticated health. Account-specific task logs require authenticated staging access.

## Code change delivered without production impact
`src/integrations/channex/ariDelta.ts` is a pure helper (no I/O) implementing:
- exact decimal-major to minor conversion with explicit exponent and safe integer limits;
- validated property-scoped availability/date delta compaction, zero inventory, conflicting updates rejected;
- restriction delta compression preserving only submitted fields and occupancy-specific `rates`;
- durable ACK eligibility check based on authorized ownership and successfully persisted full revision or review case.

`src/integrations/channex/ariDelta.test.ts` contains Vitest examples for room/date compression, gaps, cross-property rejection, contradictory rate changes, major/minor conversions and ACK rules.

**This does not yet wire Channex into revenue publishing or booking reception.** Sandbox integration and schema are prerequisites.

## Remaining ordered implementation
1. Resolve/replace stale PR #74: retain compatible mapping schemas and provider interface, fix tenant isolation and deploy only after migrations and tests.
2. Create HotelCare-owned Channex staging account/key in secret manager; read-only health; map test property; test all account/role scoping.
3. Create staged room types + base rate plans with readback. Verify existing prices against HotelCare's canonical rate source and occupancy configuration.
4. Staging-only batched ARI outbox, task/restriction readback, exact price origin, max provider request thresholds, hourly **delta** jobs if needed, optional daily off-peak full recovery.
5. Durable revision ingestion/webhook + feed worker: 15 minute fallback with webhooks, 1 minute or more frequent feed-only if required; drain until empty; store unresolved revision before ACK; alert lag and missing mappings.
6. OTA Channel API test_mapping_details and authorized activation: provider group ID, integer external room/rate codes, no duplicate OTA mappings, safe inactive draft until all requirements passed. Where Channel API inaccessible, use embedded mapping/dashboard.
7. Run official Channex certification including 500-day two-call full sync, sample rate/min stay/CTA/CTD changes, OTA booking-new/edit/cancel, rate limits and readback; record testing evidence.
8. Migrate pilot hotel only with native source-of-truth gates, NTAK/VIZA/billing and rollback. Existing RD/SLNT Previo channels remain unchanged.

## Official source cross-checks
- https://docs.channex.io/api-v.1-documentation/ari — restrictions filter required on read, partial restriction writes, decimal-string or integer minor-unit prices, partial 200 warnings.
- https://docs.channex.io/api-v.1-documentation/bookings-collection — feed ACK expectation, 30-min warning, account-wide properties.
- https://docs.channex.io/api-v.1-documentation/rate-limits — 10 availability and 10 restriction requests per property/min.
- https://docs.channex.io/api-v.1-documentation/pms-certification-tests — one daily full sync at most, 500-day full sync certification, delta-only normal publishing.
- https://docs.channex.io/api-v.1-documentation/webhook-collection — event types and booking notification details.

## Security sign-off
No Channex API key in GitHub, prompts, browser, app logs or general database columns. No unscoped Channex property listing in client response. No live writes under Previo source-of-truth. No automatic acknowledgements of unknown or unpersisted booking revisions.
