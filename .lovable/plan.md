

## Plan: Fix Tab Hierarchy Highlighting

### Root Cause
Two issues making active tabs invisible:
1. **`overflow-x-auto` on TabsList** clips the `ring-2` outline — it renders outside element bounds and gets cut off
2. **`bg-background` vs `bg-muted`** is white-on-light-gray — nearly zero contrast

### Solution

#### 1. `src/components/ui/tabs.tsx` — Use visible styling that doesn't get clipped
Replace `ring-2` (paints outside, gets clipped) with `border-2` (paints inside). Replace `bg-background` with `bg-blue-50` for an unmistakable light blue highlight:

```
data-[state=active]:bg-blue-50
data-[state=active]:text-primary
data-[state=active]:font-bold
data-[state=active]:shadow-sm
data-[state=active]:border-2
data-[state=active]:border-primary/40
```

This uses `border` instead of `ring`, so it won't be clipped by `overflow-x-auto`. The `bg-blue-50` is clearly distinguishable from the gray `bg-muted` background.

#### 2. No other files need changes
The Radix `data-[state=active]` attribute is correctly applied at every level (main tabs, sub-tabs, inner tabs). The only problem is the CSS styling being invisible. One fix in `tabs.tsx` fixes all three levels simultaneously.

### Files Changed

| File | Change |
|------|--------|
| `src/components/ui/tabs.tsx` | Replace `ring-2` with `border-2`, replace `bg-background` with `bg-blue-50` |

