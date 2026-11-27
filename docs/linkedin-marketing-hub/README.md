# LinkedIn Marketing pilot

Company pages only. The Share on LinkedIn product's `w_member_social` scope authorizes a member profile, not a company. Request the Community Management API and verify the app has `w_organization_social` and `rw_organization_admin`. The current implementation deliberately limits page discovery to approved administrators and uses the versioned REST Posts API.

## Configuration (server secrets only)
- LINKEDIN_CLIENT_ID
- LINKEDIN_CLIENT_SECRET
- LINKEDIN_TOKEN_KEY: independent 32 random bytes, Base64 (`openssl rand -base64 32`). Never reuse Google Ads keys.
- LINKEDIN_PILOT_USER_ID: authenticated profiles.id for the exact existing RD Hotels anu_000 account, verified by an administrator. Not a nickname supplied by a browser.
- LINKEDIN_API_VERSION: supported YYYYMM version, defaults to 202611; verify before deployment and rotate before sunset.
- LINKEDIN_WORKER_SECRET: separate random secret; store matching scheduler secret in Vault.
- LINKEDIN_PUBLISH_ENABLED: leave absent or false until all gates below pass.

Exact OAuth redirect for the RD Hotels pilot:
https://my.hotelcare.app/rdhotels/linkedin-marketing

Register additional tenant-specific redirects only for authorized tenants. The OAuth flow binds short-lived single-use state to the signed-in user and organization; no token is sent to the browser. The service-only tables store AES-GCM ciphertext with tenant/page binding. Reconnect before token expiry; this pilot does not assume refresh-token access. Each company page may belong to only one tenant.

## Release blockers (draft PR)
1. Generate a timestamped migration from schema-draft.sql using the Supabase CLI; validate it in a disposable database, including RLS/grants and concurrent queue claiming. The SQL draft is intentionally outside the automatic migration path.
2. Run frontend build, access tests and edge function typecheck. Exercise cross-tenant access, user changes, forged OAuth state, missing/expired secrets, unauthorized page, duplicate request and cancellation tests with mocked upstream calls.
3. Deploy the migration and linkedin-marketing Edge Function to a test environment, then configure the private scheduler using the existing HotelCare Vault-backed pg_cron/pg_net pattern. Authenticate worker calls with x-worker-secret, never a service-role key. Verify worker health and concurrency.
4. Verify actual API approval and consent screen, explicitly select a real pilot company page (Treats & Stuff), confirm the organization URN, and validate access without posting. If API access is member-only, stop.
5. Turn on live publication only after review. Explicitly approve a real pilot post and confirm the upstream post ID and page. Unknown outcomes must be reconciled in LinkedIn rather than automatically retried.
6. Merge and deploy only when tests pass and all release blockers are closed.

## Scope
Initial text-only composer with explicit confirmation, preview, multi-page connections, queue/history/cancellation, and Mira draft handoff. No personal-profile publication, automatic AI posting, images, analytics, refresh-token automation, or comment management in this phase. A scheduled post is not a published post. The queue worker never retries ambiguous upstream publication outcomes automatically.

Access: effective organization administrators in their own organization, plus the exact pinned anu_000 account in rdhotels. Other roles are denied by the route and backend. The backend verifies the live profile and user identity, and rechecks authorization of the post creator and connection owner before each publish.
