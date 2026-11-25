---
name: hotelcare-channex
description: Safely develop and test HotelCare PMS channel management with Channex staging: tenant/property mapping, ARI deltas, booking revisions, certification and rollback.
---

# HotelCare × Channex: development discipline

This skill is a **project-specific, reviewed adaptation** of the MIT-licensed third-party reference at https://github.com/daviesevan-svg/channex-claude-skill . It does not install code, authenticate to a provider, or grant authority to modify live OTA inventory.

## Before proposing changes
1. Read `docs/integrations/channex/SKILL_REVIEW.md` and `docs/integrations/channex/STAGING_READINESS.md`.
2. Read the official Channex docs linked there; the external skill may be stale. Compare claims about rate units, booking feed retention, payload shapes, and certification with official documentation and staging responses.
3. Inspect HotelCare's CURRENT `main`, its PMS/revenue source-of-truth, `src/pages/ChannelManager.tsx`, current calendar/publishing, and the status of draft `feat/distribution-foundation` PR #74. Do not assume unmerged code is in production.
4. Check existing Supabase migrations and deployed Edge Functions **read-only** before changing anything. As of 2026-10-08 the `distribution-channex` Edge Function existed but the `distribution_%` tables were absent.
5. Never use live Previo, YieldPlanet, OTA or Channex accounts for fixtures, and never test real credentials in chat or public repo.

## Mandatory integration sequence
- A. Credential-scoped STAGING-only GET health probe through server-side secret storage.
- B. Per-tenant HotelCare hotel → Channex property → room-type/rate-plan ID mapping, persisted with unique constraints. Verify Channex property ownership on EVERY server operation, including list and create.
- C. Readback-backed property/room/rate plan content sync, idempotent updates (not duplicate remote objects).
- D. Batched ARI deltas (separate availability and restrictions); preserve omitted restriction fields; exact major/minor currency handling; validate source-of-truth mode and date/room mapping; compress equal contiguous ranges. Reuse `src/integrations/channex/ariDelta.ts` and its tests if present.
- E. Durable booking revision worker and authenticated webhook; fetch full revision; idempotent transaction; manager escalation for conflicting modifications; ACK only after booking/review record persisted; warn on >10 min lag and >25 min pending ACK; recovery by date after confirmed outage.
- F. Room/rate/occupancy mapping and OTA authorization, channel remains inactive until validated, never blindly activate.
- G. Official PMS certification 500-day two-call full sync, 30-minute feed handling and booking create/modify/cancel tests; production only after certification and owner approval.

## Non-negotiables
- Treat Channex's 200 as accepted/queued; inspect `meta.warnings`, task logs and readback before marking successful publication.
- Channex official limits: 10 availability and 10 restriction calls/minute/property; queue/backoff. Normal operations publish DELTAS. Full sync at most once every 24h when needed, off-peak, not hourly; follow official certification docs.
- Never ACK external property revisions just to drain an account-wide feed; isolate keys/scopes, hold/alert unknown properties. For changed bookings, save a complete durable review case before ACK if not auto-applied.
- Do not expose shared-key provider property lists or external property UUID CRUD to arbitrary hotel managers.
- Never overwrite Previo/YieldPlanet's source-of-truth while a hotel is connected to their channel manager.
- No PII/credit-card leakage to provider logs or AI prompts. Confirm currency/IVA/folio semantics separately.
- A Channex **staging** request is not a promise of a production integration. Use feature flags, tests and auditability.
- Follow project privacy/tenant security standards and existing PR review/merge gates. If staging key unavailable, build pure/testable code but report that live API tests were not performed.

## Success criteria
One opt-in sandbox property can (1) map valid rooms/rate plans, (2) push two date-scoped ARI deltas and verify readback, (3) receive new/edit/cancelled test reservations without duplicates or data loss, (4) recover from simulated webhook failure, (5) show clear Channex task and HotelCare audit results. No customer hotel is switched during development.
