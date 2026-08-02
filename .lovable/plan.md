## Problem

When Nykipanchuk_073 presses and holds **Start** on a room card, the app goes to a blank white screen. Other users are fine.

What I confirmed by reading the code:

- The Start button is `HoldButton` (`src/components/ui/hold-button.tsx`), which fires `updateAssignmentStatus('in_progress')` in `src/components/dashboard/AssignedRoomCard.tsx` after a 2s hold. It calls `navigator.vibrate` on touch start.
- On success the card re-renders into its `in_progress` layout (timer, checklist tiles, minibar, photo capture).
- `src/main.tsx` renders `<App />` with **no error boundary anywhere above the housekeeper views** — the only `ErrorBoundary` in the project is used inside `SimplifiedPhotoCapture`. So any render-time exception in the in-progress card unmounts the whole React tree and leaves a literally blank page, with no message, no recovery button, and nothing recorded.

That last point is the real app-side bug: whatever her device-specific trigger is (an unsupported browser API in the in-progress branch, or a low-memory WebView kill), the app currently has no safety net and no way for us to see the error. I have **not** yet identified the specific throwing line — it doesn't reproduce on other devices, and no error from her session exists in the logs we can read. So step 1 of the plan is to make the failure visible instead of guessing.

## Plan

### 1. Never show a white screen again (root safety net)
- Wrap the app in `src/main.tsx` (and inside `App`'s provider tree) with the existing `ErrorBoundary`, styled as a friendly full-screen fallback: message in the user's language, a **Reload** button, and a small "copy diagnostics" line.
- Add a `window.onerror` / `unhandledrejection` listener that renders the same fallback if a crash escapes React.

### 2. Isolate the room card
- Wrap each `AssignedRoomCard` (and the mobile card) in its own boundary, so a single bad room degrades to an inline "This room card failed to load — Retry" tile while the rest of the list keeps working. She can then still use other rooms and the manager can see which room breaks.

### 3. Capture diagnostics we can actually read
- On any caught crash, write one row to a small `client_error_logs` table (user id, hotel, route, room/assignment id, error message + stack, user agent, screen size, memory hint) via Supabase, plus `console.error`. This is what will finally tell us what her phone is doing — the crash is currently invisible to us.
- Include the last user action ("start-room") so we can correlate.

### 4. Harden the known device-sensitive spots in the start path
- Guard `navigator.vibrate` in `HoldButton` in a `try/catch` (some Android WebViews throw when vibration is blocked by permission policy).
- Guard date/`Intl` formatting used by the in-progress card (timer start time, Budapest-time helpers) so a malformed or null `started_at` renders "—" instead of throwing.
- Add `pointercancel` / `touchcancel` handling to `HoldButton` so an interrupted long press cleans up its timers rather than firing later against an unmounted card.

### 5. Verify
- Run the housekeeper flow in a headless browser at her phone's viewport, force a throw inside the in-progress branch, and confirm the fallback UI appears instead of a white screen and that a diagnostics row is written.
- Then ask her to try once more; whatever her device hits will now be captured, and I can ship the precise fix in a short follow-up.

## Technical notes

- Files: `src/main.tsx`, `src/App.tsx`, `src/components/ErrorBoundary.tsx` (extend with `onError` reporting + variant prop), `src/components/ui/hold-button.tsx`, `src/components/dashboard/AssignedRoomCard.tsx`, `src/components/dashboard/HousekeepingStaffView.tsx`, `src/components/dashboard/MobileHousekeepingCard.tsx`, plus a new `src/lib/clientErrorReporter.ts`.
- One migration: `public.client_error_logs` with grants (`INSERT` for `authenticated`, `SELECT` for admins via `has_role`), RLS enabled.
- If the diagnostics show no JS error at all when she crashes, the cause is a WebView out-of-memory kill; the follow-up would then be reducing in-progress card memory (lazy-mounting the photo/minibar dialogs instead of keeping them mounted).
