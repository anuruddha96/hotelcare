# Hide the Revenue admin header for SLNT users

## What I verified first

- The highlighted block is rendered in `src/pages/RevenueHotelDetail.tsx` and contains:
  - The hotel title / "Revenue management" subtitle and sync status line (lines ~921–962).
  - The admin action buttons: "Sync now", "Bulk Edit", "Pull rates", "Autopilot", "Push" (lines ~968–989).
  - The reference-room banner showing the reference room name, unit count, and base price (lines ~1043–1057).
- These elements are currently gated by `isTechnicalAdmin` (`admin`, `top_management`, `top_management_manager`) and therefore appear for every org, including SLNT.
- `src/lib/tenantFeatures.ts` already holds per-organization flags; SLNT-specific behaviour is grouped under `SLNT_FEATURES`.
- No database changes are required.

## Plan

### 1. Add a tenant feature flag
- In `src/lib/tenantFeatures.ts`, add `revenueSimplifiedHeader: boolean` to `TenantFeatures`.
- Set `revenueSimplifiedHeader: true` in `SLNT_FEATURES`; keep it `false` in `DEFAULT_FEATURES` so RD Hotels, Ottofiori, and test orgs are unaffected.

### 2. Conditionally hide the header block for SLNT
- In `src/pages/RevenueHotelDetail.tsx`, import `useTenantFeatures`.
- Read `revenueSimplifiedHeader` from the hook.
- Wrap the following sections so they render only when `revenueSimplifiedHeader` is false:
  - The title/sync-status row with the Back button.
  - The admin action button row (`Sync now`, `Bulk Edit`, `Pull rates`, `Autopilot`, `Push`).
  - The reference-room banner.
- Keep everything below the tabs visible: the `Tabs` bar (`Rate Grid`, `Calendar`, `Strategy Calendar`, `Events`, `Analyst`, `Pricing Strategy`, `Sync history`), the calendar navigation, the currency selector, the KPI strip, and all tab content.

### 3. Verify isolation
- Confirm the build/typecheck passes.
- Confirm that for RD Hotels / Ottofiori the full header still renders.
- Confirm that for SLNT the header is gone and the page still loads the Rate Grid and KPIs correctly.

## Isolation guarantees
- The change is controlled by a tenant feature flag that defaults to `false`; only SLNT is opted in.
- No role checks, RLS policies, data queries, or revenue logic are modified.
