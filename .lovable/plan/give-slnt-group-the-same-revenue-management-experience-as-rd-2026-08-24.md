# Give SLNT Group the same Revenue Management experience as RD Hotels

## What I verified first

- SLNT's property (`slnt-group`, org slug `slnt`) already has revenue data on the server: 4,488 daily snapshots, 5,634 booking nights, 11,764 room-type rates, and a published atomic payload refreshed today at 16:03.
- Both SLNT Previo accounts are active in `pms_accounts`, and the server-side scheduler *does* cover SLNT (its eligibility check accepts either `pms_configurations` or `pms_accounts`). SLNT's last refresh was a manual user sync, RD's was the scheduler — so the plumbing works, it just hasn't been exercised through the UI.
- The Revenue page itself (`RevenueHotelDetail`) has **no** SLNT/venue-specific branches: same layout, same tabs, same atomic payload loader for both orgs.
- The real difference is navigation and setup, not the page:
  - The Revenue Management button is explicitly hidden for "property-style" orgs (SLNT) in both `MainTabsBar` and `PMSNavigation`.
  - `tenantFeatures` marks SLNT `housekeepingOnly: true` ("revenue module irrelevant").
  - Training curriculum drops the manager revenue chapter for property orgs.
  - One SLNT top-management profile has `assigned_hotel = "SLNT Group"` (display name) instead of `slnt-group`, so its landing redirect points at a non-existent hotel key — the other two are correct.
  - SLNT has no `previo_rate_plan_mapping` rows and no `revenue_pickup_automation_rules` row (RD's Ottofiori/Memories have both).

## Plan

### 1. Unhide Revenue Management for SLNT (UI only)
- `src/components/layout/MainTabsBar.tsx`: drop the `!propertyTerms.isProperty` condition — Revenue shows for exec roles in every org.
- `src/components/layout/PMSNavigation.tsx`: remove the same `isProperty` exclusion for the `revenue` nav item.
- Role gating stays exactly as today (`admin`, `top_management`, `top_management_manager`), so SLNT top management gets the identical entry points RD top management has.
- Keep SLNT's "Property/Properties" wording everywhere else — only the module visibility changes.

### 2. Flip the tenant flag
- `src/lib/tenantFeatures.ts`: set `housekeepingOnly: false` for SLNT and update the comment. Venue, scoped-staff, dual-upload and non-destructive-upload flags stay untouched, so housekeeping behaviour is unchanged.
- `src/components/training/v2/TrainingV2Provider.tsx`: stop filtering out the `v2_manager_revenue` chapter for property orgs, so SLNT managers get the same guided training.

### 3. Fix the SLNT landing redirect
- Data fix: normalise the one SLNT profile whose `assigned_hotel` is `SLNT Group` to `slnt-group`, matching the other two and matching RD's convention (`ottofiori`). Scoped strictly to `organization_slug = 'slnt'` so no other org is touched.

### 4. Match RD's revenue setup for SLNT
- Seed a `revenue_pickup_automation_rules` row for `slnt-group` using the same defaults RD uses (copied field-by-field from an existing RD row, with hotel/org identifiers rewritten to SLNT) so the Automation tab opens configured instead of blank. Automation stays disabled until an SLNT admin enables it.
- Rate-plan mapping needs live Previo data, so instead of guessing IDs the plan relies on the existing auto-discovery path (`_shared/previoRatePlans.ts`, which already reads `pms_accounts`): after the UI is visible, run a mapping refresh for `slnt-group` and confirm rows land in `previo_rate_plan_mapping`. Until then reads/graphs work and only rate pushes would be blocked.

### 5. Verification
- Confirm SLNT top management lands on `/slnt/revenue/slnt-group` and sees the same tab set, calendar position and KPI strip as RD.
- Confirm the published payload paints instantly (no "never synced" flash) and that the "Data from HH:MM" status plus 30-minute background refresh behave as on RD.
- Confirm RD Hotels, Ottofiori and the test org render byte-identically (no flag changes for them).

## Isolation guarantees

Every change is either org-scoped (`slnt` only) or removes a hide-rule that only ever applied to SLNT. No shared query, RLS policy, or hotel-key mapping is modified, so RD Hotels data cannot mix with SLNT: the Revenue page keys everything off `hotel_id`, and SLNT's single merged `slnt-group` property remains distinct from RD's four hotels.
