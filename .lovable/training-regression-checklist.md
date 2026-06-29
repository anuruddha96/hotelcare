# Training Module Regression Checklist

Run after any change to `TrainingV2Provider`, `curricula/*`, the Dashboard tab logic, or pages that host `data-training` anchors (Maintenance, Revenue, Purchase Invoices).

## Setup
- Sign in as the role-under-test (housekeeper / manager / top-management).
- DB: clear `user_tour_progress` and `user_training_state` rows for the user so auto-start fires fresh.
- Reload — confirm dashboard is the landing route (`/<org>`) before the training kicks in.

## Per-module pass

For every curriculum (`v2_housekeeper_first_day`, `v2_manager_orientation`, `v2_manager_team_and_assignments`, `v2_manager_tickets_and_sla`, `v2_manager_attendance_and_payroll`, `v2_manager_reception_handover`, `v2_manager_revenue`, `v2_manager_purchase_invoices`):

1. **Auto-start gate**
   - Core modules (orientation / housekeeper first day) auto-start once `role` AND `assignedHotel` are loaded AND the route is NOT `/`, `/index`, `/auth*`.
   - Feature-promo modules never auto-start.
2. **First step highlight**
   - Spotlight rect lands on the correct anchor. If the step has `route`, the URL changes BEFORE the highlight appears.
3. **Single-step advance**
   - Click Next exactly once → step index increments by 1 (verify in console: `[training] step …`). Never two at a time.
4. **Cross-route step**
   - Step with `route: '/:org/revenue'` or `/:org/purchase-invoices` navigates the browser AND the highlight resolves on the new page.
5. **Cross-tab step**
   - Step with `tab: 'housekeeping'` switches the dashboard tab AND highlights within one second.
6. **Empty-state defer**
   - For optional steps whose selector/precondition can't resolve (e.g. no pending approvals): a toast "Skipped — we'll show this when it is relevant" appears once, the next step shows, the module continues to completion.
7. **Resume after defer**
   - Seed the data (create a pending approval / assign a ticket) → within ~1 second the "Ready to continue your <module>? — Resume" toast appears. Clicking Resume jumps directly to the deferred step.
8. **Skip-for-now button**
   - On the Waiting card (non-optional step that can't resolve), the "Skip for now" button defers + advances exactly one step.
9. **Hotel switch mid-tour**
   - Switching hotel during an active tour pauses the overlay for ~1.5s, the deferred-queue still works, and clicking "Resume" on a feature toast picks up correctly.
10. **Completion**
    - Last step shows the "Done" CTA. Clicking it persists `status: completed` in `user_tour_progress` and closes the overlay.

## Module-specific checks

### v2_manager_orientation
- Step `welcome` → `hotel_switcher` → `language_switch` → `help_button`, all on `/<org>`.
- No step shows "Waiting" because every anchor is rendered on the dashboard.

### v2_manager_team_and_assignments
- `team_view` highlights the team grid; `auto_assign` highlights the Auto-Assign button; `pending_approvals` defers if there are none.

### v2_manager_tickets_and_sla
- `ticket_list` highlights the Tickets tab; `ticket_row` defers when there are 0 tickets; opening a ticket detail later triggers the resume toast.

### v2_manager_revenue / v2_manager_purchase_invoices
- Visible only for `admin` + `top_management*`.
- First step navigates from dashboard to `/<org>/revenue` (or `/purchase-invoices`).

### v2_housekeeper_first_day
- After sign-in, `start_cleaning` only appears when an assignment exists; otherwise it's deferred and surfaces once an assignment is seeded.

## Automated coverage

`src/components/training/v2/__tests__/curricula.test.ts` enforces curriculum shape:
- Every step has `en` body + title.
- Every `selector` step has `route` OR `tab` OR is a global anchor (`hotel-switcher`, `help-button`, `language-switch`, `main-tabs`).
- Every data-gated step is `optional: true`.

Run with `bunx vitest run src/components/training/v2/__tests__/curricula.test.ts`.
