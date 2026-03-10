

## Plan: Highlight Tab Hierarchy with Light Blue Tint

### Problem
The user wants the active tab styling to be a **light blue tint** (not the current white card style), AND they want the **parent tabs** in the hierarchy to also be visually highlighted. For example, when viewing "Pending Approvals" under Housekeeping, both the "Housekeeping" main tab AND the "Pending Approvals" sub-tab should show the light blue highlight.

### Changes

#### 1. Revert tab active style to light blue tint — `src/components/ui/tabs.tsx`
Change active state back to the light blue approach:
```
data-[state=active]:bg-primary/15 data-[state=active]:text-primary data-[state=active]:font-semibold data-[state=active]:shadow-sm
```

#### 2. Ensure main tabs stay highlighted — `src/components/dashboard/Dashboard.tsx`
The main tabs already use controlled `value={activeTab}`, so the active main tab (e.g., "Housekeeping") is already `data-[state=active]`. The issue is that the current white card style doesn't provide enough contrast. Reverting to the blue tint in step 1 fixes this globally.

No structural changes needed — just the styling fix in `tabs.tsx` resolves the visibility across ALL tab levels (main tabs, housekeeping sub-tabs, inner tabs).

### Files Changed

| File | Changes |
|------|---------|
| `src/components/ui/tabs.tsx` | Change active state to `bg-primary/15 text-primary font-semibold shadow-sm` |

