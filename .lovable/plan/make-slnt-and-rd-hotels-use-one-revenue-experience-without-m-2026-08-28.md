# Make SLNT and RD Hotels use one Revenue experience without mixing data

## Goal
SLNT executives should use the same Revenue interface and workflows as equivalent RD Hotels executives, with SLNT data only. Signing out should always return to `https://my.hotelcare.app/` with no organization slug.

## Verified root causes
- The current code intentionally gives SLNT a different Revenue UI: `revenueSimplifiedHeader` is enabled only for `slnt` / `slnt-group`, hiding the standard property header and controls. This conflicts with the requested RD parity and also explains why the prior header change did not produce one shared experience.
- The Revenue loader is shared, but SLNT's combined two-account published payload is much larger. A fresh browser session has only an in-memory hotel-keyed cache, so SLNT visibly reloads more often and for longer.
- Logout clears authentication but does not navigate. The current slug remains in the URL and route guards then send the signed-out user to `/{old-org}/auth`.
- Per-tab hotel state is stored without an organization key, and its validation checks only whether a hotel exists—not whether it belongs to the signed-in organization.
- Revenue payload memory is keyed only by hotel ID, not by organization + hotel.
- Live schema inspection confirms 20 tenant-scoped tables still default missing `organization_slug` values to `rdhotels` (one even defaults to the misspelling `rdhotls`). Combined with frontend `|| 'rdhotels'` write fallbacks, malformed or not-yet-loaded context can silently target the wrong tenant instead of failing closed.
- Current live data is correctly separated: the SLNT organization is `slnt`, its property is `slnt-group`, and all three SLNT executive profiles are assigned to that property.

## Implementation

### 1. Remove the SLNT-only Revenue fork
- Delete `revenueSimplifiedHeader` from tenant features and remove the conditional wrappers in `RevenueHotelDetail`.
- Render the same header, status, actions, tabs, calendar, and reference information for the same Revenue role in both organizations.
- Keep only legitimate SLNT operational differences: venues, staff venue scopes, two PMS accounts, and non-destructive dual uploads.

### 2. Make tenant and property context fail closed
- Introduce one strict organization/property context helper for Revenue reads, writes, navigation, and cache keys.
- Require the canonical organization slug before any tenant-scoped operation; remove `rdhotels` as a fallback from the Revenue path.
- Key Revenue caches by `organizationSlug + hotelId`, clear incompatible cached state when identity or organization changes, and never retain one tenant's payload under another tenant header.
- Namespace per-tab hotel selection by organization and verify the selected hotel belongs to that organization before applying it.

### 3. Normalize logout and login transitions
- After local sign-out state is cleared, navigate with a full-page replacement to `/` on the current canonical host, removing the old tenant slug and history entry.
- Clear per-user/per-tenant transient selection state during sign-out so the next account starts clean.
- Keep the existing profile-driven post-login redirect: RD users enter RD routes; SLNT users enter `slnt/slnt-group` routes.

### 4. Reduce repeated SLNT loading without weakening freshness
- Preserve the last verified published payload per organization/property during refreshes and resume checks.
- Avoid remounting or blanking the Revenue workspace when the same authenticated user returns to the same property; refresh in the background and swap only a complete payload.
- Keep the requested single seven-second quote behavior for genuine full-screen loading, but do not trigger an additional Revenue loading experience when valid scoped data is already displayed.
- Add focused timing/state instrumentation so large SLNT payload failures are distinguishable from access denial or missing publication.

### 5. Remove unsafe default-tenant behavior
- Replace tenant-scoped frontend write fallbacks with explicit guards, starting with Revenue and shared hotel-selection/auth flows, then all remaining operational writes found by the audit.
- Migrate existing public-table defaults from hardcoded `rdhotels` / `rdhotls` to the authenticated user's organization resolver where inserts are user-driven, or remove the default where callers must supply an organization explicitly.
- Preserve and verify RLS; do not widen anonymous or cross-organization access.

### 6. Verification
- Compare SLNT and RD executive sessions side-by-side: same Revenue controls, layout, tabs, loading behavior, and interactions; only names, currency/data, and legitimate tenant modules differ.
- Switch between an RD account and an SLNT account in one browser and confirm no stale hotel, payload, labels, or navigation survives the identity change.
- Confirm SLNT reads/writes only `organization_slug = 'slnt'` and `hotel_id = 'slnt-group'`; confirm SLNT cannot read or mutate RD Hotels Revenue data and vice versa.
- Confirm logout from nested RD and SLNT pages ends at bare `/`, including refresh/back-button behavior.
- Regression-test operational staff so housekeeping, maintenance, reception, venue scoping, and dual PMS upload behavior remain unchanged.

## Technical scope
- Frontend: tenant feature flags, Revenue detail/loader cache, auth logout, tab hotel storage, strict context guards, and focused tests.
- Database: narrowly scoped migration to replace unsafe organization defaults while retaining existing RLS and grants.
- No data merge, no shared SLNT/RD identifiers, and no redesign of unrelated modules.
