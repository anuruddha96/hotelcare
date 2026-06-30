## Scope

Three separate workstreams the user raised today:

1. **Bug** — Ottofiori rooms 302 & 303 weren't auto-marked as no-show / empty yesterday even though the PMS file had no guests.
2. **Training UX** — Housekeeper training behaves poorly (visible skips, no cross-page navigation, "flash next module" bug, weak module ordering), and needs voice-over in each user's locale.
3. **Notifications** — Logged-in users on phones should reliably receive relevant in-app notifications.

---

## 1. Ottofiori 302 / 303 no-show detection

### Investigate
- Query `rooms`, `reservations`, `pms_change_events`, and `daily_overview_snapshots` for Ottofiori 302/303 for yesterday's date to see what PMS actually delivered and what status each row carried.
- Check `previo-poll-checkouts` and `previo-sync-daily-overview` edge function logs for that window.
- Review the auto-assignment / "empty room" logic in `roomAssignmentAlgorithm.ts` and the nightly sync to find where a missing-guest signal should flip a room to "no service" or "empty".

### Fix
- If the PMS payload was correct but our classifier ignored it: tighten the rule (room has no active reservation on date → mark `no_service` / `empty` automatically before assignment runs).
- If the PMS payload was missing those rooms: add a reconciliation pass that, for any room not present in the daily overview, defaults to `empty` instead of carrying over yesterday's status.
- Add a one-time backfill for the two specific rooms so today's view is correct.
- Add a small audit log entry whenever auto-classification flips a room, so this is debuggable next time.

---

## 2. Housekeeper training overhaul

### A. Fix the pacing / navigation engine (`TrainingV2Provider.tsx`)
- **Silent skip**: when a step is deferred or its precondition fails, do NOT mount the overlay or show a toast — push to `deferred_steps` and advance internally. Only surface UI when the *next visible* step is ready.
- **"Flash first slide then jump"**: stop re-running the start effect on `stepIndex` change. Compute the first eligible step once on start, then render. Debounce `next()` more strictly (single in-flight guarantee).
- **Cross-page navigation**: every step declares `route` + `tab`. On `next()`, if target route ≠ current route, `navigate()` first, then wait for `location.pathname` match AND target selector to mount (MutationObserver) before revealing the spotlight. Never reveal the overlay until the element is in the viewport — scroll it into view.
- **Element-aware spotlight**: if the element is off-screen, `scrollIntoView({block:'center'})` then highlight. If it never appears within timeout, silently defer (no "Skipped" toast).

### B. Rebuild the housekeeper curriculum
Rewrite `housekeeper.ts` into clear ordered modules with proper `route`/`tab`/`selector` on every step:
1. Orientation (welcome, language, help button)
2. Sign in for shift (attendance)
3. My Assignments list
4. Start a room (deferred until an assignment exists — resumes proactively)
5. In-room: photos, minibar, DND, dirty linen
6. Finish & request approval
7. Break request flow
8. End of shift / sign out

Mark data-gated steps `optional: true` so the engine defers instead of skipping visibly.

### C. Voice-over in user locale
- Add an optional `voice` field per step (or auto-generate from `body[lang]`).
- Use the ElevenLabs `openai/gpt-4o-mini-tts` model (available via Lovable AI Gateway) through a new `training-tts` edge function. Cache generated audio in Supabase Storage keyed by `(stepKey, lang, version)` so each clip is generated once per language.
- Overlay gets a small play/pause + mute toggle; respects `prefers-reduced-motion` and a per-user "voice off" preference saved on `user_training_state`.
- Pick voice per locale (en/hu/es/vi/mn) with a sensible default.

### D. Housekeeper UI tidy-up (minimal)
- Add any missing `data-training` anchors the new curriculum needs (sign-in button, assignments list, start-room, photo-uploader, minibar tab, dirty-linen tab, finish button, break-request button).
- No business-logic changes to the housekeeper screens.

### E. Verify
- Extend `__tests__/curricula.test.ts`: every step has `route`, every selector-based step is either `optional` or has a globally-mounted anchor, no two consecutive steps share the same key.
- Playwright run as a housekeeper: orientation → sign-in → assignments → defer start-room → resume after assignment appears. Screenshot each step.

---

## 3. Smarter mobile notifications for logged-in users

### Investigate
- Audit `useNotifications`, `RealtimeNotificationProvider`, `EnhancedNotificationOverlay`, `serviceWorkerManager`, and `public/service-worker.js`.
- Confirm SW is registered on mobile Safari/Chrome after login, and that `Notification.permission` is requested at the right moment (not on cold load — on first relevant in-app event).

### Improve
- **Permission prompt timing**: ask once, contextually (e.g. right after a housekeeper signs in for shift, or a manager opens Tickets) instead of on first paint.
- **Relevance filter**: server-side via Realtime filters already partly done — extend to drop notifications for hotels other than `assigned_hotel` and for roles that don't care (e.g. don't show break-request toasts to housekeepers).
- **Foreground vs background**: when tab is visible → Sonner toast only; when hidden → SW `showNotification` with `tag` collapsing so the same event doesn't stack.
- **Re-validation on resume**: console logs show "Session expired while tab was backgrounded" → silently refresh the Supabase session before re-subscribing Realtime channels so notifications resume without a manual reload.
- **Persistent subscription**: keep one shared Realtime channel per user (not per provider mount) to avoid the duplicate-subscription cost noted in the Supabase guidance.
- **Per-user preferences UI**: use existing `notification_preferences` table — add a simple toggle group in profile (assignments, approvals, tickets, breaks).

### Verify
- Manual mobile test on iOS Safari + Android Chrome: install PWA, lock screen, fire a test event from an edge function, confirm banner.
- Add an edge function `notification-test` (admin-only) that fires a notification to a chosen user for QA.

---

## Technical notes

- No schema changes required for #2 beyond a `voice_enabled boolean` and `voice_lang text` on `user_training_state` (already has `deferred_steps`).
- Voice-over generation uses Lovable AI Gateway (`openai/gpt-4o-mini-tts`) — no extra secret needed.
- Notifications work continues to use the existing `public/service-worker.js`; no new SW file.
- All work stays inside existing files plus: `supabase/functions/training-tts/`, `supabase/functions/notification-test/`, and one migration.

---

## Out of scope (for this round)

- Airbnb-style multi-property org research (deferred earlier, still deferred).
- Manager training rewrite — only the engine fixes from §2A flow through to managers automatically; the manager curriculum copy stays as-is.
- Native push (FCM/APNs) — staying on Web Push via existing SW.

---

## Order of execution

1. Investigate 302/303 (read-only queries + log check) — fix or backfill.
2. Training engine fixes (§2A) — these also fix the manager "flash next module" bug.
3. Housekeeper curriculum rewrite + anchors (§2B, §2D).
4. Voice-over (§2C).
5. Notification improvements (§3).
6. Tests + Playwright verification.