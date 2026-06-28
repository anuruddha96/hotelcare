# Training overhaul — manager & housekeeper modules

Scope of this plan: training only. Airbnb-style multi-property org onboarding and the maintenance section audit will each get their own plan after this ships.

## Problems to fix

1. **Steps jump when you click Next.** In `TrainingV2Provider.tsx` the step lifecycle effect calls `setTimeout(() => next(), 200)` whenever a step is `optional` AND its precondition fails. Several manager steps are marked optional with preconditions like `is_signed_in` / `has_active_assignment` that aren't true for managers — so the user clicks Next once and the next 2–3 steps silently auto-skip in 200ms ticks.
2. **Manager modules try to highlight elements that aren't on screen yet** (e.g. "Pending Approvals" tab when there are none, "Ticket row" when the list is empty) and either get stuck on "waiting…" or skip past silently.
3. **Housekeeper module has the same pacing problem** — optional steps gated on `has_active_assignment` / `has_in_progress_cleaning` skip in a chain when the housekeeper has no work yet.
4. **Auto-start runs before role is known in some edge cases** and feature-promo modules never re-surface once the relevant feature appears.
5. **Several `data-training` anchors referenced by the manager curricula don't exist in the DOM** (need verification per module).
6. **Manager copy** still mixes housekeeper-tone phrasing in places and is not consistently translated to hu/es/vi/mn with the ops vocabulary preserved (ADR/RevPAR/pickup/SLA stay in English).

## Solution

### 1. Pacing fix (root cause of the "double next") — `TrainingV2Provider.tsx`

- Remove the silent `setTimeout(() => next(), 200)` auto-skip for optional steps when a precondition fails.
- Replace with a **deferred step queue** on the curriculum status:
  - When the current step's precondition fails:
    - If `optional` ⇒ push `{slug, stepKey}` into a `deferred_steps` array stored in `user_training_state` and advance once (single, user-visible jump with a small toast: "Skipped — we'll show this when it's relevant").
    - If not `optional` ⇒ show the existing "Waiting…" card (unchanged), but also offer a "Skip this step for now" button that does the same deferral.
- Remove the 3-second polling re-run of `run()` inside the same effect — replace with a single MutationObserver + visibility-change listener that re-evaluates only when the DOM actually changes or the tab becomes visible. Avoids the silent re-trigger that compounds the jump.
- Debounce `next()` (200ms) so a stray double-click can't advance two steps.

### 2. Pause + auto-resume for deferred steps

- New table column / row shape in `user_training_state`: `deferred_steps jsonb default '[]'` (array of `{slug, stepKey, deferredAt}`).
- New `useDeferredStepsWatcher` hook mounted by the provider:
  - On every route change AND on a global MutationObserver (scoped to `document.body`, debounced 400ms), look up curricula+steps in `deferred_steps`, evaluate their `precondition`, and check if `selector` resolves.
  - When both pass for a deferred step, show a non-blocking toast: **"Ready to continue your <module> training? — Resume"**. Clicking Resume calls `start(slug)` and jumps to that step. Auto-dismiss after 20s; never more than one toast at a time.
- This gives the user the "pause + auto-resume later" behavior they asked for, for both manager and housekeeper modules.

### 3. Auto-start hardening

- Keep the existing `role` gate (don't auto-start until `profile.role` is loaded).
- Add a second gate: only auto-start `core` curricula whose `roles` array includes the actual role (the current `curriculaForRole` filter already does this; add a unit-style assertion + console warning if a `core` curriculum has no role match for current user, to catch future regressions).
- Persist `last_auto_start_at` in `user_training_state` and skip auto-start if it ran in the last 4 hours, so refreshes don't re-trigger the welcome.
- Existing `dismissed_until` + `auto_start_pending` flow is preserved.

### 4. Missing `data-training` anchors

Audit each manager module and add the anchor at the exact element. Verify in build mode by reading the file before editing. Anchors expected (per plan-manager-training.md):

| Anchor                                | File to instrument                                                  |
| ------------------------------------- | ------------------------------------------------------------------- |
| `hotel-switcher`                      | `src/components/layout/HotelSwitcher.tsx` (verify present)          |
| `language-switch`                     | `src/components/dashboard/LanguageSwitcher.tsx` (verify present)    |
| `main-tabs`                           | `src/components/layout/MainTabsBar.tsx` (add to root nav)           |
| `team-view`, `team-view-tab`          | `src/components/dashboard/HousekeepingManagerView.tsx`              |
| `auto-assign-btn`                     | Auto-Assign button in the team view (verify selector)               |
| `pending-approvals`                   | Pending approvals sub-tab                                           |
| `ticket-row`                          | First row in tickets list (use `:first-child` selector)             |
| `revenue-grid`, `ai-analyst-card`     | `CalendarYearView.tsx`, `AnalystPanel.tsx` (verify present)         |
| `invoice-upload`                      | `PurchaseInvoices.tsx` upload zone (verify present)                 |
| `help-button`                         | already present                                                     |

Each anchor will be added with `data-training="<key>"` on the outermost meaningful element and verified with a Playwright screenshot of the relevant route after the change.

### 5. Curriculum content + i18n pass

For each of `manager.ts`, `manager-team.ts`, `manager-tickets.ts`, `manager-reception.ts`, `manager-attendance.ts`, `manager-revenue.ts`, `manager-invoices.ts`, `housekeeper.ts`:

- Re-write step copy in manager tone (terse, desktop-aware) — keep ops vocabulary (ADR, RevPAR, pickup, SLA) untranslated.
- Verify every step has `en, hu, es, vi, mn` for title + body.
- Mark steps that depend on data as `optional: true` so they get deferred (instead of blocking) when nothing is on screen.
- Tighten `roles` arrays so `manager-revenue` / `manager-invoices` only target `top_management*` + `admin`.

### 6. Housekeeper module same treatment

- Same optional+deferred behaviour applied to "Start Room", "In-room tools", "Sign out", etc.
- Keep linear flow when work IS present; defer when not.

## Verification

- Playwright run on `/rdhotels` while signed in as a manager:
  1. Trigger orientation via help button → step through, screenshot every step, confirm spotlight lands on a real element and no step auto-skips on click Next.
  2. Open `manager-team` from Training Center on a hotel with no pending approvals → confirm those steps defer + a resume toast appears after we seed a pending approval.
- Re-run for housekeeper account with no active assignment → confirm steps after "Sign in" defer until an assignment is seeded.
- Verify `tsgo` typecheck passes.
- Check `user_tour_progress` rows reflect the resumed step indexes.

## Technical details

- New migration: `ALTER TABLE public.user_training_state ADD COLUMN IF NOT EXISTS deferred_steps jsonb NOT NULL DEFAULT '[]'::jsonb, ADD COLUMN IF NOT EXISTS last_auto_start_at timestamptz;` — no GRANT changes needed (table already exposed to authenticated).
- No edge-function changes.
- No UI changes outside training overlay + the anchor additions.

## Out of scope (separate plans next)

- Airbnb-style multi-property organization onboarding — will produce a discovery doc covering: `organizations.type` ('hotel' | 'str_network'), introducing a `properties` entity (address, coords, listing IDs), consolidated manager dashboard across properties, housekeeper routing across addresses, and how the existing `hotel_configurations` rows map to "properties" without breaking PMS sync. Will return with clarifying questions.
- Maintenance section audit — full walkthrough of tickets, SLA, photos, hold/approval, manager close-out + edge-function logs. Separate plan once training ships.
