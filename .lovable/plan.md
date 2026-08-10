# HotelCare — Technical & Product Maturity Assessment

Read-only review. No code or database changes were made.

**Scale evidence:** ~127,700 lines of `src` TypeScript, 741 source files, 69 Supabase Edge Functions (~17,700 lines of Deno), 302 SQL migrations, ~120 database tables, 3 live organizations / 4 hotels, 53 staff profiles. Production data is real, not seeded: 7,775 room assignments, 58,859 rate-change audit rows, 6,144 revenue booking-nights, 423 breakfast attendance records, 238 attendance shifts.

---

## 1. Product modules genuinely implemented

Strong, in-production depth (real CRUD, realtime, RLS, live data):

- **Housekeeping** — the core asset. Auto-assignment algorithm, staged assignments, drag-and-drop team view, supervisor approvals, dirty-linen counts, DND photo enforcement, performance leaderboard. `HotelRoomOverview.tsx` (2,566 ln), `AutoRoomAssignment.tsx` (1,691 ln), `SupervisorApprovalView.tsx` (1,933 ln), `AssignedRoomCard.tsx` (1,762 ln).
- **Revenue Management** — flagship module. 27 components, rate grid, bulk price editor, pickup board, drafts/push pipeline, audit trail. `RateStrategyGrid.tsx` (1,872 ln), `RevenueHotelDetail.tsx` (1,542 ln).
- **PMS operations** — dual-file XLSX upload, unit alias resolution, change-diff drawer, sync history. `PMSUpload.tsx` (1,819 ln), `pmsRefresh.ts` (1,191 ln).
- **Maintenance / tickets** — SLA due dates, mandatory photos, closure validation enforced by DB triggers (`validate_ticket_closure`, `set_sla_due_date`).
- **Minibar** — public guest QR flow (`GuestMinibar.tsx`), placement/perishable tracking, write-back of charges to Previo.
- **Purchase invoices** — AI OCR extraction with Hungarian VAT line parsing, verification workflow (1,226 ln page).
- **Breakfast** — separate public app shell (`/bb`), roster upload, realtime served-marking, org-branded lookup.
- **Attendance / HR** — geolocated check-in/out, break requests, early sign-out approvals, auto-signout cron.
- **Training** — guided tours, curricula, assignments, analytics (V2 system, 30 files).
- **Admin** — org/hotel onboarding, user management, translation management, PMS config.

Thinner / partially built: **Front desk, Reservations, Guests, Channel Manager** (200–270 line pages, few supporting components) — functional shells rather than mature modules. **Training V1** is a 13-line stub superseded by V2 (two coexisting code paths).

## 2. Backend / Supabase architecture

~120 tables, RLS pervasive (146 migration files touch policies), security-definer helper functions for role and org resolution (`has_role`-style: `get_current_user_role`, `user_can_access_hotel`, `is_revenue_user`, `has_venue_access`). Business rules are enforced in the database, not only the UI — ~30 triggers and RPCs cover ticket closure, photo requirements, work-hour calculation, room status transitions, PMS change application, and rate-push auditing. That is a genuine architectural strength: rules survive client bugs.

Notable edge functions: `previo-pms-sync` (944 ln), `previo-revenue-sync` (868 ln), `generate-rm-intelligence` (802 ln), `previo-poll-checkouts` (773 ln), `previo-pull-revenue` (735 ln), `revenue-push-drafts` (406 ln), `process-purchase-invoice`, plus admin-privileged user functions (`admin-update-user`, `create-housekeeper`, `manager-reset-password`) and a notification family. Shared Deno libraries (`_shared/previoAuth.ts`, `previoCredentials.ts`, `previoRateWrite.ts`, `pmsDiff.ts`, `pmsNormalizer.ts`) show deliberate factoring rather than copy-paste functions.

## 3. PMS / Previo integration depth — the strongest moat

- **Read path:** XML API session auth, room/reservation/rate-plan/daily-overview sync, checkout polling, shadow-diff comparison, and four dedicated diagnostic probe functions.
- **Write-back is real and non-trivial.** `_shared/previoRateWrite.ts` documents that Previo's standard XML API refuses writes and implements the Expedia QuickConnect `AvailRateUpdateRQ` protocol by hand against `api.previo.app/eqc1/ar`, including the gap-free sequential-occupancy normalisation required to avoid Previo error 3092, plus read-back confirmation into `revenue_room_type_rates`. HotelCare also writes room status and minibar charges back to the PMS.
- **Resilience layer:** XLSX upload fallback when API access is unavailable, fuzzy unit-name matching, `pms_unit_mappings` staging with confirm workflow, multi-account aggregation (`pms_accounts`) so two Previo accounts render as one property.
- **Gap:** `slnt-pms-sync` is an explicit, self-documented stub (`stub_not_implemented`, `TODO(live-api)`); SLNT still depends on XLSX upload for live sync.

This integration is the hardest thing in the repo to reproduce — it encodes months of undocumented vendor behaviour.

## 4. Tenant / multi-hotel architecture and isolation risk

Model: `organizations` → `hotel_configurations` → rooms/staff, with URL-scoped `TenantProvider`, `assigned_hotel` + `organization_slug` filtering, per-tenant feature flags (`tenantFeatures.ts`, override-able via `organizations.settings`), and an SLNT-only venue layer (`venues`, `user_property_scopes`, venue-scoped RLS).

Risks a diligence team will find:

- **Hardcoded `'rdhotels'` fallback** appears ~45 times across 27 files, typically `profile?.organization_slug || 'rdhotels'` — including inside Supabase `.eq('organization_slug', …)` filters. Any profile-load race silently resolves to a real tenant. This is the single most serious isolation smell.
- **Free-text tenant keys.** Isolation depends on matching strings (`assigned_hotel`, `organization_slug`) rather than enforced foreign keys everywhere, with normalisation helpers (`normalize_hotel_name`, `get_hotel_id_from_name`) papering over inconsistency.
- **Tenant-specific branching in shared code** (`slnt`/`ottofiori` conditionals) — feature flags mitigate this but do not eliminate it.
- **Admin / top-management RLS is intentionally cross-org** in places, so a role-assignment error has wide blast radius.
- 302 migrations with heavy RLS churn indicates the security model was iterated repeatedly rather than designed once.

## 5. AI and revenue management — implemented vs aspirational

Implemented and wired to real providers (server-side keys only): `revenue-signals`, `revenue-ai-analyze`, `generate-rm-intelligence`, `revenue-events-fetch` (OpenAI direct); `process-purchase-invoice`, `previo-ai-import-rooms`, `translate-note`, `translate-room-types`, `analyze-assignment-patterns` (Lovable AI Gateway). Deterministic pricing logic is genuine code, not prompts: `revenuePricing.ts` (DOW / month / lead-time / occupancy-target / pickup-tier engine with clamping) and `demandPricing.ts`, both with unit tests. Rate drafts, batched pushes with cancel/retry, audit trail with per-cell history, and self-healing draft reconciliation all exist and are exercised (58.8k audit rows).

Closer to aspirational: `revenue-autopilot-tick` and `rm-measure-outcomes` exist but autonomous pricing is not demonstrably running unattended; competitor/market-rate intelligence is thin (`market_events`, `previo_reference_prices` are lightly populated); forecasting is rule-based, not learned. Marketing this as "AI revenue management" is defensible for decision support, not for autonomous yield optimisation.

## 6. Mobile/PWA, localization, auth/RBAC, notifications, reporting, training

- **PWA:** complete manifest, service worker with push + install prompt, dedicated mobile housekeeping views and mobile-first revenue grid interactions. Real field usage is the design driver (geolocation check-in, photo capture).
- **Localization:** very heavy — ~19,800 lines of translation data plus a 4,289-line translation hook, admin translation management, AI-assisted note translation, 5+ languages. Broad coverage, but implemented as hand-rolled flat tables rather than a standard i18n library — a maintenance liability.
- **Auth/RBAC:** centralised in `roleAccess.ts` with role sets (executive, manager-power, reception) plus DB-side role functions and a `user_role` enum incl. `supervisor`. Some ad-hoc `role === 'admin'` checks remain in components.
- **Notifications:** 29 Supabase Realtime channels driving cross-device sync, plus email/SMS/OTP functions and notification preferences.
- **Reporting:** embedded per-module (revenue export, performance leaderboard, attendance summaries, daily overview snapshots) — no unified reporting/BI layer.
- **Training:** guided tours, curricula, assignments, analytics, first-login prompts — unusually complete for a product this age, and a real onboarding accelerator for hotel staff turnover.

## 7. Maturity, technical debt, security and diligence risks

Strengths: DB-enforced business rules, factored shared PMS libraries, feature-flagged tenant divergence, security scans already run with findings remediated (RLS tightening, role-escalation guards, `search_path` fixes, org checks in privileged edge functions).

Debt and risks:

- **Test coverage is negligible:** 7 test files for ~128k lines of app code and 69 edge functions. Nothing tests rate write-back, room assignment, minibar billing, or RLS. This will be the loudest diligence finding.
- **No CI/CD, linting gates, staging environment, or error-monitoring vendor** evident (there is an in-house `client_error_logs` table only).
- **God components:** eight files over 1,100 lines mixing fetching, business logic and rendering; role/device variants duplicate logic.
- **Type looseness:** ~440 explicit `: any` annotations, mostly around Supabase results and JSON settings columns.
- **514 console statements** left in shipped client code.
- **Vendor concentration:** the product is effectively a Previo-only integration today; a second PMS (Mews, Apaleo, Opera) is unproven work.
- **Key-person risk:** the Previo EQC quirks, unit-mapping heuristics and Budapest-time attribution rules are largely undocumented outside code comments.
- **Scalability:** current load is small (4 hotels, ~290 rooms). Bulk pricing already required chunking (300-row draft writes, 120-row push batches) to avoid Edge Function timeouts — the pattern works but signals that heavy operations sit close to platform limits. Client-side aggregation in the revenue grid will need server-side rollups beyond ~20 hotels.
- **Supabase platform findings** previously flagged (leaked-password protection, OTP expiry, Postgres version) are configuration-level and cheap to close.

## 8. What would be costly to rebuild

Ranked by replacement cost:

1. **Previo integration and write-back** (highest) — EQC rate-write protocol discovery, occupancy-ladder rules, error 3092 handling, credential/multi-account handling, XLSX fallback, fuzzy unit mapping, checkout/no-show classification, Budapest-time attribution. Realistically 6–9 months of engineering plus vendor trial-and-error.
2. **Housekeeping operations engine** — auto-assignment, staged assignments, supervisor approvals, photo/linen enforcement, attendance coupling. 4–6 months, and the rules only come from real hotel operations.
3. **Database + RLS security model** — ~120 tables, 302 migrations, ~30 triggers/RPCs, multi-tenant policies. 3–5 months to re-derive safely.
4. **Revenue pricing engine and rate lifecycle** — drafts, batched push, audit trail, reconciliation. 3–4 months.
5. **Localization corpus** (~19.8k lines, 5 languages, hotel-domain vocabulary) — expensive in translation cost more than engineering.
6. **Training/onboarding system** — 2–3 months.

Total credible rebuild: roughly **18–30 engineer-months**, with the Previo know-how being the part money alone does not buy quickly.

## 9. Maturity scores (out of 10)

| Dimension | Score | Rationale |
|---|---|---|
| Product | 7.5 | Housekeeping, PMS ops, revenue and breakfast are production-grade with real data; front desk / reservations / guests / channel manager are shells. |
| Architecture | 6.0 | Sensible Supabase-native design with DB-enforced rules and feature flags, undermined by god components, string-based tenancy and the `'rdhotels'` fallback. |
| Integration depth | 8.5 | Bidirectional Previo integration incl. hand-rolled EQC rate write-back with vendor-quirk handling — genuinely hard to replicate. Single-vendor, and SLNT live sync still stubbed. |
| Defensibility | 6.5 | Moat is accumulated PMS/operational know-how and workflow depth, not IP or network effects; replicable by a funded competitor in ~2 years. |
| Production readiness | 5.5 | Live and used daily, but no CI, no meaningful tests, no staging, no external monitoring, and open multi-tenant isolation risks. |
| **Overall** | **6.7** | A real, revenue-relevant operating product with a credible integration moat, carrying start-up-typical engineering debt that is fixable but not yet fixed. |

## Highest-value pre-diligence fixes

1. Remove the `'rdhotels'` default-tenant fallback; fail closed instead.
2. Add automated tests around rate write-back, room assignment and RLS isolation, plus a CI pipeline.
3. Stand up staging + external error monitoring.
4. Close the outstanding Supabase auth/platform configuration findings.
5. Document the Previo protocol knowledge outside code comments to reduce key-person risk.
6. Ship or formally descope the `slnt-pms-sync` live-API stub.
