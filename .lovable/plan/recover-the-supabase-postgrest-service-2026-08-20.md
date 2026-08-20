# Recover the Supabase PostgREST service

## Confirmed root cause

- The live `postgrest_logs` show the green deployment slot repeatedly failing before PostgREST can start:
  - `/opt/postgrest-bluegreen/slots/green/postgrest: ... GLIBC_2.32 not found`
  - `GLIBC_2.33 not found`
  - `GLIBC_2.34 not found`
- Direct PostgreSQL queries and scheduled database jobs are succeeding, while public REST requests return 503. This isolates the incident to the Supabase-managed PostgREST executable/runtime, not Hotel Care queries, RLS, credentials, or profile data.
- SQL cannot repair a missing operating-system C library, and changing the application or database would not make this binary executable.

## Recovery plan

1. **Preserve evidence and avoid unsafe database changes**
   - Capture the current PostgREST crash-loop messages and timestamps for the incident.
   - Make no schema, RLS, extension, or frontend workaround changes; those cannot resolve the binary/runtime mismatch and could weaken tenant isolation.

2. **Replace or roll back the broken PostgREST slot**
   - Use the connected Supabase project's infrastructure controls to restart/restore the API service so Supabase redeploys a compatible PostgREST binary, or rolls traffic back from the incompatible green slot to the last healthy slot.
   - If the project dashboard exposes only a project restart, restart the project once; do not repeatedly restart the database.
   - This operation must occur on Supabase infrastructure because Lovable has no host access or service-restart API for a user-managed Supabase project.

3. **Escalate immediately if restart retains the green binary**
   - Open a Supabase support incident for project `pcmszqqklkolvvlabohq` with the exact path, ARM architecture context, missing GLIBC versions, persistent REST 503s, and confirmation that PostgreSQL remains healthy.
   - Request rollback/replacement of the green PostgREST artifact or migration of the project compute image to a compatible runtime.

4. **Verify service recovery before declaring success**
   - Probe `/rest/v1/` until it returns an authenticated API response rather than 503.
   - Verify the signed-in `profiles` request succeeds, then check training assignments and motivational quotes.
   - Confirm a real user reaches the correctly scoped organization and hotel and that no cross-tenant fallback was introduced.
   - Recheck PostgREST logs to confirm the GLIBC crash loop has stopped.

## Technical boundary

This is a provider-runtime incident, not a database migration. The actionable fix is replacing or rolling back the incompatible PostgREST binary on Supabase's host. Hotel Care's retry/loading logic can reduce disruption, but users cannot securely use database-backed features until that service is healthy.