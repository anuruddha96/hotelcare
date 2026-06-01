# Modern Training System — Plan

## Goals
- Replace the basic GuidedTour / TrainingOverlay with a polished, modern walkthrough (similar visual quality to the Purchase Invoices wizard).
- Role-aware curricula: separate comprehensive paths for **Housekeepers** and **Managers** (housekeeping_manager, manager, top_management, top_management_manager, admin).
- Cross-page navigation: a step can route the user to another page/tab automatically and resume there.
- Smart conditional steps: skip or defer steps when required data isn't present (e.g., no room assigned yet) and **resume in context** when the user later reaches the right place.
- Contextual deep-dives: housekeeper card sub-options (Start Cleaning, Pause, DND, Maintenance, Complete) are only explained **after** the user opens a cleaning session.
- One-time auto-show per user with per-step persistence; manual replay any time.
- Translations in each user's language (en / hu / es / vi / mn) — reuse `training-translations.ts`.
- Manager-only **Auto-Assign promo** shown once as a "What's New" detailed walkthrough.

## Architecture

### Data model (Supabase migrations)
Reuse existing tables; extend lightly:
- `training_guides` — add columns: `target_roles text[]` (replace single `target_role`), `category text` ('core' | 'feature_promo'), `auto_start boolean default true`, `priority int`, `icon text`.
- `training_guide_steps` — add: `route text` (e.g. `/`, `/dashboard?tab=housekeeping`), `tab text`, `precondition text` (named guard key, e.g. `has_active_assignment`, `cleaning_session_open`), `wait_for_event text` (e.g. `cleaning_started`), `optional boolean`, `media_url text`, `cta_label_key text`.
- New `user_training_state` table (one row per user) — `seen_promos text[]`, `last_resumed_guide uuid`, `last_step int`, `dismissed_until timestamptz`. Used for the "show once" rule and resume.
- Keep `user_training_assignments` for per-step completion (`completed_steps int[]`, `current_step`, `status`).
- RLS: user can read/write own rows; managers can read team progress (read-only).
- Add grants per project rule.

### New runtime (frontend)
Replace `GuidedTour` + `TrainingOverlay` with a single coherent module under `src/components/training/v2/`:

```
training/v2/
  TrainingProvider.tsx     // global state, resume, cross-page nav, event bus
  TrainingOverlay.tsx      // dimmed backdrop + spotlight + animated tooltip card
  TrainingTooltip.tsx      // modern card: progress, title, body, media, CTAs
  TrainingLauncher.tsx     // floating "Continue training" pill + Help menu entry
  WhatsNewDialog.tsx       // one-time feature promo (Auto-Assign)
  guards.ts                // precondition evaluators (has_active_assignment, ...)
  curricula/
    housekeeper.ts         // ordered steps in plain language
    manager.ts             // manager curriculum
    autoAssignPromo.ts     // feature-promo steps
  events.ts                // strongly-typed app event names
```

Key behaviors:
- **Cross-page navigation:** each step can declare `{ route, tab, selector, precondition, wait_for_event }`. The provider uses `useNavigate` + dispatches `tour:navigate` (already used) and waits (polling + event bus) for the target element to mount before showing the spotlight.
- **Smart waiting / deferral:** if `precondition` is false (e.g. `has_active_assignment` returns false because no rooms are assigned yet), the step is parked. The provider listens for `assignment_created`, `cleaning_started`, `cleaning_completed` etc., and re-evaluates. The launcher shows "Resume training — next: Start your first cleaning" so users know what unlocks it.
- **Contextual housekeeper-card deep-dive:** after the user clicks "Start Cleaning" on a card (we emit `cleaning_started`), the provider auto-advances to the in-session sub-steps (Pause/Break, Report Maintenance, Add Minibar, Mark Complete). For checkout vs daily it branches by `assignment_type`.
- **One-time auto-show:** on login, provider checks `user_training_state.seen_promos` and `user_training_assignments` for the user's role curriculum. If not seen and not dismissed → auto-start after 800 ms. "Don't show again" sets `dismissed_until = now() + 30 days`. Re-runnable from Help & Training menu.
- **Per-step persistence:** every `next`/`prev`/`skip` writes to `user_training_assignments` (`current_step`, `completed_steps`). Survives reload and device change.
- **Auto-Assign promo (managers only, once):** a separate `feature_promo` curriculum that opens an animated dialog explaining Auto-Assign value, then walks them through the actual auto-assign button with one click to assign today's rooms. Marked in `seen_promos = ['auto_assign_v1']` after completion or "Got it".

### Curricula content (plain language, step-by-step, ordered)

**Housekeeper — "Your First Day" (auto-starts once):**
1. Welcome + what this app does for you (no nav).
2. Sign in for your shift → highlights Attendance Sign-in button. **Precondition guard:** if not signed in, wait for sign-in event.
3. Find your assigned rooms → navigates to Housekeeping tab, spotlights "My Rooms".
4. Reading a room card — color codes, priority badge, guest notes. *(Deferred if no assignment yet.)*
5. **Cleaning a room — daily:** "Tap Start Cleaning to begin." Waits for `cleaning_started` event.
6. *(In-session, conditional)* Pause / Break button.
7. *(In-session)* Report a maintenance issue with photo.
8. *(In-session)* Add minibar consumption.
9. *(In-session)* Mark complete + upload required photos.
10. **Checkout room differences** (triggered first time `cleaning_started` with type=checkout): dirty linen, minibar check, deep-clean reminders.
11. Handling DND, refuse-service, lost & found.
12. Breaks & end-of-shift sign-out.

**Manager — "Run Your Day" (auto-starts once):**
1. Welcome + role overview.
2. Selecting a hotel + language (spotlights header switchers).
3. Team View — live housekeeper cards (done / working / pending).
4. **Auto-Assign promo** (embedded once) — see below.
5. Daily room assignment via UI — manual override, drag/drop, priorities.
6. Performance, Dirty Linen, Minibar Tracking tabs (quick tour).
7. Maintenance tickets — create, assign, SLA, photos.
8. Attendance — review staff sign-ins.
9. Purchase Invoices (if role has access).
10. Revenue (top_management / top_management_manager / admin only) — calendar & AI analyst.
11. HR Management basics.

**Auto-Assign feature promo (managers, once):**
- Modal: "New: Auto-Assign saves you 20 min every morning" with short benefits list.
- Step: navigate to Housekeeping → Team View → spotlight "Auto-Assign" button.
- Step: explain capacity, priorities, no-service rules.
- Step: live preview — click runs auto-assign for today; show resulting assignments.
- Step: "You can always override manually." → marks `auto_assign_v1` seen.

### Visual design (modern, matching Purchase Invoices polish)
- Glassmorphism tooltip card with `bg-card/95 backdrop-blur`, `border-border`, `shadow-2xl`, rounded-2xl, motion entrance.
- Animated step progress bar (`bg-primary` fill) + "Step 3 of 9".
- Spotlight: SVG mask with soft glow ring (animated pulse on the first frame).
- Floating bottom-right "Continue training" pill when paused.
- Mobile-responsive: tooltip docks to bottom sheet under `sm`.
- All colors via semantic tokens; no hardcoded hex.

### Translations
- Extend `src/lib/training-translations.ts` with new step keys for all curricula in en/hu/es/vi/mn.
- Each step references `step_key` resolved via current language (already supported).

### "Show once" rule (precise)
On first mount per session, provider runs:
```
if (role in housekeeper_roles && !assignment_completed('housekeeper_first_day') && !dismissed) start();
if (role in manager_roles && !assignment_completed('manager_run_your_day') && !dismissed) start();
if (role in manager_roles && !seen_promos.includes('auto_assign_v1')) queue WhatsNewDialog();
```
Resume uses `current_step` from `user_training_assignments`.

### Files to add / edit (high level)
Add: `src/components/training/v2/*`, `src/components/training/v2/curricula/*`, `src/contexts/TrainingProvider.tsx` (new), migration `add_training_v2_schema.sql`, translations expansion.
Edit: `src/App.tsx` (swap provider), `src/components/layout/Header.tsx` (Help & Training menu → launcher), `src/components/dashboard/HousekeepingTab.tsx` and housekeeper card to emit `cleaning_started`, `cleaning_completed`, `assignment_created` events, Auto-Assign button to emit `auto_assign_run`.
Deprecate (keep file but unused): `GuidedTour.tsx`, old `TrainingOverlay.tsx` — remove in a follow-up once verified.

### Out of scope (for this plan)
- Authoring UI for admins to edit training content (DB-seeded for now).
- Video recording / screen-capture lessons.
- Quiz / certification scoring.

## Acceptance checklist
- New housekeeper logs in → sees modern walkthrough once, in their language, that pauses smartly when no assignment exists and resumes when one is assigned.
- Cleaning sub-options only appear after Start Cleaning is clicked.
- Manager logs in → sees their curriculum once + Auto-Assign promo once.
- Training auto-navigates across tabs/pages.
- Per-step progress survives reload.
- Replayable from Help & Training menu anytime.
- "Don't show again" respected; not shown to users who've completed it.
