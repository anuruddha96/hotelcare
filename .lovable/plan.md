

## Plan: Fix Hotel Room Overview Mobile Layout

The core problem is in the `CardHeader` (lines 528-577): the title, room count, Early Checkout badge, No-Show badge, ACT badge, Map button, and Refresh button are all in a **single flex row** (`flex items-center gap-2`). On mobile this overflows and looks cramped/misaligned.

### File: `src/components/dashboard/HotelRoomOverview.tsx`

**1. Restructure the header into stacked rows (lines 528-577)**

Replace the single `CardTitle` flex row with a proper multi-row layout:
- **Row 1**: "Hotel Room Overview" title + room count badge
- **Row 2**: Stats/alert badges (Early Checkout, No-Show, ACT) — wrap naturally using `flex-wrap`
- **Row 3**: Action buttons (Map toggle, Refresh) — right-aligned

This prevents the current single-line overflow on mobile.

**2. Make the legend collapsible on mobile (lines 578-604)**

The 13-item legend takes too much vertical space on mobile. Wrap it in a collapsible section:
- Show a small "Legend" toggle button
- Default collapsed on mobile, expanded on desktop
- Uses simple state toggle, no extra dependencies

**3. Tighten badge sizing for mobile**

- Early Checkout / No-Show badges: use `text-[10px]` on mobile instead of `text-xs`
- ACT badge: keep compact

### Summary

| Change | Detail |
|--------|--------|
| Header layout | Split single flex row into 3 stacked rows |
| Legend | Make collapsible with toggle button |
| Badge sizing | Smaller text on mobile for stat badges |

