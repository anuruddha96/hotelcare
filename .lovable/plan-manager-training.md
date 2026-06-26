# Manager Training — Redesign Plan (separate from housekeeper)

Status: **planning only, not yet implemented**. The housekeeper curriculum
(`v2_housekeeper_first_day`) is currently the only auto-started flow. The
manager curriculum (`v2_manager_run_your_day`) exists but needs a ground-up
rewrite based on what managers actually do day-to-day.

## Why a separate plan

A manager's first day is **completely different** from a housekeeper's:

| Housekeeper                          | Manager                                          |
| ------------------------------------ | ------------------------------------------------ |
| One device, one shift, linear flow   | Multi-hotel, multi-tab, jumps around all day     |
| Personal actions (sign in, clean)    | Oversight actions (assign, approve, review)     |
| Triggered by physical work           | Triggered by data/exceptions on the screen      |
| Single language, simple vocabulary   | Mixes ops vocabulary (SLA, pickup, ADR, RevPAR) |

Trying to share steps between the two curricula leads to the bug we just
fixed (managers seeing "Sign in for your shift"). The manager flow must live
in its own curriculum file, with its own auto-start gate, its own language,
and its own selectors.

## Audience

Roles that should receive this curriculum:
- `housekeeping_manager`
- `maintenance_manager`
- `reception_manager`
- `manager`
- `top_management_manager`
- `top_management` (optional, with a few extra Revenue / Invoice steps)
- `admin` (optional)

Each sub-role only gets the modules relevant to them — see "Modular structure" below.

## Modular structure

Instead of one 12-step linear tour, split into **modules** the manager can
pick from, plus a short mandatory "orientation" that always runs first.

```
v2_manager_orientation              ← auto-start, 4 steps, all manager roles
v2_manager_team_and_assignments     ← housekeeping_manager + manager
v2_manager_tickets_and_sla          ← maintenance_manager + manager
v2_manager_reception_handover      ← reception_manager + manager
v2_manager_attendance_and_payroll   ← all managers
v2_manager_revenue                  ← top_management(_manager) + admin
v2_manager_purchase_invoices        ← top_management(_manager) + admin
```

Auto-start runs only `v2_manager_orientation`; the rest appear in the
Training Center as recommended next steps and can also be triggered
proactively (e.g. open the Revenue module the first time a top-manager
visits `/revenue`).

## Orientation module (always runs first)

1. **Welcome** — what this app does and how the tour works.
2. **Hotel switcher** — top-right; everything filters by it.
3. **Language switch** — every manager screen is fully translated.
4. **Help button** — "you can replay any of this from here at any time".

Total: ~60 seconds. After this, the Training Center shows the rest as cards.

## Team & assignments module (housekeeping_manager / manager)

- Team View — what each tile means (in progress / done / break).
- Auto-Assign — one-click distribution, can override.
- Manual override — drag rooms, change priority, mark No Service.
- Public Areas — how those are scheduled separately.
- Pending Approvals — early sign-out requests land here.

## Tickets & SLA module (maintenance_manager / manager)

- Ticket list, filters, SLA color codes.
- How a ticket is created from a housekeeper photo.
- Assigning to a maintenance staff member.
- Hold / approval workflow for expensive repairs.

## Reception handover module (reception_manager / manager)

- Daily Overview upload (already covered by ReceptionHome).
- Breakfast lookup (/bb).
- Check-in / check-out from FrontDesk.
- Guest minibar reconciliation.

## Attendance & payroll module (all managers)

- Live attendance — who is on, who is on break.
- Daily timesheet view.
- Approving early sign-out requests.
- Exporting for payroll.

## Revenue module (top_management(_manager) / admin)

- 120-day grid and how colors map to occupancy.
- AI analyst card and how to act on a suggestion.
- Pickup / ADR / RevPAR vocabulary refresher.
- Strategy calendar and rate-plan mapping.

## Purchase invoices module (top_management(_manager) / admin)

- Upload a PDF/photo, AI extraction.
- Review / edit extracted line items.
- Approve & lock workflow.

## Language

Manager UI is shown in 5 languages (en, hu, es, vi, mn) the same as
housekeeper, but the **tone** is different:
- More precise (no "tap" everywhere — managers are on desktop too).
- Uses ops vocabulary without translating it (SLA, ADR, RevPAR, pickup).
- Shorter — managers skim, housekeepers read.

Each `I18nText` block in the manager curricula should be drafted in EN first,
then reviewed by a native speaker per language. Do NOT machine-translate
revenue terminology — keep "ADR", "RevPAR", "pickup" as-is in every locale.

## Selectors / instrumentation needed

Add these `data-training` anchors before building the manager steps. They
mostly do not exist yet:

| Anchor                                  | Where                                       |
| --------------------------------------- | ------------------------------------------- |
| `[data-training="hotel-switcher"]`      | `src/components/layout/HotelSwitcher.tsx`   |
| `[data-training="language-switch"]`     | `src/components/layout/Header.tsx`          |
| `[data-training="main-tabs"]`           | `src/components/layout/MainTabsBar.tsx`     |
| `[data-training="team-view"]`           | `HousekeepingManagerView.tsx` Team View tab |
| `[data-training="auto-assign-btn"]`     | `AutoRoomAssignment.tsx` button             |
| `[data-training="pending-approvals"]`   | Pending Approvals sub-tab                   |
| `[data-training="ticket-row"]`          | Tickets list first row                      |
| `[data-training="revenue-grid"]`        | `src/components/revenue/CalendarYearView`   |
| `[data-training="ai-analyst-card"]`     | `src/components/revenue/AnalystPanel.tsx`   |
| `[data-training="invoice-upload"]`      | `PurchaseInvoices.tsx`                      |

The help-button anchor (`[data-training="help-button"]`) already exists.

## Auto-start gating

The fix already in place (`role` no longer defaults to `'housekeeping'`)
makes auto-start wait for the profile. The manager orientation curriculum
should additionally:

- Require `hotel_selected` precondition on every step that shows hotel data,
  so managers with no hotel assigned see only the welcome step.
- Skip the Revenue / Invoices modules when the role is not allowed
  (filter via `curriculaForRole`).

## Implementation order (when approved)

1. Add the missing `data-training` anchors (mechanical, low risk).
2. Split `manager.ts` into `manager-orientation.ts`,
   `manager-team.ts`, `manager-tickets.ts`, `manager-reception.ts`,
   `manager-attendance.ts`, `manager-revenue.ts`,
   `manager-invoices.ts` under `src/components/training/v2/curricula/`.
3. Register each in `curricula/index.ts` with the right `roles` array and
   `priority` so the orientation auto-starts first.
4. Delete or archive the old `v2_manager_run_your_day` curriculum once
   migrations of existing in-progress assignments are decided.
5. Update `TrainingAdminPanel` so admins can re-trigger / mark complete
   each module independently.
