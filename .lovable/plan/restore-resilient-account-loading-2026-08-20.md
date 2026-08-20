# Restore resilient account loading

## Goal
Make signed-in users enter Hotel Care automatically after a transient Supabase/PostgREST interruption, without being stranded on either an endless loader or a manual error screen.

## Confirmed findings
- The database is currently healthy, and the affected user still has a valid `rdhotels` profile with the expected role and assigned property.
- Authentication succeeds, but the profile request received a transient upstream `503` connection failure.
- `useAuth` currently converts any failed profile request into `profile = null` and does not retry it.
- Startup can request the same profile twice: once from `onAuthStateChange(INITIAL_SESSION)` and once from `getSession()`.
- The added 12-second screen in `Auth.tsx` only exposes that stuck state; its reload button does not repair the bootstrap logic.

## Implementation
1. **Make profile bootstrap recoverable**
   - Track loading, ready, retrying, missing, and failed outcomes separately instead of treating every error as a missing profile.
   - Retry transient network, timeout, and `5xx` failures automatically with bounded exponential backoff and jitter.
   - Treat an explicit successful “no profile row” response as the only missing-profile outcome.

2. **Deduplicate startup requests**
   - Use one in-flight profile promise per user so `INITIAL_SESSION` and `getSession()` share the same request.
   - Ignore stale completions after sign-out or identity changes.
   - Settle auth loading only after the active bootstrap attempt reaches a definitive result.

3. **Recover without the temporary error card**
   - Keep the normal Hotel Care loading experience while automatic retries are active.
   - Show an in-place retry action only if the bounded retry window is genuinely exhausted; do not reload the whole app.
   - Preserve strict tenant security: never infer or cache an organization, role, or property when profile verification is unavailable.

4. **Harden tenant bootstrap similarly**
   - Retry transient organization/hotel-loading failures without clearing previously verified in-memory tenant data.
   - Prevent a temporary organization query failure from being treated as an empty tenant.

5. **Verification**
   - Add focused tests for transient `503` recovery, duplicate startup events, genuine missing profiles, sign-out during retry, and retry exhaustion.
   - Verify signed-in startup and tenant routing in the browser, including a simulated first-request failure followed by recovery.
   - Confirm no cross-organization fallback is introduced and normal sign-out still clears all account state.

## Technical scope
Frontend authentication and tenant bootstrap only. No database schema or profile-data changes are required for the confirmed failure.