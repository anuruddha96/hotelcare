# Plan: Manager training overhaul + Long-term tenant portal

Two large, mostly independent workstreams. Both are needed; I'll deliver them in the order below so training improvements land quickly and the tenant portal ships as a self-contained module.

---

## Workstream A — Manager training: auto-prompt, continuous flow, real spotlighting

### A1. First-login auto-prompt for managers (+ admin reset)
- On sign-in, if the user has a manager role (`manager`, `housekeeping_manager`, `maintenance_manager`, `reception_manager`, `top_management_manager`) AND has no completion row for the new orientation curriculum AND has not skipped it, open the Training Center overlay automatically with a clear **Start** / **Skip for now** choice.
- Persist "skipped" so we don't re-prompt every login; only re-prompt after admin reset or after 30 days.
- **Admin reset**: in `TrainingAdminPanel`, add per-user "Reset first-login prompt" action (single user + bulk by role/hotel). Clears the skip flag and completion rows for the orientation curriculum so it triggers again on next login.
- Storage: new columns on existing `user_training_progress` (or a new `user_training_prompts` table with `user_id`, `curriculum_slug`, `first_prompt_shown_at`, `skipped_at`, `reset_at`). One migration, RLS + grants per project rules.

### A2. One continuous flow instead of isolated modules
- Introduce a **"Manager Complete Walkthrough"** meta-curriculum that chains the existing modules in this exact order:
  1. HR & Attendance (check-in swipe spotlight → Break Types Management)
  2. PMS Upload (with Previo path instructions + connected-vs-manual branching)
  3. Team View (Auto-Assign click-through → Hotel Room Overview with legend forced-expanded → Checkout Rooms → Daily Rooms → Housekeeper cards)
  4. Pending Approvals
  5. Staff Management (Add New Staff walkthrough, auto-username/auto-password explanation, no custom password step)
  6. Performance
  7. Room Photos
  8. DND Photos
  9. Maintenance
  10. Lost & Found
  11. Dirty Linens
  12. HR Management deep-dive
- Engine changes in `TrainingV2Provider`:
  - Support a `chain: string[]` field on a curriculum that lists child curriculum slugs.
  - When the last step of a chained child completes, auto-load the next child without closing the overlay. Show a small "Module 3 of 12 — PMS Upload" progress chip.
  - Each child remains independently launchable from Training Center for on-demand replay.
- User can exit at any step; on next open we resume from the current chain position.

### A3. Real navigation + spotlighting for every step
- Every step in every manager curriculum gets `route`, `tab`, `selector` (and `waitFor` where needed). The provider already navigates + waits; the gap is missing/incorrect anchors.
- Audit + add `data-training="…"` anchors across the manager UI:
  - Attendance: `attendance-swipe-checkin`, `break-types-add`, `break-types-existing`
  - PMS: `pms-upload-dropzone`, `pms-sync-status`, `pms-manual-upload-btn`
  - Team View: `auto-assign-button`, `hotel-room-overview`, `room-overview-legend` (force-expand while training active), `checkout-rooms-section`, `daily-rooms-section`, `housekeeper-card`
  - Pending Approvals: `pending-approvals-list`, `pending-approval-row`
  - Staff Management: `add-new-staff-btn`, `staff-form-role`, `staff-form-hotel`, `staff-form-language`
  - Performance / Room Photos / DND Photos / Maintenance / Lost & Found / Dirty Linens: one anchor per primary panel + one per key action.
- Legend expansion: `TrainingV2Provider` sets a `data-training-active` attribute on `<body>`; `RoomOverview` reads it and forces the legend open while true.
- Add "click this button to continue" steps (interactive vs read-only): step gains `advanceOn: 'click'` and the spotlight passes clicks through to the target.

### A4. PMS-connected vs not
- Step reads hotel's PMS config; body text switches between:
  - Connected → "Syncs automatically when an eligible user signs in. You can also press Sync now."
  - Not connected → "Download from Previo: pms.previo.app › Housekeeping › (top) Housekeeping › Export (top right) › XLS, then upload here."
- Include the path verbatim in EN + HU + ES + VI + MN.

### A5. Regression coverage
- Extend `src/components/training/v2/__tests__/curricula.test.ts` with:
  - Every step has either `selector` or is explicitly marked `informational: true`.
  - Chain integrity: every slug in `chain` exists and roles overlap.
  - Anchor coverage test: grep the codebase for each `selector` string and fail if missing.

---

## Workstream B — SLNT long-term tenant portal (60 hotel rooms + 20 tenant units)

### B1. New role + org-scoped separation
- Add `long_term_tenant` to `app_role` enum (via `user_roles`, per project security rules — never on profiles).
- Add `unit_type` to rooms: `hotel` (default) | `long_term_rental`. Housekeeping views filter `hotel` only; tenant portal filters `long_term_rental`.
- Migration includes GRANTs + RLS: tenant can only see their own unit + their own submissions.

### B2. Tenant portal (`/tenant`)
Mobile-first, matches existing HotelCare styling. Sections:
1. **My Unit** — address, property manager contact.
2. **Report a Maintenance Issue** — reuses the existing ticket create dialog, forced `department=maintenance`, tagged `source=tenant`. On submit:
   - Row lands in **Pending Approvals** for the property's maintenance manager.
   - Ticket also appears in **Housekeeping › Maintenance** for that property, linked to the tenant's unit.
3. **Meter Readings** — new table `meter_readings` (`unit_id`, `type` enum electricity/water/gas, `value_numeric`, `reading_date`, `photo_url`, `submitted_by`). Gas optional per unit. Manager view under maintenance shows history + chart.
4. **My Contract** — upload PDF, view previous contracts. New table `tenant_contracts` (`unit_id`, `tenant_user_id`, `start_date`, `end_date`, `document_url`, `renewal_notified_at`). Nightly cron edge function `contract-renewal-reminder` emails/notifies both tenant and property manager 60 days before `end_date`, and again at 30 days.
5. **Emergency Contacts** — property manager, fire brigade, police, EU emergency 112 (the "211" in the request looks like a typo — I'll confirm before shipping). Configurable per-hotel table `emergency_contacts`.
6. **Messages** — lightweight thread between tenant and property manager, using existing notifications + a `tenant_messages` table. Auto-translation via existing `translate-note` edge function so both sides see their own language.

### B3. Manager side additions
- Pending Approvals gains a "Tenant reports" filter.
- Maintenance ticket detail shows `Reported by tenant: <name, unit>` and lets manager upload resolution documents (reuses existing ticket attachments), update status; tenant sees status changes on their portal in real time (existing Supabase Realtime).
- Meter readings tab per unit under maintenance.
- Contract tab: view/download, mark renewed (writes new contract row).

### B4. Auth & onboarding
- Admin can create tenants from a new "Tenants" panel: choose unit, tenant name/email/phone, system generates username + password (same rules as housekeepers) and prints a login card.
- Login lands on `/tenant` (role-based landing already exists — extend the map).
- Tenant portal fully translated in EN, HU, ES, VI, MN (matches project Core rule).

### B5. Out of scope for this pass
- Payments/rent tracking.
- Native mobile push (stays on existing Web Push).
- Multi-tenant per unit (single active tenant per unit for now).

---

## Technical footprint

- **Migrations (one file per workstream)**:
  - A: `user_training_prompts` (or columns on existing) + admin-reset RPC.
  - B: `app_role` extend, `rooms.unit_type`, `meter_readings`, `tenant_contracts`, `emergency_contacts`, `tenant_messages`, all with GRANTs, RLS, `has_role`-based policies.
- **Edge functions**: `training-reset-prompt` (admin action), `contract-renewal-reminder` (scheduled).
- **Frontend**:
  - `TrainingV2Provider` — chain + auto-prompt + click-to-advance + body flag.
  - `curricula/manager-complete.ts` (new meta) + rewrites of each manager module for anchors/order.
  - New `src/pages/TenantPortal.tsx` + subcomponents under `src/components/tenant/`.
  - `TrainingAdminPanel` — reset action.
  - Data-training anchors sprinkled across the existing manager UI.

---

## Delivery order

1. Confirm the two questions below.
2. Migration for training prompts + engine chain/auto-prompt + click-to-advance.
3. Add all `data-training` anchors + rewrite manager curricula into the 12-module chain with PMS branching text.
4. Regression test additions.
5. Migration for tenant portal + new role.
6. Tenant portal UI + manager-side additions + contract reminder cron.

---

## Two quick confirmations before I build

1. **Emergency number**: request says "211" — should this be **112** (EU standard) with per-hotel overrides, or literally 211?
2. **Auto-prompt cadence**: after a manager taps "Skip for now", should we re-prompt on the **next login**, after **7 days**, or **never** (until admin reset)? I've defaulted to "never until admin reset or 30 days" but happy to change.
