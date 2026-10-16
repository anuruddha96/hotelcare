# Shared Queen/Triple room protection — deployment and rollback

**Approval boundary:** This branch is review-only. Do **not** merge,
deploy functions, apply the migration, run the SQL scheduler script, or
change Previo Rooms to Sell without a separate explicit approval.

## Existing Ottofiori linked pools (read-only snapshot, 2026-10-16)
- October 21: physical Triple `982615` ↔ additional Queen `976815`, 2 shared units, active.
- October 22: physical Triple `982615` ↔ additional Queen `976815`, 3 shared units, active.
- Physical room IDs were not reliably established by the current integration.
  Store verified *room-type provenance and counts*, never invent individual
  room assignments. Before enabling more shared dates, operations should
  verify the real room roster directly with Previo.

## New reconciliation
- An immutable activation baseline tracks confirmed booked room-nights
  (preserving multiple room items per reservation).
- A new confirmed booking in either linked category reduces both
  availability ceilings. Reclassification within the pair is not a new sale.
- Independent room-type pickup can reduce the *hotel-wide* physical
  ceiling, but must not be interpreted as a new linked booking.
- Repeated executions do not double-consume the pool. Previously reduced
  quantities never increase automatically after cancellations.
- Each pass takes the per-hotel, per-date lock *before* obtaining Previo
  bookings. It reads both linked categories even with no new pickup and
  corrects unexpected over-availability by closing the excess.
- On exceptions, the worker attempts to close the **alternative Queen**
  category, marks the rule as `needs_review`, and emails the admin.
  The original physical Triple remains untouched by that emergency step.
- This system is NOT an atomic OTA/channel-manager room lock and cannot
  guarantee avoidance of simultaneous independent online bookings.

## Production release sequence (separate approval required)
1. Merge tested PR with reviewed diffs. Ensure GitHub frontend tests/build pass.
2. Apply the schema-only migration, checking the existing watch rows remain
   unchanged in status, shared quantity and original baseline.
3. Deploy the activation and overnight-monitor Edge Functions with their
   relative `_shared` dependencies. Preserve their current service-role
   authentication settings and secrets.
4. Confirm active dates/room-category mapping/Previo availability via read-only
   checks. Test a full mocked sequence, and verify return-value reconciliation.
5. After explicit approval, configure Supabase Vault and run the opt-in SQL
   `supabase/manual/enable_linked_room_watch_1min.sql`. The current revenue
   scheduler continues a five-minute backup call.
6. Run read-only reconciliations first, then progressively enable protected
   live reductions and monitor alerts. Confirm on each change that Previo
   read-back matches the protected maximum.
7. Verify hotel wide capacity, channel availability, same-room multiday
   overlap, 21/22 October original source availability, incident escalation,
   and dashboard status. Document the activation and rollback IDs.

## Rollback
- Disable the **optional minute** cron without disabling the existing
  five-minute revenue scheduler:
  `select cron.unschedule('hotelcare-linked-room-watch-1min');`
- If protection malfunctions, close virtual Queen availability in Previo
  and verify read-back; do not re-open cancelled inventory blindly.
- Revert the function versions only under an approved rollback plan,
  keeping rule history and audit metadata.
- Require manager approval and live Previo availability verification before
  reactivating any shared listing.

## Provider constraints
- A minute-based scheduled check is only a *polling fallback*; it is not a
  booking event webhook. Previo push event availability has not been
  established for this integration and should be investigated separately.
- All writes must remain opt-in, tenant-scoped, and audited.
