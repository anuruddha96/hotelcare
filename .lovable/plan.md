## Goals

Make `top_management_manager` a first-class, read-only "executive overview" role that mirrors what admins see but without admin/management controls, scoped to their organization. Surface Revenue and Purchase Invoices inline with the main tab bar (not in the top PMS bar). Clean up the role label and the odd "..English" glyph near the language switcher.

## Changes

### 1. Friendly role label (no more "top_management_manager")

`src/components/layout/Header.tsx` + `src/hooks/useTranslation.tsx`
- Add `roles.topManagementManager` translations: EN "Top Manager", plus hu/es/vi/mn equivalents.
- `getRoleLabel`: add `case 'top_management_manager': return t('roles.topManagementManager')`.
- `getRoleColor`: add `case 'top_management_manager': return 'bg-gray-800'` so the badge matches `top_management`.

### 2. Hotel switching for top managers

`src/components/layout/HotelSwitcher.tsx`
- Extend the allow-list from `['admin', 'manager', 'housekeeping_manager']` to also include `'top_management'` and `'top_management_manager'` so they can move across hotels in their org.

### 3. Read-only operational view (Tickets / Rooms / Housekeeping / Attendance + Revenue + Invoices)

`src/components/dashboard/Dashboard.tsx`
- Treat `top_management_manager` everywhere `top_management` is treated for tab visibility and default tab (housekeeping landing), but keep all management-only buttons (Manage Users, Access Control, Ticket Permissions, Admin tab) hidden — they remain gated by `canManageUsers` (admin only), which is already the case.
- Reuse the existing manager/admin/top_management TabsList branch for `top_management_manager`, then append two extra triggers visible only for `top_management` and `top_management_manager`:
  - `Revenue` (icon: TrendingUp)
  - `Purchase Invoices` (icon: Receipt)
- Clicking those triggers does NOT render an inline panel; it `navigate()`s to `/{org}/revenue` and `/{org}/purchase-invoices` respectively (keeps existing route-based pages). Visually they sit right next to Attendance in the same `TabsList`, satisfying the "next to main tabs, not on top" request.
- Housekeeping content for these roles already shows the read-only Team View + Performance (per existing top_management gate). No housekeeping write actions are exposed — confirm by reusing the same conditional render path used for `top_management`.

### 4. Hide the duplicated top PMS bar for top_management_manager

`src/components/layout/PMSNavigation.tsx`
- Remove `top_management_manager` from the top PMS nav (do not add it to `NAV_GATE_ROLES`). The user wants Revenue / Purchase Invoices to appear with the main tabs, not in the secondary top bar. `top_management` keeps the current bar; `top_management_manager` will only see the main tabs.

### 5. Route access for new tabs

- `Revenue.tsx` and `PurchaseInvoices.tsx` role gates: add `top_management_manager` to the allowed roles so the inline tab navigation does not bounce them. Restrict actions inside these pages to read-only for this role (no create/approve buttons) — gate write controls behind `['admin','top_management','control_finance', ...]` as today; just add view access.

### 6. Language switcher cleanup ("..English" / three dots)

`src/components/dashboard/LanguageSwitcher.tsx`
- The "dots" are caused by the SelectTrigger's flag span sitting next to a `hidden sm:inline` label inside a narrow trigger, producing CSS text-overflow ellipsis on certain widths. Fixes:
  - Widen trigger min width and add `whitespace-nowrap` + `overflow-visible` on the inner span so the label is never truncated.
  - Drop the redundant `min-w-[60px] sm:w-[180px]` in favor of `w-auto` with `px-3`, and render `{current.flag} {current.name}` together without ellipsis.
- Verify in the preview at 1001px that no "‥" glyph remains.

## Out of scope

- No DB / RLS changes. All edits are frontend gating + labels.
- No changes to admin/super-admin powers.
- No new pages — Revenue and Purchase Invoices reuse existing routes.

## Files touched

- `src/components/dashboard/Dashboard.tsx`
- `src/components/layout/Header.tsx`
- `src/components/layout/HotelSwitcher.tsx`
- `src/components/layout/PMSNavigation.tsx`
- `src/components/dashboard/LanguageSwitcher.tsx`
- `src/hooks/useTranslation.tsx`
- `src/pages/Revenue.tsx`, `src/pages/PurchaseInvoices.tsx` (role allow-list only)
