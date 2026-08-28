# Executive resume freshness (admin / top management only)

Goal: when an admin or top-management user returns to HotelCare after being away, the Revenue page silently re-reads the latest published dataset — no manual browser refresh, no new Previo call, no lost UI state. Nobody else's behaviour changes.

## What gets built

### 1. A single central detector
New file `src/components/system/ExecutiveResumeRefresh.tsx`, mounted once inside the authenticated shell in `src/App.tsx`.

It only arms itself when there is a signed-in user AND the role is `admin`, `top_management`, `top_management_manager`, or `profile.is_super_admin === true`. For every other role it renders nothing and registers no listeners at all.

Behaviour:
- Records the timestamp when the page becomes hidden.
- Listens to `visibilitychange`, `window.focus`, `window.online`, `pageshow`.
- On return, computes idle time. Under 2 minutes: nothing happens. 2 minutes or more: one resume event fires.
- Constants: `RESUME_REFRESH_AFTER_MS = 2 * 60 * 1000`, `EXTENDED_RESUME_AFTER_MS = 10 * 60 * 1000`, `RESUME_DEBOUNCE_MS = 5000`.
- Duplicate protection: an in-flight flag plus a "last resume handled at" timestamp, so the three events mobile browsers fire together produce exactly one refresh. Also skipped while `document.visibilityState !== "visible"`.

On a qualifying resume it does two things:
- Dispatches `window.dispatchEvent(new CustomEvent("hotelcare:executive-resume", { detail: { idleMs, level } }))`.
- Calls `queryClient.invalidateQueries({ refetchType: "active" })` so only currently-mounted React Query screens (executive dashboard, tickets, notifications, invoices, analytics) re-read. Inactive cached queries are left alone.

The global `QueryClient` config in `App.tsx` is not changed — no global `refetchOnWindowFocus`.

### 2. Revenue reacts to the event
`src/hooks/useRevenueHotelData.ts` adds a mounted-only listener for `hotelcare:executive-resume` that calls its existing `reload()`. Because the hook is only mounted on the Revenue routes, only the hotel currently on screen refetches — via the existing `get_revenue_published_payload` RPC, which reads published Supabase data only. No Previo call, no sync claim, no push, no automation.

`reload()` already reuses the existing single-flight guard (`inFlightRef`) and does not clear the payload, so the calendar stays mounted with no spinner: selected hotel, month, date range, filters, open panels, expanded rows and scroll position all survive.

### 3. Unsaved edits are protected
Revenue keeps a module-level "an editor is dirty" registry (`src/lib/revenueEditGuard.ts`). The bulk price editor and quick rate dialog mark themselves dirty while they hold unsaved values. When a resume arrives and something is dirty, the Revenue reload is deferred and re-run once the editor closes clean. Local edits are never overwritten.

### 4. Subtle status only
No `WelcomeBackOverlay`, no full-page spinner, no toast, no `window.location.reload()`. The existing sync indicator shows a brief "Updating…" state. On failure, the currently displayed data stays exactly as-is; a small non-blocking inline message with Retry appears, and nothing touches the auth session.

## Explicitly untouched

Housekeeping in every form (tabs, staff/manager views, assignment, cleaning, DND, timers, completion, dirty linen, attendance, task lists), maintenance, reception, front office, breakfast, supervisor, marketing, finance, control, HR and ordinary manager. No files under the housekeeping components are opened or edited. `src/hooks/useAuth.tsx` and `src/contexts/LiveSyncContext.tsx` keep their current visibility logic unchanged. No new realtime channels are created.

## Tests

New `src/components/system/__tests__/executiveResume.test.tsx` covering: 30 s idle → no refresh; 3 min idle as top_management / admin / super admin → exactly one Revenue reload; housekeeping, reception and maintenance after 10 min → zero resume refreshes; `visibilitychange` + `focus` + `pageshow` fired together → one refresh; hotel, month and date selection unchanged after reload; dirty price edit preserved; reload path calls only the published-payload RPC (no PMS refresh, no external revenue sync, no price publish); no extra realtime subscriptions.

## Technical notes

- Files changed: `src/App.tsx` (mount the component), new `src/components/system/ExecutiveResumeRefresh.tsx`, new `src/lib/revenueEditGuard.ts`, `src/hooks/useRevenueHotelData.ts` (event listener), the two rate-editing components (dirty registration), the sync indicator (subtle "Updating…"), plus the new test file.
- Role gate reuses `src/lib/roleAccess.ts` (`isExecutiveRole`) with an added `RESUME_REFRESH_ROLES` set that includes `admin`, and an `is_super_admin` bypass.
