

## Plan: Improve Pending Approvals Section

### Problems Identified
1. No hotel-specific grouping -- all pending items are in a flat list regardless of hotel
2. No summary dashboard showing at-a-glance counts per hotel and per type
3. Room approval cards lack quality indicators (duration vs benchmark, flags for suspiciously fast/slow cleans)
4. No "Approve All" bulk action for managers with many pending items
5. Badge in the tab only shows total count, not broken down by category

### Changes

#### 1. Add Summary Dashboard at Top (SupervisorApprovalView.tsx)

Add a row of summary cards above the approval list:
- **Per-hotel breakdown**: Group pending items by hotel name, show count per hotel as colored cards
- **Category counts**: Room cleanings vs Maintenance tickets vs Early sign-outs
- **Urgency indicator**: Highlight items waiting longest (show "oldest pending: X min ago")

#### 2. Group Approvals by Hotel

Instead of a flat list, group room approval cards under collapsible hotel headers:
```text
┌─────────────────────────────────┐
│ 🏨 Hotel Alpha  (5 pending)    │
│   [Approve All for Hotel Alpha] │
├─────────────────────────────────┤
│  Room 101 - Daily Clean - 23m   │
│  Room 205 - Checkout - 41m      │
│  ...                            │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ 🏨 Hotel Beta   (2 pending)    │
│   [Approve All for Hotel Beta]  │
├─────────────────────────────────┤
│  Room 302 - Daily Clean - 18m   │
└─────────────────────────────────┘
```

#### 3. Add Quality/Flag Indicators per Approval Card

For each room approval card, compute and display:
- **Duration vs benchmark**: Green check if within range, yellow warning if fast (<8min daily, <20min checkout), red flag if very slow (>45min daily, >120min checkout)
- **Speed badge**: "Fast", "Normal", "Slow" with color coding
- **Floor info**: Show floor number for context

This helps managers instantly see which completions need closer inspection vs rubber-stamp approval.

#### 4. Add "Approve All" Bulk Action

- Per-hotel "Approve All" button that approves all pending rooms for that hotel
- Confirmation dialog showing count before executing
- Progress indicator during bulk approval

#### 5. Enhance the Pending Count Hook (usePendingApprovals.tsx)

Extend the hook to also return per-hotel breakdown data so the HousekeepingTab badge can optionally show hotel-specific info in a tooltip.

### Files to Edit
| File | Change |
|------|--------|
| `src/components/dashboard/SupervisorApprovalView.tsx` | Summary cards, hotel grouping, quality flags, bulk approve |
| `src/hooks/usePendingApprovals.tsx` | Return per-hotel breakdown counts |

### No database changes required -- all data already exists in room_assignments and tickets tables.

