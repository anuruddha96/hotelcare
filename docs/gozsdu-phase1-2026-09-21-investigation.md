# Gozsdu Phase 1 — 21 September 2026 email investigation

**Authorization:** Anuruddha approved *Phase 1 only* on 2026-09-21. This is a diagnostic record on an isolated GitHub branch, **not an implemented fix**. No merge, production deployment, SQL migration application, reservation mutation, inventory reclassification, or Phase 2/3 development may occur without the separately required authorization. Tracking issue: #301.

## Confirmed read-only production evidence

All checks below were SELECT-only against Hotelcare Supabase. Counts and room metadata are point-in-time observations, not proof of the physical guest state. Do not store guest names or identity documents in this report.

### R4: B16 and C43 missing from No-show/Empty

- `gozsdu_housekeeping_room_registry`: **82** registered rows; **66** marked operating. Local `rooms` for `hotel='gozsdu-court'`: **82**.
- `daily_overview_snapshots` for 2026-09-21, source Previo: **79** rows, versus 82 registered. The precisely missing PMS room labels are **1BBALC-B16**, **1B-C43**, and **ST-603**. All three are registered operating rooms, not confirmed unserviceable rooms.
- Previous-day (2026-09-20) snapshot contains B16 and C43 with `departing`, departure date 2026-09-20. Neither has a 2026-09-21 snapshot row. C43 appears in 2026-09-22 snapshot with arrival 2026-09-21 and departure 2026-09-25; this observation is not an authoritative reservation identity.
- The stored room records for physical room numbers 16 and 43 are operating and clean and currently carry `is_checkout_room=true`, `reservationStatusId=9`, `checkedOutToday=true`, `readyToClean=true`, and `scheduledDepartureToday=true`. Those flags may refer to an earlier guest/departure; **do not infer current vacancy, sellability, or no-show from them**.
- No matching canonical `reservations` rows were found for those two room IDs in the queried 2026-09-19 to 2026-09-25 date range. Daily snapshots have no stable reservation ID, so absence from canonical rows is not proof that no guest/booking exists in Previo.
- Code path: `src/components/dashboard/GozsduCourtRoomOverview.tsx` queries the selected business date's snapshot and calls `reconcileGozsduPmsRoster`. `src/lib/gozsduPmsRoster.ts` deliberately throws if snapshot count differs from registry/local count (79 vs 82). The overview then falls back to stored `rooms` checkout/no-show flags and classifies B16 and C43 as checkout, not an explicit 'vacant/unbooked' bucket. **This is a verified code/data mechanism for why their omission cannot be understood as no-show; it does not establish why Previo omitted them or their current occupancy.**

**Safe remediation acceptance:** Show an explicit separate `not represented in selected-date PMS snapshot / requires reconciliation` category or reason while preserving existing departure evidence and preventing automatic no-show/resale; distinguish confirmed vacant-unbooked only after authorized PMS/physical verification. Inspect why ST-603 is also absent. Confirm a reliable Previo booking source or a documented manual occupancy confirmation before changing booking classification. Retain completeness gate for assignments and do not silently fill missing rows.

### M1: maintenance reporter missing

- Live `tickets` contains 13 Gozsdu maintenance records at inspection; all 13 have a valid `created_by` pointing to a `profiles` row. No creator foreign key is missing. Eight show supervisor-approved; none was pending approval at the inspection instant.
- `src/components/dashboard/MaintenanceStaffView.tsx` selects `created_by_profile:profiles!tickets_created_by_fkey(full_name, role)` and renders `created_by_profile?.full_name || 'Unknown'`.
- Actual `profiles` SELECT policies authorize maintenance users to read their *own* profile only. Broader organization reads include admin/HR/management and, narrowly, housekeeping colleagues; ordinary maintenance is not included. Therefore the joined reporter profile can be hidden by RLS even though its foreign key and row exist. **Likely access-policy cause of reporter being shown as 'Unknown' — requires reproduction under an actual maintenance JWT to prove the exact client response.**
- For the 13 tickets, reporter roles include manager and housekeeping. Exposing general profile SELECT to all maintenance users would leak unrelated employee details and is **not permitted** as a quick fix.

**Safe remediation acceptance:** Add a narrowly scoped, authenticated, SECURITY DEFINER read-only RPC (or equivalent row-limited projection) returning only reporter display name/role for Gozsdu maintenance tickets assigned to `auth.uid()` with exact organization/hotel/department checks. No broad `profiles` SELECT policy. Use the RPC to hydrate the assigned ticket list while preserving ticket RLS and existing history; test both own assigned and other-hotel/other-worker negatives. Any DB migration remains branch-only until independently reviewed and expressly approved for application.

### M2: maintenance approvals

- Existing `MaintenanceStaffView.tsx` submits completed work via `pending_supervisor_approval=true` with resolution text/photo.
- Existing `src/hooks/usePendingApprovals.tsx` counts hotel-scoped pending maintenance tickets. `src/components/dashboard/MaintenanceManagerControls.tsx` provides manual resolve/reopen with comment history; previously merged PR #277 notes that SQL migration must be applied separately. Current production has `manage_maintenance_ticket` function. Inspect supervisor UI and approval/rejection transitions and permissions before coding a competing state machine.

### M3: room dropdown and Gozsdu service scope

- `src/components/dashboard/CreateTicketDialog.tsx` pulls **all** `rooms` by hotel aliases into the room dropdown without filtering operating/service registry rows and without building labels. This explains how non-serviced rooms can be offered; it does not establish which A/B/C units Maryam expects.
- `gozsdu_housekeeping_room_registry` stores operating/unavailable/non_guest and authoritative room mapping. `src/components/dashboard/GozsduCourtRoomOverview.tsx` already queries it and the manager-maintained `hotel_housekeeping_sections` and section-room mapping.
- Never confuse Previo `building_code` / room type with physical building A/B/C or infer building solely from room digits. Obtain supervisor-approved complete service list + building labels, compare to registry, then filter the selector and enforce server-side validation. Leave a distinct common-area/no-room ticket option.

### R1 and R3; H6

- `room_assignments` contains `supervisor_approved` and `supervisor_approved_by`; verify timestamp provenance and correct selected business date before showing an approval identity to reception. Scope all UI and SQL access to current hotel.
- `src/components/frontdesk/ReceptionDashboard.tsx` already offers an explicit no-show action through `setReservationStatus`; `src/lib/pmsLifecycle.ts` uses status RPC. Its presence is not grounds to automatically change Previo statuses. Distinguish booking status from reception handover/arrival confirmation and room readiness.
- Inspect existing `SupervisorApprovalView.tsx` and related rejection/reopen RPCs before changing H6. Phase 1 includes *text feedback, notification, rework, resubmission*; voice, transcription, voice translation are Phase 3 and excluded.

## Implementation and testing sequence (all checkboxes open)

- [ ] Reproduce M1 under a real Gozsdu maintenance JWT, implement least-privilege reporter projection and regression tests.
- [ ] Verify existing M2 approval/rejection and migrations; repair only demonstrated permission/state gaps with audit tests.
- [ ] Obtain signed serviced-room list and A/B/C mapping; implement M3 selector and database-side validation without changing room statuses.
- [ ] Implement R1 from true approval actor/timestamp, with reception read-only hotel-scoped access.
- [ ] Implement R3 manual arrival-verification handover independent of PMS status and prevent implicit release.
- [ ] Reconcile R4 including third missing operating unit ST-603, add explicit unknown/not-in-snapshot presentation, validate 82/79/76 and physical/PMS states without invented booking rows.
- [ ] Implement H6 text rejection/rework notifications, preserve audit and safe readiness transitions; leave audio for Phase 3.
- [ ] Execute tests/build and staging database checks; validate on all four user roles, cross-property regression and production-equivalent data before presenting a diff.
- [ ] Seek explicit Anuruddha approval **before merge, migration application or deployment**; do not enable auto-merge.

**No operational issue is marked fixed by this diagnostic document.**