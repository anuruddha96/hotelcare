

## Plan: Fix Active Tab Visibility

### Problem
The active tab styling (`bg-background` = white, `shadow-sm`) is nearly invisible against the white page background. Users cannot tell which tab they are in.

### Solution
Update `src/components/ui/tabs.tsx` to give the active tab a clear primary-colored indicator. Change the active state from a barely-visible white+shadow to a primary-colored bottom border and text color, making it immediately obvious which tab is selected.

### Changes

**`src/components/ui/tabs.tsx`** — Update `TabsTrigger` active state:
- Replace `data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm`
- With `data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-primary`

This gives every tab across the entire app (main dashboard tabs, housekeeping sub-tabs, admin tabs, the Team View / Early Sign-Out tabs) a clear blue highlight when active — consistent and unmistakable.

### Single file changed
| File | Change |
|------|--------|
| `src/components/ui/tabs.tsx` | Active tab: primary tint background + primary text + primary bottom border |

