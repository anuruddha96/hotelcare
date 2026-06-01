## Plan

### 1. Fix executive header and navigation consistency
- Keep the global `Header` visible only on authenticated app pages where eligible users already operate, including `Revenue` and `Purchase Invoices`.
- Align `PMSNavigation` and `MainTabsBar` role gates so `admin`, `top_management`, and `top_management_manager` can move between dashboard, Revenue, and Purchase Invoices without losing access.
- Add loading-safe guards where role-dependent shells render, so async profile loading does not briefly hide the header or redirect incorrectly.

### 2. Make the Purchase Invoices tab stay on one line
- Tighten the shared tab bar layout so `Purchase Invoices` never wraps.
- Use single-line tab labels with horizontal scrolling instead of equal-width compression.
- Apply the same fix to the dashboard’s executive tab row if that older inline tab layout is still used anywhere, so there is no second wrapping case.

### 3. Restore Top Management/Admin read-only housekeeping visibility
- Update the housekeeping entry logic so `top_management` and `top_management_manager` land in Team View reliably and do not lose the overview while profile data is still loading.
- Make `HousekeepingManagerView` treat executive roles as read-only viewers of the same Team View content managers see.
- Keep write actions restricted to manager/admin write roles, but allow executives to see:
  - Hotel Room Overview
  - Team summary
  - live housekeeper cards / room load cards
  - read-only performance/overview data
- Audit the hotel filters used by Team View and Hotel Room Overview so executive users fetch the active hotel’s data instead of falling through to an empty result.

### 4. Implement the maintenance ticket creation form using the existing ticket system
- Extend the existing ticket creation flow instead of creating a second ticket system.
- Add/adjust a dedicated maintenance form with:
  - title
  - description
  - room number
  - priority
  - optional photo attachment
- Surface a generated ticket number in the UI immediately after creation and wherever maintenance tickets are listed.
- Keep hotel/organization scoping aligned with current ticket RLS and active-hotel behavior.

### 5. Add maintenance dashboards by role
- Rework maintenance ticket listing around the existing `tickets` table so views are role-based:
  - maintenance staff: assigned tickets only
  - managers/admin/top management: all visible maintenance tickets for the active hotel/scope
- Add filters for room, status, and priority plus ticket search.
- Show clear counts/status cards for maintenance tickets and reuse the current ticket detail/update flows where possible.

### 6. Preserve security and data isolation
- Keep all queries scoped by active hotel/organization and existing RLS expectations.
- If a database change is required for missing maintenance metadata, add it through a migration only.
- Do not widen write permissions for executive read-only access.

## Technical details
- Likely frontend files:
  - `src/components/layout/MainTabsBar.tsx`
  - `src/components/layout/PMSNavigation.tsx`
  - `src/pages/Revenue.tsx`
  - `src/pages/PurchaseInvoices.tsx`
  - `src/components/dashboard/Dashboard.tsx`
  - `src/components/dashboard/HousekeepingTab.tsx`
  - `src/components/dashboard/HousekeepingManagerView.tsx`
  - `src/components/dashboard/HotelRoomOverview.tsx`
  - `src/components/dashboard/CreateTicketDialog.tsx`
  - `src/components/dashboard/MaintenanceStaffView.tsx`
  - possibly `src/components/dashboard/TicketCard.tsx` / ticket detail components
- Likely database touch only if needed:
  - add a migration if existing `tickets` fields are insufficient for the maintenance-specific UI
- Existing foundations to reuse:
  - DB ticket number trigger already exists via `public.set_ticket_number()`
  - existing ticket permission and RLS functions already support scoped ticket creation/viewing
  - existing maintenance-specific UI should be consolidated onto `tickets` rather than split between `maintenance_issues` and `tickets` for the new dashboard flow

## Expected outcome
- Executives see the proper top header on Revenue and Purchase Invoices.
- Admins and Top Managers can move freely between executive pages and dashboard tabs.
- Purchase Invoices always stays single-line.
- Top Managers get the same housekeeping Team View visibility as managers, but read-only.
- Maintenance gets one consistent ticket workflow with creation, numbering, search, and role-based dashboards.