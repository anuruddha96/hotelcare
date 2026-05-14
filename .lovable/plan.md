## Goal

Make the app feel "live" by silently syncing PMS + Revenue data from the Previo API whenever an eligible user logs in (manager, admin, top_management — never housekeepers, maintenance, reception), with a small, unobtrusive status indicator while it runs.

## Scope (only hotels with a Previo PMS config — Ottofiori untouched)

Sync targets per login:
1. **PMS rooms / today's checkouts** → `previo-pms-sync` (existing, hotel `previo-test` only for now)
2. **Revenue rates / occupancy** → `previo-pull-rates` (existing) + revenue snapshots
3. **Reservations** → `previo-sync-reservations` (existing)

Each is gated by the hotel having an active `pms_configurations` row, so OttoFiori (no Previo config) is naturally skipped.

## Architecture

### 1. New `useLiveSync` hook (`src/hooks/useLiveSync.tsx`)
- Runs on auth ready + role check (`manager | admin | top_management`)
- Reads `assigned_hotel` (or all hotels for admin) and checks `pms_configurations.is_active`
- Triggers sync tasks in parallel via `supabase.functions.invoke`
- Tracks per-task state in a global Zustand-style context: `idle | syncing | success | partial | error`, `lastSyncedAt`, `error`
- Throttle: skip if last successful sync < 2 minutes ago (sessionStorage key per hotel+task)
- Re-run on `window` `focus` event after 5+ min idle
- Never blocks the UI — fire-and-forget

### 2. New `LiveSyncContext` (`src/contexts/LiveSyncContext.tsx`)
- Provides `{ tasks: Record<TaskName, SyncState>, refresh(taskName?) }`
- Wrapped at App root inside `AuthProvider`

### 3. New `LiveSyncIndicator` component (`src/components/layout/LiveSyncIndicator.tsx`)
- Compact pill in `Header.tsx` (next to user menu): spinner + "Syncing PMS…" while any task running; green dot "Live · 2m ago" when idle; amber/red on partial/error with tooltip listing failed tasks
- Click opens a popover listing each task with status, last-synced time, manual "Refresh" button per task

### 4. Reuse existing surfaces
- `PmsRefreshButton` (Team View) — read state from `LiveSyncContext` instead of local state; manual click forces refresh
- `Revenue.tsx` page — replace the "Run engine" / upload-only flow with a top status banner reading from `LiveSyncContext.tasks.revenue`; show "Last pulled · X min ago" and a refresh button. Keep manual upload as fallback.
- `PMSUpload.tsx` — keep the upload as fallback for non-Previo hotels; for Previo hotels show "Auto-synced from Previo · last update X min ago" instead of the upload CTA (per earlier instruction to hide upload on test hotel)

### 5. Edge function additions
- New `previo-revenue-sync` wrapping `previo-pull-rates` for the next 120 days + writing into existing `previo_rate_snapshots` and feeding the revenue grid — single call per login
- Add `sync_type` values to `pms_sync_history`: `auto_login`, `auto_focus`, `manual`

### 6. Role gating
- `useLiveSync` early-returns for roles `housekeeper | maintenance | reception | front_desk`
- Server side: existing role checks in each edge function already prevent unauthorized sync

## Status indicator UX

```text
Header (top-right):
[●  Live · synced 2m ago ▾]   ← green
[⟳  Syncing PMS… ]            ← primary (spinner)
[●  Partial · 1 failed ▾]     ← amber
[●  Sync failed ▾]            ← destructive
```

Popover content:
```text
PMS rooms        ✓ 2m ago        [Refresh]
Reservations     ✓ 2m ago        [Refresh]
Revenue rates    ⟳ syncing…
```

## Safety / non-regressions

- OttoFiori has no `pms_configurations` row → loop yields zero tasks → no calls
- All sync calls are read-only against PMS; writes only to our own snapshot tables
- Housekeeper assignments are NOT touched (per existing memory rule — only manual/auto-assign resets them)
- Throttle + focus-based refresh prevents API hammering
- All errors swallowed into the indicator; never blocks navigation

## Files to add
- `src/hooks/useLiveSync.tsx`
- `src/contexts/LiveSyncContext.tsx`
- `src/components/layout/LiveSyncIndicator.tsx`
- `supabase/functions/previo-revenue-sync/index.ts`

## Files to edit
- `src/App.tsx` — wrap with `LiveSyncProvider`
- `src/components/layout/Header.tsx` — add `LiveSyncIndicator`
- `src/components/dashboard/PmsRefreshButton.tsx` — read from context
- `src/pages/Revenue.tsx` — show live status banner
- `src/components/dashboard/PMSUpload.tsx` — hide upload for Previo hotels, show live status

## Open question

Should the Revenue auto-sync run for **all hotels with a Previo config** on every eligible login, or only when a manager actually opens the Revenue page? (The first is more "live"; the second saves API calls.) Default in this plan: PMS sync runs on login; Revenue sync runs on login *and* on Revenue page open.