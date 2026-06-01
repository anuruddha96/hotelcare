## Goals

Three fixes for executive roles (`admin`, `top_management`, `top_management_manager`) so they get the same Housekeeping / navigation experience as managers.

## 1. Revenue page is missing the top app Header

`src/pages/Revenue.tsx` renders only `MainTabsBar` + content — no `<Header />`, so the logo, Hotel switcher, Organization switcher, Language switcher, profile menu, etc. all disappear when an exec opens Revenue. `PurchaseInvoices.tsx` already renders `<Header />` and that page is fine.

**Change**: import `Header` (and keep `PMSNavigation` hidden for `top_management_manager` as today) and render it as the first child of the root `<div>`, exactly like `PurchaseInvoices.tsx`:

```tsx
return (
  <div className="min-h-screen bg-background">
    <Header />
    <div className="container mx-auto p-4 space-y-4">
      <MainTabsBar current="revenue" />
      ...existing content
    </div>
  </div>
);
```

Wrap the existing container in this outer shell so the sticky header sits above it.

## 2. "Purchase Invoices" tab wraps to two lines in MainTabsBar

`src/components/layout/MainTabsBar.tsx` — the buttons use `flex-1` with no `whitespace-nowrap`, so the long label collapses onto two lines and visibly breaks the bar (screenshot 698).

**Changes**:
- Add `whitespace-nowrap` to the `base` class.
- Drop `flex-1` and let labels size naturally; keep the existing `overflow-x-auto` wrapper so the bar scrolls on narrow viewports instead of wrapping. Remove `max-w-3xl` so the bar can grow to fit the longer exec-only set (6 tabs).
- For the Purchase Invoices trigger, render the label as one piece (`{t('pms.purchaseInvoices')}`) but ensure the translation string itself is a single line (already is in English — wrapping was caused by CSS, not the string).

Net effect: every tab stays on a single line; on small screens the bar scrolls horizontally.

## 3. Top Management / admin can't see full Team View → Hotel Room Overview

`src/components/dashboard/HotelRoomOverview.tsx` line 165 gates the rich overview UI:

```ts
const isManagerOrAdmin = profile?.role && ['admin', 'manager', 'housekeeping_manager'].includes(profile.role);
const canViewFullOverview = isManagerOrAdmin || isReception;
```

`top_management` and `top_management_manager` are excluded, so they lose: the Map/List view toggle, the same room cards/sections affordances managers get, and several other view-side branches keyed on `isManagerOrAdmin`. Admin is in the list, but the user reports the same gap because the *Map button* is gated by `canViewFullOverview` only (which also excludes execs).

**Changes**:
1. Introduce a clear split between read access and write access:
   ```ts
   const isWriteRole = profile?.role && ['admin', 'manager', 'housekeeping_manager'].includes(profile.role);
   const isExecViewer = profile?.role && ['top_management', 'top_management_manager'].includes(profile.role);
   const isManagerOrAdmin = isWriteRole; // keep name for all existing write/drag-drop gates
   const canViewFullOverview = isWriteRole || isExecViewer || isReception;
   ```
2. Replace every read-only UI affordance currently gated by `isManagerOrAdmin` with `canViewFullOverview`. Specifically the Map/List toggle button at line 1104 and the legend visibility checks. **Do not** change drag/drop, edit, assignment, or "ready to clean" mutation gates — those stay on `isManagerOrAdmin` (write role only) so execs remain truly read-only.
3. `HotelFloorMap` `isAdmin` prop stays `profile?.role === 'admin'` (admin-only admin features).

Result: `top_management`, `top_management_manager`, and `admin` see the full Hotel Room Overview (rooms grid, Map toggle, legend) in the Housekeeping → Team View tab, identical to managers, but cannot mutate.

`HousekeepingManagerView.tsx` and `HousekeepingTab.tsx` already grant Team View access to these roles (verified in `hasManagerAccess`), so no change needed there. The housekeeper cards / Team Summary already render whenever `housekeepingStaff` is non-empty for the assigned hotel — that part is data-driven, not gated by role.

## Files touched

- `src/pages/Revenue.tsx` — add `<Header />` wrapper.
- `src/components/layout/MainTabsBar.tsx` — `whitespace-nowrap`, drop `flex-1` / `max-w-3xl`.
- `src/components/dashboard/HotelRoomOverview.tsx` — split write vs view roles, expand `canViewFullOverview`, swap the Map-button gate.

## Out of scope

- No DB / RLS / migration changes.
- No new translations.
- No changes to housekeeping write actions — execs remain read-only.
