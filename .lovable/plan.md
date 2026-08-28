# Restore SLNT Revenue parity with RD Hotels

## Goal
Give SLNT Group executive users the same complete Revenue Management access and interaction model as RD Hotels, while keeping every other organization unchanged and preserving strict tenant isolation.

## Verified findings
- SLNT already has a healthy, recently published Revenue dataset for `slnt-group` (34 room types, 11,830 rates, roughly 6 MB), so the screen is not empty because Previo failed to sync.
- The failing screen is shown only when the client-side `get_revenue_published_payload` call returns no usable payload and no cached room types.
- That RPC adds a second authorization check through `user_can_access_hotel(auth.uid(), hotel_id)`. SLNT data is stored under organization `slnt` and hotel `slnt-group`; the current SLNT top-management profiles are assigned to `slnt-group`.
- Navigation and role helpers already expose Revenue to SLNT top-management roles, and SLNT's tenant feature flags explicitly enable full Revenue Management.
- The database currently has billing settings under `slnt`, not `slnt-group`; the implementation must consistently use the canonical organization slug and must not treat the hotel ID as an organization slug.

## Implementation
1. **Fix the Revenue data access boundary**
   - Harden the published-payload access function so canonical organization membership, executive role, assigned property, and approved property scopes resolve consistently for `slnt` / `slnt-group`.
   - Keep authorization server-side and deny cross-organization reads.
   - Add explicit grants/security settings needed by authenticated users without widening anonymous access.

2. **Make the Revenue loader resilient and actionable**
   - Preserve the last valid property dataset during refreshes and hotel switches.
   - Distinguish access denial, missing publication, expired session, and transient transport failure instead of collapsing them into the same blank screen.
   - Add a retry control and a concise status message; never show partial figures under the wrong hotel header.

3. **Match RD Hotels Revenue engagement for SLNT executives**
   - Audit and remove any remaining SLNT-specific suppression across the portfolio/detail route, rate grid, analytics, events, strategy, bulk pricing, history, sync, and automation controls.
   - Use the existing centralized Revenue role helpers so SLNT `top_management` and `top_management_manager` receive the same Revenue capabilities as their RD equivalents.
   - Keep billing tier distinctions intentional: BI access controls analytics; BI + Automation controls automated pricing actions. Trial access remains honored.

4. **Normalize tenant and hotel identifiers**
   - Use `slnt` as the organization boundary and `slnt-group` as the property ID throughout routing, billing, payload access, and mutations.
   - Remove ambiguous fallbacks that could substitute an RD Hotels slug or mix display names with stable property IDs.

5. **Regression and security verification**
   - Verify an SLNT top-management session can open the full `slnt-group` Revenue screen and use every entitled interaction.
   - Compare the visible controls and workflows against an equivalent RD Hotels top-management session.
   - Test property switching, reload/resume, expired-session retry, and the large SLNT payload on desktop and mobile.
   - Confirm an SLNT user cannot read or mutate RD Hotels Revenue data, and operational staff access remains unchanged.

## Technical scope
- Frontend Revenue route, loader/error state, centralized role/entitlement checks, and stable tenant/property resolution.
- Supabase published-payload access function/policies and any narrowly required grants.
- Focused tests for SLNT executive access, RD parity, billing-tier behavior, and cross-tenant denial.
- No redesign of unrelated modules and no access changes for housekeeping, maintenance, reception, or other tenants.
