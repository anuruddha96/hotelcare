# Strict tenant URLs and one revenue refresh per 30 minutes

## Goal
Keep RD Hotels and SLNT Group completely separate in routing, UI, database reads, and server actions. Replace the misleading `/rdhotels/auth` entry point with a neutral login URL, then send each user only to their own organization. Make revenue refresh shared per property and honor the 30-minute window across users and browser tabs.

## Verified current problems
- `/auth` is unconditionally redirected to `/rdhotels/auth`, and the tenant router trusts the organization slug in the URL without comparing it with the signed-in profile.
- After login, the auth page redirects using the URL slug rather than the user's actual `organization_slug`.
- `TenantContext` can fall back to the user's own hotels while the browser remains on another organization's URL, producing mixed URL/UI context instead of rejecting the route.
- Several database policies/helpers are broader than tenant isolation requires: authenticated users can read every `hotel_configurations` row; `user_can_access_hotel` grants admin/executive roles access without confirming the hotel's organization; `is_revenue_user` is role-only; revenue history is readable across organizations; and profile admin/executive reads are not consistently organization-scoped.
- Revenue auto-refresh is initiated independently by the global live-sync provider and the revenue detail page. The checks are per browser instance, not atomic across tabs/users.
- The shared sync history currently has **zero** successful `revenue_sync` or `revenue_live` rows. Therefore the existing freshness helper always returns “stale,” even though other PMS timestamps and checkout polling continue to update.

## Implementation

### 1. Neutral login and canonical tenant routing
- Add `/auth` as the canonical, organization-neutral login route and stop redirecting it to RD Hotels.
- Keep old `/:organizationSlug/auth` links compatible, but treat the slug as presentation context only before authentication—not authorization.
- Once the profile loads, redirect to `/${profile.organization_slug}` regardless of the slug entered in the address bar.
- Add a tenant route guard around every `/:organizationSlug/*` route:
  - matching organization: render normally;
  - mismatched organization: replace the URL with the user's canonical organization route before any tenant page mounts;
  - explicit platform `is_super_admin`: retain intentional cross-organization administration;
  - missing/invalid profile organization: fail closed and sign out or show an access error rather than defaulting to RD Hotels.
- Remove runtime `rdhotels` fallbacks from authenticated redirects and prevent default profile creation from silently assigning a user to RD Hotels. Existing users keep their current profile organization.
- Clear the per-tab hotel selection if it does not belong to the authenticated user's organization.

### 2. Make database isolation authoritative
Apply a focused migration that keeps the browser guard as UX only and enforces the same boundary in Supabase:
- Harden `user_can_access_hotel` so access requires the target hotel to belong to the caller's organization, plus the existing property/role rules. Only explicit `is_super_admin` bypasses organization matching.
- Make `is_revenue_user` organization-aware at call sites; an executive role alone must not authorize another organization's hotel.
- Replace the global authenticated read policy on `hotel_configurations` with same-organization access.
- Scope `pms_configurations`, `pms_sync_history`, revenue tables, and profile management/read policies to the caller's organization and, where required, selected/assigned hotel.
- Correct the own-profile update rule so a normal user cannot change protected tenant, role, or hotel-assignment fields through a direct profile update. Organization/hotel switches remain privileged workflows.
- Preserve existing SLNT venue scoping and RD/Ottofiori behavior inside their own organizations.
- Review all affected Edge Functions (`previo-revenue-sync`, `previo-pull-revenue`, daily overview, rate publishing, and other hotel-id callers) so each resolves the requested hotel and verifies organization access server-side before using the service client.

### 3. One authoritative 30-minute revenue freshness gate
- Add a small per-property revenue sync state/lease record keyed by canonical `hotel_id`, containing organization, last successful refresh, current lease start, and lease expiry.
- Add a security-definer claim function that atomically returns one of: `fresh`, `already_running`, or `claimed`. It will:
  - validate the caller's organization/hotel access;
  - reuse a successful refresh for 30 minutes;
  - prevent concurrent refreshes from another tab or user;
  - expire abandoned leases safely.
- Make the full revenue sync the single automatic refresh path. On success it records `last_success_at`; on failure it releases the lease and records a concise error without marking data fresh.
- Ensure successful runs also write the expected dedicated revenue history row, but do not use checkout polling or unrelated PMS timestamps as revenue freshness.
- Remove duplicate automatic sync ownership from `LiveSyncContext`; it may display state and support an explicit manual refresh, but the revenue route owns the automatic claim.
- Keep lightweight local data reloads separate from Previo API refreshes. Opening/focusing a page may reload Supabase data, but it must not call Previo while the shared property refresh is fresh.
- Keep a periodic visible-page check, but route it through the same atomic gate; the interval can check every five minutes while still allowing at most one Previo refresh per property per 30 minutes.

### 4. Verification
- Add route-guard tests for anonymous login, SLNT user entering an RD URL, RD user entering an SLNT URL, canonical post-login redirect, invalid organization, and the explicit super-admin exception.
- Test the access functions/policies with SLNT and RD identities to prove cross-organization hotel configuration, profiles, rooms, assignments, revenue data, sync history, and Edge Function calls are denied.
- Test freshness outcomes: first caller claims, simultaneous callers receive `already_running`, completed sync remains `fresh` for 30 minutes, and a failed/stale lease can be retried.
- In the browser, verify neutral `/auth`, correct organization URL after login, direct URL tampering correction before tenant content renders, and independent hotel tabs within the same allowed organization.
- Inspect Edge Function logs and database state to confirm one revenue API pull per property in the window and a persisted successful revenue timestamp.

## Technical scope
Likely frontend files: routing/app shell, auth page/provider, tenant context/guard, tab-hotel helper, and live/revenue sync callers. Backend scope: one migration for organization-aware helpers/RLS and the sync lease, plus the revenue-related Edge Functions that accept `hotelId`. No tenant data will be moved or merged.