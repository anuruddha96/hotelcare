## Goals

Three connected fixes for the **Top Manager** role (and where applicable `top_management`):

1. Restore cross-module navigation while on Purchase Invoices / Revenue.
2. Give Top Manager read-only Housekeeping visibility (instead of "Access restricted").
3. Make the Attendance section an executive overview (all-staff records) for `top_management`, `top_management_manager`, `admin`, `hr`.

## Changes

### 1. Persistent main-tabs bar on Revenue & Purchase Invoices

Create `src/components/layout/MainTabsBar.tsx` — a stateless horizontal tab strip with the same icons/labels as the dashboard's main tabs:
- Tickets, Rooms, Housekeeping, Attendance — `navigate('/{org}?tab=<key>')`
- Revenue, Purchase Invoices — `navigate('/{org}/revenue')` / `navigate('/{org}/purchase-invoices')`
- Visible only when `profile.role ∈ {manager, housekeeping_manager, admin, top_management, top_management_manager}`. Revenue/Invoices triggers shown only for `admin / top_management / top_management_manager`.
- Highlights the current location via a `current` prop.

Wire-up:
- `src/pages/Revenue.tsx`: render `<MainTabsBar current="revenue" />` directly under the page heading row (keep the existing "Back" button).
- `src/pages/PurchaseInvoices.tsx`: render `<MainTabsBar current="purchase-invoices" />` between `<Header />` and the page container. PMSNavigation stays hidden for `top_management_manager` (already gated).
- `src/pages/Index.tsx` / `Dashboard.tsx`: on mount, read `?tab=` from `useSearchParams()` and call `setActiveTab(...)` when it matches a valid tab. This lets cross-page navigation land on the right tab.

### 2. Housekeeping RO for Top Manager

`src/components/dashboard/HousekeepingTab.tsx`:
- Extend the `hasManagerAccess` list with `'top_management_manager'` (already includes `'top_management'`). This removes the "Access restricted" wall.
- Add `const isExecutiveReadOnly = ['top_management', 'top_management_manager'].includes(userRole);`
- For executives, default `activeTab` to `'manage'` (Team View) regardless of the PMS-upload-today check.
- From `getTabOrder()`, filter out `'pms-upload'` and `'staff-management'` when `isExecutiveReadOnly` (those are operational, not informational).
- Pass an `isReadOnly` prop (or reuse the existing `isReadOnlyAccess` shape) into the rendered sub-tab components so action buttons can hide. Scope of this change here: just flip the entry gate + tab filtering. Per-button RO enforcement remains as-is for now; the visible tabs are already mostly informational (Team View, Performance, photos, dirty linen, attendance, minibar tracking).

### 3. Executive Attendance overview

`src/components/dashboard/Dashboard.tsx`:
- In the `attendance` `TabsContent`, render differently for executives: skip the personal `<AttendanceTracker />` (they don't clock in) and render `<AttendanceReports />` full-width with a heading "Staff Attendance — {hotel/organization}". Detect with `const isExecutive = ['admin','top_management','top_management_manager','hr'].includes(profile?.role || '')`.
- Keep current behaviour for `housekeeping / maintenance / manager`.

`src/components/dashboard/AttendanceReports.tsx`:
- Extend the `isAdmin` flag (line 52) to include `top_management_manager`. This already enables the employee filter dropdown and the all-staff query path (`get_employees_by_hotel` RPC + admin branch). Verify the RPC honours `assigned_hotel` scoping — it does, per the function name.
- Add a small organization/hotel context line at the top of the card ("Showing: {hotel_name}") so executives know the scope; already filtered server-side.

`src/components/dashboard/AttendanceTracker.tsx`:
- No change required; it's no longer rendered for executives.

## Out of scope

- No DB / RLS / migration changes — RPCs already enforce hotel scoping.
- No per-button audit inside every housekeeping sub-tab (call out as follow-up if the executive needs strict RO).
- No new tour steps.

## Files touched

- new: `src/components/layout/MainTabsBar.tsx`
- `src/pages/Revenue.tsx`
- `src/pages/PurchaseInvoices.tsx`
- `src/components/dashboard/Dashboard.tsx`
- `src/components/dashboard/HousekeepingTab.tsx`
- `src/components/dashboard/AttendanceReports.tsx`
