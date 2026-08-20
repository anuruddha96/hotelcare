# Restore reliable sign-in and monotonic loading

## Confirmed diagnosis

- Supabase Authentication is accepting the session, but the live `profiles` REST endpoint currently returns HTTP 503 with `delayed connect error: 111`. The database itself answers direct queries, so the failing layer is the Supabase REST/PostgREST path between the API gateway and Postgres—not the user's credentials or profile record.
- The app retries the profile query and then deliberately blocks access because it cannot verify the user's organization and property scope. That fail-closed behavior must remain for tenant security.
- The progress bar is not measuring one continuous operation. Separate route/auth/profile states render fixed values (18%, 36%, 52%, etc.), so remounts or state transitions can make the bar move backward.

## Implementation

1. **Make account bootstrap a single coordinated flow**
   - Consolidate session restoration and profile loading into one deduplicated bootstrap state so auth events cannot restart the same profile request or reset its visual state.
   - Keep the last valid session/profile visible in memory during transient revalidation instead of clearing it before a replacement succeeds.
   - Continue to fail closed when no profile has ever been verified; never create or infer an unscoped profile.

2. **Recover automatically from temporary REST outages**
   - Keep bounded per-request timeouts, then continue background reconnect attempts with a slower capped interval while the signed-in session remains valid.
   - Reset the retry cycle immediately when the tab returns or connectivity resumes.
   - Make “Try again” trigger a fresh request immediately without duplicating an in-flight request.
   - Do not use a database/RLS workaround; tenant and hotel scope still come only from the verified server profile.

3. **Replace fake/regressing progress with monotonic status**
   - Give the account bootstrap one progress owner and prevent its displayed value from decreasing during a login attempt.
   - Use stage-based copy: secure session, account access, workspace; retries hold the current value rather than jumping backward.
   - Replace the terminal account-error card with a reconnecting state that clearly says the session is safe and retries automatically, while retaining Sign out as an escape route.
   - Reset progress only after successful navigation or an explicit new sign-in attempt.

4. **Separate account loading from revenue refresh UI**
   - Stop the shared overlay from describing account/profile loading as “fetching prices, pickup and occupancy.”
   - Keep revenue-specific refresh messaging only on revenue pages; use account-specific messaging during authentication and property access checks.

## Verification

- Simulate a valid session with the profile endpoint returning 503 several times, then succeeding; confirm the user enters the correct organization without pressing retry.
- Confirm simultaneous `INITIAL_SESSION`/`SIGNED_IN` events create only one profile request.
- Assert progress never decreases across session, retry, profile, and navigation states.
- Verify “Try again” does not create duplicate requests and Sign out still works.
- Verify successful signed-in navigation on desktop and the 440px mobile viewport shown in the screenshots.
- Confirm no cross-organization or cross-hotel access is possible and no RLS/database changes are introduced.

## Operational note

The frontend can recover cleanly and automatically, but it cannot serve hotel data while Supabase REST itself is returning 503. After implementation, re-probe the live REST endpoint and verify the signed-in flow; if the endpoint remains connection-refused, the connected Supabase project's REST service must be restored/restarted at the provider layer before any client can load application data.