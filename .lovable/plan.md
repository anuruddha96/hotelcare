## Goal

Make the manager + housekeeper training modules actually walk through the app: navigate across routes/tabs, highlight the right element on each step, advance one step at a time, and defer/resume cleanly when an element isn't available. Add the missing `data-training` anchors in the maintenance UI and ship a regression checklist.

## Root causes (from code read)

1. **Manager Orientation "shows step 1 then jumps".** Orientation auto-starts 1.2s after login on whatever route the user lands on (often `/index` → redirect to dashboard). Step 1 (`hotel_switcher`) targets `[data-training="hotel-switcher"]` but has **no `route`**. If the dashboard hasn't mounted the switcher yet, the selector loop runs for 8s and — because step is not `optional` — shows the Waiting card while React state churn from the auth redirect re-renders the provider effect, which restarts the step. User perceives "back to slide 1, then forward".
2. **Tour doesn't cross tabs/pages.** Manager-team/-tickets/-revenue/-invoices/-attendance steps set `tab` (a `tour:navigate` CustomEvent) but **most steps don't set `route`**. So when training runs from `/dashboard`, steps that need `/maintenance` or `/revenue` never get there — selector times out and step gets deferred or stalls.
3. **`tour:navigate` listeners are inconsistent.** Some screens (HousekeepingManagerView) listen and switch tab; others (PurchaseInvoices, Revenue subtabs, Maintenance ticket detail) don't, so the `tab` field is a no-op.
4. **Missing data-training anchors in the Maintenance UI** — every maintenance ticket step targets selectors that don't exist on the maintenance page (`tickets-tab`, `ticket-row`, ticket-detail assign dropdown, hold/approval card).
5. **Auto-start race vs role load.** `autoStartedRef` flips on the first render after `user && role` are present, but `assignedHotel` may still be null → orientation kicks off before the dashboard renders the switcher.

## Plan

### 1. Provider fixes — `src/components/training/v2/TrainingV2Provider.tsx`

- Gate auto-start on **`assignedHotel` being set** (or user is admin with no hotel) AND the current route being a "stable" landing route (not `/`, `/auth`, `/index` redirector). Add a 600ms post-mount idle check (`requestIdleCallback` fallback to `setTimeout`) before activating, so the dashboard has time to paint anchors.
- When a step has a `route`, navigate first, then **wait until `location.pathname === step.route`** before starting the selector loop. Currently the effect fires `navigate()` and immediately starts polling — but `location` from `useLocation` is stale in the same tick, causing the locator to query the previous page's DOM.
- When a step has `tab`, dispatch the `tour:navigate` event AND wait 1 frame before polling. Add a tiny helper `waitForSelector(selector, { timeout, signal })` returning a promise so the run() function reads top-to-bottom.
- Re-running effect: today the effect depends on `[active?.slug, stepIndex, switchingHotel, assignedHotel]`. Add `location.pathname` so a route change triggered by the step itself re-runs locate. Also debounce the effect body with a 100ms leading guard to absorb React StrictMode double-mounts.
- Don't restart from step 0 on selector failure: if the run() locator can't find the element AND the step is `optional`, defer + advance; if not optional, show Waiting card and **don't reset stepIndex**. (Already mostly true — verify and add a regression test.)

### 2. Curriculum routing — give every step an explicit destination

For every step in `manager.ts`, `manager-team.ts`, `manager-tickets.ts`, `manager-attendance.ts`, `manager-reception.ts`, `manager-revenue.ts`, `manager-invoices.ts`, `housekeeper.ts`:

- Add `route: '/...'` on the first step of each sub-section (don't repeat on consecutive steps on the same route).
- Add `tab: '<tabKey>'` only where the destination route actually has a tabbed sub-nav, and make sure the destination page **listens for `tour:navigate`** and switches the tab. Audit and add the listener to: `PurchaseInvoices.tsx`, `Revenue.tsx` (year vs strategy), `Maintenance` tickets page.
- Mark steps whose target is data-dependent (`pending-approvals`, `ticket-row`, `invoice-row`, `revenue-grid:hot-day`) as `optional: true` so they defer cleanly when empty.
- Tighten `roles` arrays: `manager-revenue` → `admin, top_management, top_management_manager`. `manager-invoices` → `admin, top_management_manager, manager` (only).

### 3. Maintenance UI — add the missing `data-training` anchors

Audit `src/pages/Maintenance*.tsx`, `src/components/maintenance/*` (read first; some files may not exist with that exact name — search for the maintenance ticket list, detail, hold/approval components). Add anchors at:

| Anchor                   | Element                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `maintenance-tab`        | Top-level Maintenance nav button in MainTabsBar               |
| `tickets-list`           | The tickets queue container                                   |
| `ticket-row`             | First ticket card (use `[data-training="ticket-row"]:first-of-type`) |
| `ticket-filters`         | The filter pill row (status/priority/department)              |
| `ticket-detail`          | The ticket detail drawer/page root                            |
| `ticket-assignee-select` | Assignee dropdown trigger                                     |
| `ticket-hold-btn`        | "Put on Hold" action                                          |
| `ticket-approve-btn`     | Manager Approve / Reject buttons in the hold card             |
| `ticket-sla-badge`       | SLA color badge on the row + on the detail                    |
| `ticket-photos`          | Photo gallery section                                         |

For each: read the file, add `data-training="..."` to the outermost meaningful element, and add a Storybook-style verification by running the matching training step.

### 4. Cross-tab/page navigation listeners

- `src/pages/PurchaseInvoices.tsx`: add a `useEffect` listening for `tour:navigate` and switching local tab state for keys like `invoices-upload`, `invoices-verify`.
- `src/pages/Revenue.tsx`: same for `revenue-year`, `revenue-strategy`, `revenue-analyst`.
- Maintenance page (whichever route hosts it): same for `tickets`, `tickets-detail` (open first ticket).
- `MainTabsBar.tsx`: ensure it also listens for `tour:navigate` with a `mainTab` key to switch top-level nav (housekeeping / reception / maintenance / revenue / invoices). Add a `data-training="main-tabs"` on the bar root.

### 5. Regression checklist + lightweight automated test

Create `.lovable/training-regression-checklist.md` covering, for each module, a manual pass:

- Auto-start gate (does it wait for role + hotel?)
- First-step highlight resolves on the correct route
- Click Next once → advance exactly one step (no double-jump)
- Cross-route step: confirm browser URL changes before highlight appears
- Empty-state step: confirm deferral toast appears, no stall, module completes
- After deferral, seed the data and confirm the resume toast surfaces

Add an automated Vitest test `src/components/training/v2/__tests__/curricula.test.ts`:

- Every curriculum step has either `selector` or is text-only.
- Every `selector` step has a matching `route` OR `tab` OR is anchored to a global element (`hotel-switcher`, `help-button`, `language-switch`, `main-tabs`).
- Every step that targets a data-dependent element is `optional: true`.
- All step copy has `en` + `hu` + `es` + `vi` + `mn`.
- `roles` arrays are non-empty and each role is a valid `RoleKey`.

Add a second test for the provider's `next()` debounce: simulate two `next()` calls within 200ms → assert only one step advance.

### 6. Verification

- `tsgo` typecheck.
- Vitest run for the two new test files.
- Playwright (already used by Lovable browser-use): sign in as a manager, trigger Orientation from help, screenshot each of the 4 steps, confirm highlight rect lands on each anchor. Repeat for `manager-team` (with a seeded auto-assign result), `manager-tickets` (with a seeded open ticket), and the housekeeper tour with a seeded assignment.

## Out of scope

- Airbnb-style multi-property orgs and the broader maintenance feature audit (those keep their own plans).
- Any visual redesign of the training overlay itself.

## Technical details

- Files touched: `TrainingV2Provider.tsx`, all 7 manager curricula + housekeeper, `MainTabsBar.tsx`, `PurchaseInvoices.tsx`, `Revenue.tsx`, maintenance page + ticket-detail components, new test file, regression checklist doc.
- No DB migration needed (the `deferred_steps` + `last_auto_start_at` columns already exist from the last pass).
- No edge-function changes.
