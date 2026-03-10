

## Plan: Breadcrumb Navigation Path & Subtle Active Tab Styling

### Problem
1. The solid blue (`bg-primary`) active tab is too heavy — user wants a lighter, more elegant selection indicator
2. No visual breadcrumb showing the user's current position in the tab hierarchy (e.g., Housekeeping › Team View › Team View)

### Solution

#### 1. Softer active tab styling — `src/components/ui/tabs.tsx`
Replace the solid `bg-primary text-primary-foreground` with a subtle approach:
- Light blue background tint: `bg-primary/10`
- Primary-colored text: `text-primary`
- Bottom border accent: `border-b-2 border-primary`
- Keep the shadow for depth

This gives a clear but non-overwhelming selection indicator.

#### 2. Add breadcrumb path — `src/components/dashboard/Dashboard.tsx`
Add a breadcrumb bar below the header that dynamically shows the current navigation path based on the active tab states. Use the existing `Breadcrumb` components from `src/components/ui/breadcrumb.tsx`.

The breadcrumb will show:
- **Level 1**: The active main tab (Tickets, Rooms, Housekeeping, Attendance)
- **Level 2**: The active housekeeping sub-tab (Staff Management, Team View, Performance, etc.) — only when Housekeeping is selected
- **Level 3**: The active inner tab (Team View, Early Sign-Out Approvals) — only when Team View sub-tab is active

To achieve this, we need to:
- Track the active main tab in `Dashboard.tsx` (it already uses `defaultValue` but doesn't store it in state — change to controlled `value`)
- Pass the housekeeping sub-tab value up from `HousekeepingTab.tsx` via a callback
- Pass the inner tab value up from `HousekeepingManagerView.tsx` via a callback

#### 3. Propagate active tab state upward

**`HousekeepingManagerView.tsx`**: Add an `onActiveTabChange?: (tab: string) => void` prop that fires when the Team View / Early Sign-Out inner tab changes.

**`HousekeepingTab.tsx`**: Add an `onActiveTabChange?: (tab: string) => void` prop and an `onInnerTabChange?: (tab: string) => void` prop. Pass inner tab changes from `HousekeepingManagerView` up to `Dashboard`.

**`Dashboard.tsx`**: 
- Convert main tabs to controlled state (`activeMainTab`)
- Store `activeHousekeepingTab` and `activeInnerTab`
- Render a `Breadcrumb` component above the tabs showing the path
- Style the breadcrumb with a subtle design: small text, muted separators, the last item highlighted in primary color

### Files Changed

| File | Changes |
|------|---------|
| `src/components/ui/tabs.tsx` | Change active state to `bg-primary/10 text-primary border-b-2 border-primary` |
| `src/components/dashboard/Dashboard.tsx` | Add controlled tab state, breadcrumb navigation bar, pass callbacks to children |
| `src/components/dashboard/HousekeepingTab.tsx` | Add `onActiveTabChange` prop, forward inner tab changes |
| `src/components/dashboard/HousekeepingManagerView.tsx` | Add `onActiveTabChange` prop for inner tab tracking |

