
## 1. Duplicate/undismissable training resume toasts

**Problem** (screenshot 1): two identical "Ready to continue your training? — Team & Assignments" toasts with only a Resume button — no way to dismiss.

**Fix** in `src/components/training/v2/TrainingV2Provider.tsx` (deferred-step watcher, ~L750–823):
- Deduplicate by `stepKey` across the queue (right now `resumePromptedRef` is only per session; if the queue has the same step twice, or two steps in the same curriculum share a selector, both fire). Guard once per `slug` per session, not per `slug::stepKey`.
- Give the sonner toast an explicit `id: 'training-resume'` so re-firing replaces instead of stacks.
- Add a second action "Not now" that calls `dismissCurriculum(slug, 1)` (24h snooze) and clears the queue entry — so the user can close it.
- Skip firing entirely if a `pendingAutoStart` prompt is visible or if the user is on `/auth`, `/bb`, `/breakfast`.

## 2. PMS "Daily Overview" false hotel mismatch

**Problem** (screenshot 2): uploading a Hotel Memories Budapest file into Hotel Memories Budapest returns *"Hotel mismatch: this file is for Hotel Mika Downtown"*.

**Root cause** in `supabase/functions/revenue-overview-upload/index.ts` (L105–125) and the sibling `revenue-occupancy-upload`, `revenue-pickup-upload`: the detector scans filename + every sheet's first 6 rows and matches on `hay.includes(name)`. The alias `"mika"` (4 chars) matches any text containing the substring "mika" (e.g. filenames with `memories-budapest-…mika…` or a footer/legend). First hit wins; no scoring.

**Fix** across the three edge functions:
- Score every alias by (a) length and (b) source weight (filename = 3, sheet name = 2, cell content = 1). Pick the highest-scoring hotel, not the first match.
- Remove the too-short aliases (`"mika"`, `"memories"`, `"ottofiori"`, `"gozsdu"` alone) — require the full hotel name or its distinctive multi-word form.
- Only enforce mismatch when the winning score is ≥ 4 AND the winner comes from the filename or a sheet name (not a random cell).
- If detection is ambiguous, log a warning and trust the user's selected hotel instead of blocking.

## 3. `/bb` breakfast board — 115, 216, 210 anomalies

**What's happening** in `supabase/functions/breakfast-public-lookup/index.ts` (`mode: "list"`):
- **115 red (no_breakfast)** — snapshot row exists (parses fine as `27SYN.TWIN-115`), but `breakfast`/`all_inclusive` are stored as `0` because the overview upload's `findCol(includesAny(["bre"|"lun"|"din"|"all"]))` matches the wrong column (e.g. "Arrival" contains `arr`, "All-Inclusive" not present). Result: eligible guests marked "no breakfast".
- **216 red** — `66EC.QRP216` (no dash). Memories fallback regex parses it, but only for the current uploader. Older snapshots stored before the fallback was added produced no row for 216, so it comes in via the master-rooms union and is red.
- **210 grey (arriving)** — `60QUEEN-210` parses fine, row is `arriving` because only the Arrival column is filled. UI treats every "arriving" row as grey even when breakfast>0.

**Fixes**:
- `revenue-overview-upload/index.ts`: tighten meal-column detection. Use exact header matches (`"breakfast"`, `"lunch"`, `"dinner"`, `"all-inclusive"`, `"all inclusive"`, `"ai"`) and fall back to positional (columns after "Ongoing"). Never match `"arr"` for breakfast.
- `breakfast-public-lookup/index.ts` (list mode): recompute `chipStatus` so that if `breakfast > 0 || all_inclusive > 0`, the room shows `pending`/`partial`/`served` even when `row_status === "arriving"`. Only mark `arriving` grey when there's no breakfast entitlement.
- `_shared/roomCode.ts`: keep the memories dash-less fallback; add a comment/test note that both `70SNG-306` and `66EC.QRP216` must parse.
- Ask the user to re-upload today's Daily Overview once deployed so historical snapshots refresh.

## 4. Training Center — modular organization with per-unit deep-link

**Goal**: turn `/training` into a mobile-friendly *Modules → Units* directory. Each unit navigates to the right page/tab and spotlights the right element.

### New shape (add fields, don't break existing engine)
`src/components/training/v2/types.ts`:
```ts
export type TrainingModuleKey =
  | 'housekeeping' | 'hr_attendance' | 'reception' | 'maintenance'
  | 'revenue' | 'invoices' | 'admin';

export interface TrainingCurriculum {
  // …existing fields…
  moduleKey?: TrainingModuleKey;   // grouping in the Training Center
  icon?: string;                   // lucide icon name
  estMinutes?: number;             // "~2 min"
}
```

### Units to author (each = a small curriculum, 2–5 steps)
Files under `src/components/training/v2/curricula/units/`:

**Housekeeping (Manager)**
- `hk-assign-rooms.ts` — Team View → Auto-Assign → Assign Room
- `hk-room-overview.ts` — Hotel Room Overview cards / Map / Refresh
- `hk-progress.ts` — Team View progress bars + status filters
- `hk-approve-cleaned.ts` — Pending Approvals tab, approve/reject flow
- `hk-performance.ts` — Performance Leaderboard
- `hk-lost-found.ts` — Lost & Found tab
- `hk-dnd-daily-photos.ts` — Daily Photos + DND Photos
- `hk-dirty-linen.ts` — Dirty Linen (mobile view)

**HR & Attendance**
- `hr-staff-management.ts` — Staff Management tab (create HK, roles)
- `hr-attendance-daily.ts` — Attendance daily timesheet
- `hr-early-signout-approvals.ts` — Early Sign-Out Approvals
- `hr-payroll-monthly.ts` — Monthly payroll export

**Reception**
- `rec-daily-overview-upload.ts` — Revenue → Upload → Daily Overview (with new UI)
- `rec-bb-lookup.ts` — `/bb` breakfast lookup, room grid legend
- `rec-check-in-out.ts` — FrontDesk check-in / check-out dialogs
- `rec-guest-minibar.ts` — Guest QR + minibar reconciliation
- `rec-reservations.ts` — Reservations calendar create/edit

**Maintenance**
- `mnt-open-ticket.ts` — Create Ticket dialog, photo requirement
- `mnt-assign-hold-approve.ts` — Assign, Hold → Approval flow
- `mnt-sla-close.ts` — SLA badges, close with completion photo

**Housekeeper (self-serve)** kept separate but grouped as its own module for HK staff logins.

Each unit is registered in `curricula/index.ts` with the correct `moduleKey`, `roles`, `route`, `tab`, and `selector` per step, reusing selectors already added in the earlier training pass.

### New Training Center UI
`src/components/training/v2/TrainingCenter.tsx` rebuild:
- Mobile-first single column, `max-w-3xl`.
- Search input at the top (`Search modules and units…`).
- Four module cards → tap expands (accordion) → grid of unit cards.
- Each unit card: icon, title, 1-line description, `~N min`, status badge (Not started / In progress N/M / Done), primary button `Start` / `Resume` / `Restart`, secondary `Mark done` in overflow menu.
- Featured card at the top: "Full manager walkthrough" (existing `manager-complete`), untouched behaviorally.
- Sticky bottom bar on mobile with a Close button so it works when opened from Help & Training.

### Nav wiring
- `TrainingHelpButtonV2` dropdown lists modules (not raw curricula) with "Open Training Center" as the primary CTA.
- Add a `?unit=<slug>` query param support so we can deep-link directly from other help buttons.

### Guards / anchors
For every unit step, add `data-tour="…"` anchors where missing (Auto-Assign button, Public Areas, Bulk Unassign, Pending Approvals row, Lost & Found tab, DND grid, Daily Photos grid, Attendance timesheet row, Early Sign-Out row, Revenue Upload dialog tabs, /bb Check button, FrontDesk Check-In/Out buttons, Ticket card Assign/Hold/Approve/Close buttons). Anchors are additive; no logic change.

### SLNT-only hiding
Keep the existing `isPropertyOrg` filter and extend it: hide the whole `revenue` module for SLNT (already hidden), and hide `invoices` if `!hasInvoicesFeature(org)` (already handled elsewhere).

## 5. Files to change

- `src/components/training/v2/TrainingV2Provider.tsx` (dedupe toasts, add "Not now", route blocklist)
- `src/components/training/v2/TrainingCenter.tsx` (rebuild modular UI)
- `src/components/training/v2/TrainingHelpButtonV2.tsx` (module-first menu, deep-link support)
- `src/components/training/v2/types.ts` (new fields)
- `src/components/training/v2/curricula/index.ts` (register new units, tag `moduleKey`)
- New: `src/components/training/v2/curricula/units/*.ts` (~15 unit files as listed)
- `supabase/functions/revenue-overview-upload/index.ts` (scored detector + meal-column fix)
- `supabase/functions/revenue-occupancy-upload/index.ts` (scored detector)
- `supabase/functions/revenue-pickup-upload/index.ts` (scored detector)
- `supabase/functions/breakfast-public-lookup/index.ts` (chipStatus: breakfast entitlement wins over `arriving`)
- Small anchor additions across dashboard/reception/maintenance components (no behavior change)

## 6. Verification
- Manual: upload the same Memories daily-overview file → expect success + snapshot rows for 115/216/210 with correct breakfast counts.
- Manual: `/bb` grid — 115 pending/served, 216 pending or no-breakfast per actual PMS entitlement, 210 pending (not grey) when breakfast>0.
- Manual: log in as manager on a fresh browser → single first-login prompt; if snoozed the resume toast appears with a Not-now button and does not duplicate.
- Manual: `/training` shows 4 module accordions + featured walkthrough; each unit starts, navigates, spotlights the intended element, and marks complete.
- Typecheck via project build.
