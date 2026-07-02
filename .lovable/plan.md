
## 1. Ottofiori PMS upload — what went wrong today

Comparing the two files you uploaded (morning vs. afternoon of 2026‑07‑02, both 21 rooms):

- Files are identical in room count. Between morning and afternoon, 7 rooms flipped `Occupied Yes → No` because guests actually checked out during the day (Q‑301, Q‑403, DB/TW‑103, DB/TW‑303, DB/TW‑401, TRP‑105, TRP‑204).
- Real "checkouts today" per the PMS file = rows where a `Departure` time exists AND `Occupied=No` in the latest file. That's **10 rooms**, matching Petra's "we have only 10".
- The app was showing **11** because:
  - Room **201** has `Occupied=No` with no `Departure` time (it was empty from the start of day, likely the AC room). Our current importer counts any `Occupied=No` row as a checkout, so 201 gets promoted to checkout.
  - Room **302** in the afternoon screenshot shows a **manual** entry (green "1 manual" pill) on top of the PMS row that says `Status=Clean, Occupied=No, Arrival 14:30`. 302 is a **stayover/arrival**, not a checkout — a manual override slipped it into the checkout bucket.
- Room 302 also shows "between daily/checkout" ambiguity because we mark it both `Clean` and add a manual departure.

### Fix — SHIPPED (Ottofiori miscount)
- Importer reclassification live in `PMSUpload.tsx`: `Occupied=No + Arrival + no Departure` no longer promotes to checkout (fixes Room 201). Manual overrides no longer force-add to the checkout bucket (fixes Room 302).
- Still TODO: source tag ("PMS / Manual / Empty (AC)") on each room card + reconciliation drawer.

## 2. SLNT — dual PMS sync (API + manual fallback) — SCOPED TO SLNT ONLY

- SHIPPED: `pms_configurations` gained `sync_mode` (default `manual_only` so no non-SLNT hotel changes behaviour), `last_sync_success_at`, `consecutive_sync_failures`, `api_base_url`, `api_auth_type`.
- SHIPPED: `supabase/functions/slnt-pms-sync/index.ts` — org-guard (only runs for `organizations.slug='slnt'`), reads sync_mode + credentials secret, records `not_configured` until super admin wires live API. Live API call site is a clearly-marked TODO with the exact behaviour spec inline.
- SHIPPED: `src/lib/propertyTerminology.ts` — `usePropertyTerms()` returns "Property/Properties" for SLNT and "Hotel/Hotels" for every other org, all 5 UI languages.
- NEXT PASS:
  - Admin UI: PMS Configuration screen (SLNT hotels only) — Sync Mode selector, API base URL + auth type inputs, credentials secret name, health badge (Green API / Yellow degraded / Red manual-only), "Sync Now" and "Force manual upload" buttons.
  - Manual XLSX upload for SLNT reuses `previo-pms-sync` importer (layout is identical Previo output; only room codes differ).
  - Wire `Header`, `HotelSwitcher`, admin screens, training strings to `usePropertyTerms()` — only SLNT users see the wording change.

### Handover when the live SLNT API is ready
1. Super admin opens Admin → PMS Configuration → SLNT property, sets:
   - `sync_mode = api_with_manual_fallback`
   - `api_base_url` (SLNT Previo tenant URL)
   - `credentials_secret_name` (e.g. `SLNT_PREVIO_API_KEY`) — the secret itself is stored via `add_secret`, never in the DB.
2. Click "Test connection" → then "Sync Now". A green health badge + non-null `last_sync_success_at` confirms it works.
3. Turn on `auto_sync_enabled`. From then on, XLSX upload is only needed if the API fails 3× in a row or is silent for >2h — the UI will prompt automatically.

## 3. Training Center — full rebuild (FAQ, module → unit, mobile first)

The existing "chain of 6 curricula" is what makes the flow feel broken and duplicated. Replace with a single hierarchical structure per role.

### New shape
```text
Role
 └─ Module (e.g. Housekeeping)
     └─ Unit (e.g. "How to assign a room")
         └─ Steps (spotlight + short answer, ≤4 per unit)
```

### Housekeeper role — one module, clear units
- Attendance
  - Check in (spotlight the swipe‑right)
  - Request a break / Break types
  - End break, sign out
  - Daily timesheet (add missing `data-training` anchor)
- My Tasks
  - How rooms are assigned to me
  - Start a room
  - Capture required photos
  - Log dirty linen
  - Complete a room
  - DND: mark & retrieve
  - Report a maintenance issue from a room

### Manager role — modules by division
- Housekeeping
  - Sync & refresh PMS data
  - Add a new housekeeper / staff member
  - Check staff attendance & timesheets
  - Assign rooms (manual + auto‑assign)
  - Approve pending photos / DND / dirty linen
  - Lost & found
- Maintenance
  - Create a ticket (scoped to the current property)
  - Assign to a maintenance user (filtered by current property, "Hotel"→"Property" for SLNT)
  - SLA & escalation
  - Close / reopen from Housekeeping › Maintenance
- HR
  - Attendance overview & corrections
  - Approve breaks / overtime
  - Payroll export
  - Reset a user's training / password

### Training Center UI (page rewrite)
- Left rail = Modules, main pane = accordion of Units (FAQ style). Each unit card has:
  - One‑line question ("How do I assign a room?")
  - Short written answer (i18n)
  - "Show me" button → launches the spotlight walkthrough for just that unit
  - Status chip: Not started / In progress / Completed
- Mobile: modules collapse to a top segmented control, units become full‑width cards, walkthrough uses bottom‑sheet tooltip.
- Search box across all units.
- Every step's spotlight navigates the user to the right tab first (reuse the existing `training-navigate` event) so nothing is ever "invisible".

### Notifications
- Replace the cascade of resume toasts with a single grouped Sonner toast: "3 training units ready — open Training Center". Skipped units stay silent until admin reset.

### Auto‑prompt & admin reset
- First login for a `manager`/`housekeeping_manager`/`maintenance_manager` triggers a welcome dialog with 2 buttons: **Start guided tour** / **Skip for now**. Skipping sets `dismissed_until = never` (until admin reset), matching your earlier confirmation.
- Admin panel already supports reset — expose per‑module reset (not just per‑curriculum) so admins can re‑trigger just "Housekeeping" for a specific user.

### Files that will change (technical section)
- `src/components/training/v2/curricula/*` — collapse into `housekeeper.ts`, `manager-housekeeping.ts`, `manager-maintenance.ts`, `manager-hr.ts`; delete `manager-complete.ts`, `manager-attendance.ts`, `manager-reception.ts`, `manager-team.ts`, `manager-tickets.ts`, `manager-revenue.ts`, `manager-invoices.ts`, `manager.ts`.
- `types.ts` — add `module`, `unit`, `faqQuestion`, `faqAnswer` fields; remove `chain` (no longer needed).
- `TrainingV2Provider.tsx` — remove chain queue, add unit‑level progress, group resume toasts.
- `pages/TrainingCenter.tsx` + `components/training/v2/TrainingCenter.tsx` — full rewrite to FAQ/module UI.
- Add `data-training="daily-timesheet"` in `AttendanceManagement.tsx` / `AttendanceReports.tsx`, `data-training="create-ticket"` in `Dashboard.tsx`, plus anchors listed per unit.
- `CreateTicketDialog.tsx` / `TicketDetailDialog.tsx` — filter assignable maintenance staff by currently selected hotel/property; label "Hotel"→"Property" when `org.slug === 'slnt'`.
- `HousekeepingManagerView.tsx` — surface maintenance tickets for eligible roles with inline update.
- Edge: `previo-pms-sync` importer rules updated per §1; new `slnt-pms-sync` skeleton + `pms_configurations.sync_mode` column via migration.
- Migration: add `sync_mode` enum, `last_sync_success_at`, `last_sync_error`. All GRANTs included.

## Questions before I build

1. **SLNT PMS API**: which system (Cloudbeds, Guesty, Hostaway, custom)? Share base URL + auth type so I can wire the client. If not ready, I'll ship the manual path + sync‑mode UI now and stub the API.
2. **Room 201 today**: should "empty because of AC" be a new status (`Out of order — AC`) that managers can set from the Room card, or keep it as generic `Empty (no PMS activity)`?

Send answers (or "proceed with defaults") and I'll implement in one focused pass.
