# Gozsdu Phase 1 — 21 September 2026 investigation and branch-only changes

**Authorization:** Anuruddha approved Phase 1 only. No merge, deployment, production SQL migration, live room/reservation update, or Phase 2/3 implementation without separate explicit approval. GitHub issue #301 tracks all Phase 1 tasks. This document is not proof that production issues are fixed.

## Authoritative operating-room inventory: already mapped

Anuruddha confirmed that Team View > Hotel Room Overview > Map is the completed authoritative physical section mapping. A read-only query of the HotelCare Supabase database verified:

- 82 Gozsdu room records and 82 matching `gozsdu_housekeeping_room_registry` entries; each room belongs to exactly one `hotel_housekeeping_section_rooms` section, and none is unmapped or multiply mapped.
- 66 registry rooms are `operating`, all in ordinary active physical sections. Fifteen nonoperating rooms are in Team View section **Not available**, and one is in **Private Apartment**. Zero mismatches between these section categories and registry operating eligibility.
- Physical section names are manager-managed, not derivable from Previo prefixes or numeric room numbers. B16 is `1BBALC-B16` / **Kazinczy B**, C43 is `1B-C43` / **Kazinczy C**, and ST-603 is in **Holló 12**. All three are operating inventory.

**Do not request another room list from Maryam.** Use existing mapping and registry; never modify those live records simply to address a picker or booking-report issue. An operating room can nevertheless be occupied, reserved, blocked or not for sale.

### Branch-only room picker implementation — code committed, not yet tested

- `src/lib/gozsduMappedOperatingRooms.ts`: shared Gozsdu-only read model loads rooms + registry + active section names + section-room links through existing RLS, verifies completeness and consistency, filters nonoperating units and emits searchable PMS apartment and physical section labels. It rejects missing mappings, role visibility errors or ambiguous local room numbers rather than silently exposing all rooms.
- `src/components/dashboard/CreateTicketDialog.tsx`: Maintenance tab now uses the shared read model for Gozsdu, offers room/building search, excludes the 16 nonoperating units and revalidates the current map on submission. Explicit no-room common-area reporting remains available. Other hotels retain their existing queries.
- `src/components/dashboard/MaintenanceIssueDialog.tsx`: Housekeeping maintenance room dropdown uses the same shared read model when the staff user belongs to Gozsdu and no room was preselected, supports search and revalidates selected rooms. An explicit already-known room-card report remains possible when a room is unavailable and requires repair; no room status is changed.
- `src/lib/gozsduMappedOperatingRooms.test.ts`: unit tests added for mapped room labels, filtering, missing/ambiguous mappings and inconsistent states. **Tests have not been run in CI or on real devices.** The UI check is not a substitute for server-side authorization and full role RLS testing.

## Separate PMS snapshot discrepancy — NOT fixed by room mapping

- September 21 Previo `daily_overview_snapshots` contains 79 rows for 82 registered rooms. The missing operating units are B16, C43 and ST-603.
- September 20 snapshot shows B16 and C43 as departing that day; September 22 snapshot shows C43 ongoing for a stay beginning September 21. These rows have no stable external booking identity.
- B16 and C43 local room metadata has checkout-related flags. Those flags can be stale; neither this metadata nor being absent from a daily snapshot proves no-show, vacancy, sellability or physical occupancy.
- No canonical `reservations` rows matched B16/C43 IDs in the queried September 19–25 date range. This absence is not proof Previo lacks a booking.
- `GozsduCourtRoomOverview.tsx` currently invokes `reconcileGozsduPmsRoster`, which rejects incomplete snapshot coverage. The overview's degraded fallback then uses stored room flags. **R4 still requires a distinct `missing from PMS snapshot / requires reconciliation` presentation and verified booking data. Do not auto-cancel, release or label these units no-show.**

## Maintenance reporter access — diagnosed, still requires repair

All 13 Gozsdu maintenance tickets examined had valid reporter creator IDs and matching profile records, while current `MaintenanceStaffView.tsx` joins reporter profile information. Existing `profiles` SELECT RLS only exposes the maintenance user's own profile, not other employees' profiles; this is a likely cause of the reporter being shown as Unknown. Reproduce with actual maintenance credentials, then implement a narrowly scoped ticket-specific read projection. Never broaden all employee profile access.

## Other approved Phase 1 work remains open

- M2 maintenance manager/supervisor approval comments, rework/rejection and immutable audit: inspect existing `pending_supervisor_approval`, `manage_maintenance_ticket`, merged PR #277 and production migration before changing workflow.
- R1 reception visibility of actual supervisor approver and timestamp, with hotel/business-date permission scope.
- R3 distinct pending-arrival verification, audited shift handover, independently confirmed no-show and no implicit Previo cancellation or room release.
- R4 the separate PMS data/room status discrepancy above, and explicit unverified display.
- H6 housekeeping rejections with specific written feedback, notification, resubmission and preserved audit; audio transcription/translation excluded as Phase 3.

## Required before any release

Run tests/build, verify manager/reception/maintenance/housekeeping roles and cross-hotel RLS, confirm source PMS reservation truth, validate the picker on Gozsdu devices, and present diff/results/risks for Anuruddha's **separate explicit approval to merge or deploy**. No production mutation occurred during this investigation or branch code implementation.
