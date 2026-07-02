# Training Center Rebuild — Continuous Manager Flow

## Goals
1. Manager modules run as **one continuous walkthrough** (no jarring restarts between modules).
2. **Auto-prompt on first login** with clear Start / Skip / "Remind me later" options.
3. Training Center UI reorganized as **Module → Unit** (FAQ style), each unit launchable independently for replay.
4. Fix duplicates, ensure resume works across modules, group notifications so multiple toasts don't stack.

## What Ships

### 1. Continuous chained flow (engine)
- `TrainingV2Provider`: when a curriculum in a `chain[]` finishes, auto-advance to the next chained curriculum **without** closing the overlay or firing a completion toast per module. Show a single slim progress header: `Module 2 of 6 — Team & Assignments · Step 3/8`.
- One final completion dialog at the end of the whole chain (not per module).
- Persist chain position in `training_v2_progress` so resume returns to the exact module + step.
- Group Sonner toasts: replace per-step toasts with a single updating toast (`toast.loading` → `toast.success` at chain end). Enforce the "max 1 visible" rule from project memory.

### 2. First-login auto-prompt
- New `TrainingFirstLoginPrompt` (replaces the older `TrainingWelcomePrompt` for v2 users).
- Trigger: on first authenticated dashboard render **only if** `training_v2_progress` has no row for `v2_manager_complete_walkthrough` (or housekeeper equivalent) **and** user hasn't clicked Skip.
- Actions: **Start now** · **Remind me tomorrow** (24h snooze in localStorage + DB flag) · **Skip forever** (writes `dismissed_at` to `training_v2_dismissals`).
- Copy explains: "This will walk you through every module one after another. You can pause anytime — we'll resume where you left off." — in all 5 languages.

### 3. Training Center UI (Module → Unit FAQ)
- Left rail: **Modules** (Housekeeping, Maintenance, HR, Reception, Revenue, Invoices for managers; Attendance, My Tasks for housekeepers).
- Main pane: accordion of **Units** per module, FAQ style:
  - Question: "How do I sync PMS data?"
  - Answer: short 2-line explanation.
  - Buttons: **Show me** (launches that unit's spotlight tour) · **Mark done** · status chip (Not started / In progress X/Y / Done).
- One prominent **"Start full walkthrough"** button at top → launches the chained flow.
- Mobile (<768px): segmented control for modules, full-width unit cards, bottom-sheet tooltips.

### 4. Deduplication & unit metadata
- Add `module` and `unit` fields to `TrainingCurriculum` in `types.ts`.
- Audit existing `curricula/manager-*.ts` files; merge duplicated steps (help button, hotel switcher, PMS refresh appear in multiple curricula — keep once in a shared "Getting started" module and remove from the others).
- Delete `curricula/manager-complete.ts` (its role is replaced by the engine-level chain runner reading a single ordered array in `curricula/index.ts`).

### 5. Notification grouping
- Replace scattered `toast(...)` calls in the training layer with a single `useTrainingToast()` helper that dedupes and updates one toast id.
- Removes the "cascade of notifications" the user reported.

## Files touched
- `src/components/training/v2/TrainingV2Provider.tsx` — chain runner, single-toast helper, first-login trigger hook.
- `src/components/training/v2/TrainingCenter.tsx` — full rewrite (Module → Unit FAQ layout).
- `src/components/training/v2/TrainingOverlayV2.tsx` — chain-aware header, single completion dialog at chain end.
- `src/components/training/v2/TrainingFirstLoginPrompt.tsx` — new.
- `src/components/training/v2/types.ts` — add `module`, `unit`, `faqQuestion`, `faqAnswer`.
- `src/components/training/v2/curricula/*.ts` — add module/unit tags, remove duplicated steps.
- `src/components/training/v2/curricula/index.ts` — export `MANAGER_CHAIN`, `HOUSEKEEPER_CHAIN` ordered arrays.
- Delete `src/components/training/v2/curricula/manager-complete.ts`.
- DB: new `training_v2_dismissals` table (user_id, curriculum_slug, dismissed_at, snoozed_until) with RLS + grants.

## Out of scope (this pass)
- Maintenance property-filter, `usePropertyTerms()` wiring into UI, Daily Timesheet spotlight anchor — tracked in `.lovable/plan.md`, handled in the next pass.

## Question before I build
Should **housekeepers** also get the first-login auto-prompt (their walkthrough is much shorter — 1 module, ~8 steps), or only **managers**?
