# Training V2 — Center, Admin Controls, Smart Resume, Analytics & A11y

Builds on the existing Training V2 module (`src/components/training/v2/*`, `user_tour_progress`, `user_training_state`). No business-logic changes outside training.

## 1. Training Center page (per user)

New route `/training` (link from Header help menu + a card on Dashboard for first-time users).

- File: `src/pages/TrainingCenter.tsx` + `src/components/training/v2/TrainingCenter.tsx`.
- Lists all curricula returned by `curriculaForRole(role)` plus any `feature_promo` available to the role.
- For each curriculum shows: name, description, total steps, status badge (Not started / In progress X/Y / Completed / Dismissed), last opened time, progress bar.
- Actions: **Start**, **Resume**, **Restart**, **Mark complete**, **Dismiss for 30 days**.
- Manual start path bypasses auto-start logic; sets a `manualStart` flag on the provider so the overlay opens immediately at the saved `current_step` (or 0 on Restart).
- "Don't auto-show again" toggle per curriculum (writes to `user_training_state.seen_promos` / `dismissed_until`).

## 2. Admin reset & re-trigger control

- New tab in `AdminTabs.tsx` → "Training" (admin + top_management_manager only).
- Component: `src/components/admin/TrainingAdminPanel.tsx`.
- Features:
  - Search users (existing employees list) → see per-curriculum status.
  - Bulk actions: **Reset** (clear `user_tour_progress` rows + remove from `seen_promos`), **Re-trigger auto-start** (clear `dismissed_until`, set `auto_start_pending=true`), **Mark complete**.
  - Role-level action: "Reset for all <role>" with confirmation.
- Backed by an edge function `training-admin-action` (uses service role to bypass RLS) — accepts `{ action, userIds[], curriculumSlugs[] }`.

## 3. Smarter preconditions & auto-recovery

Update `TrainingV2Provider.tsx` and `guards.ts`:

- Extend `GuardKey` with: `has_any_assignment_today`, `hotel_selected`, `data_loaded:<key>`, `is_online`, `not_switching_hotel`.
- Provider listens to:
  - `TenantContext` hotel changes → if mid-tour, pause overlay, show "Hotel switched — resume here?" banner, re-evaluate guards, jump to first step whose precondition is now true.
  - Custom event bus `window.dispatchEvent(new CustomEvent('training:data-ready', {detail:{key}}))` emitted from key data hooks (housekeeping cards, team view, assignments) so steps with `precondition: 'data_loaded:team_view'` wait reliably.
  - `online/offline` events → pause polling & show waiting state.
- New deferral model: instead of skipping a blocked step, park it and try the next satisfiable step; remember parked steps and offer them when their guard becomes true.
- Persist `last_active_step_key` to `user_training_state` so a refresh or hotel switch resumes exactly where left off.

## 4. Manager/admin analytics view

- Component: `src/components/training/v2/TrainingAnalytics.tsx`, surfaced as a section inside the new Admin Training tab and as a card on the Manager Dashboard ("Training adoption").
- Metrics (computed via SQL views, read-only):
  - Completion rate per curriculum, broken down by role.
  - Per-step funnel: users reaching step N / completing step N (uses `completed_steps[]`).
  - Dismissal count (rows where `dismissed_until > now()`), paused count (in_progress > 24h no update).
  - Average time-to-complete.
- New SQL views (migration): `v_training_completion_by_role`, `v_training_step_funnel`, `v_training_dismissals`. RLS: SELECT restricted to admin / top_management / *_manager via security-definer function `can_view_training_analytics()`.
- Charts use existing Recharts setup.

## 5. Accessibility & mobile improvements to overlay

Edit `TrainingOverlayV2.tsx`:

- Wrap card in `role="dialog" aria-modal="true" aria-labelledby aria-describedby`; move focus to card on mount; trap focus while open; restore focus to launcher on close.
- All buttons get explicit `aria-label`s; close button already has one — add `aria-keyshortcuts="Escape"` and wire Esc to `finish()`.
- Add `aria-live="polite"` region announcing step changes ("Step 3 of 12: <title>") and the waiting state.
- Spotlight ring gets `aria-hidden="true"`; tooltip references the spotlighted element via `aria-describedby` when possible.
- Mobile (`useIsMobile`):
  - Card becomes bottom sheet: full-width, `max-h-[70dvh]`, rounded-top, safe-area padding, internal scroll.
  - Tap targets `min-h-11 min-w-11`; Next/Back become full-width stacked buttons under 380px.
  - Spotlight auto-scrolls target into view with `scrollIntoView({block:'center', behavior:'smooth'})` and re-measures on `resize`, `orientationchange`, and `scroll` (throttled).
  - If selector resolves off-screen after scroll (e.g. element in collapsed drawer), show "Tap to reveal" CTA that emits `tour:navigate` to open the parent tab/drawer.
- Reduced motion: respect `prefers-reduced-motion` — disable pulse/scale animations.

## Technical details

**New files**
- `src/pages/TrainingCenter.tsx`
- `src/components/training/v2/TrainingCenter.tsx`
- `src/components/training/v2/TrainingAnalytics.tsx`
- `src/components/admin/TrainingAdminPanel.tsx`
- `supabase/functions/training-admin-action/index.ts`

**Edited files**
- `src/App.tsx` (route)
- `src/components/layout/Header.tsx` (link to /training)
- `src/components/admin/AdminTabs.tsx` (new tab)
- `src/components/training/v2/TrainingV2Provider.tsx` (manualStart, hotel-switch listener, parked steps, persistence of `last_active_step_key`, reduced-motion flag, analytics events)
- `src/components/training/v2/TrainingOverlayV2.tsx` (a11y + mobile sheet)
- `src/components/training/v2/guards.ts` (new guard keys)
- `src/components/training/v2/types.ts` (new GuardKey union, `analyticsEvent` on steps)
- Hooks emitting `training:data-ready`: `HousekeepingManagerView.tsx`, housekeeper cards container, Team View loader.

**Migrations**
- Add columns: `user_training_state.last_active_step_key text`, `user_training_state.auto_start_pending boolean default false`.
- Create analytics SQL views + `can_view_training_analytics()` security definer.
- GRANT SELECT on views to `authenticated`; policy gated by helper function.

**Out of scope**
- Authoring UI for curricula content.
- Video/quiz modules.
- Changes to non-training business logic.

```text
Header ──► TrainingCenter ──► (Start/Resume) ──► TrainingV2Provider
                                                       │
AdminTabs ─► TrainingAdminPanel ──► edge fn ───────────┤
                                                       ▼
                          guards.ts + data-ready events + hotel switch
                                                       │
                                                       ▼
                                          TrainingOverlayV2 (a11y/mobile)
                                                       │
                                                       ▼
                                          user_tour_progress / user_training_state
                                                       │
                                                       ▼
                                    SQL views ─► TrainingAnalytics
```
