# SLNT property-row Team View: release QA

## Scope

Only the active `slnt` / `slnt-group` tenant, with venue grouping enabled, inside the Team View tab. The change adds a presentation wrapper and scoped CSS; the live room board keeps the existing room queries, service classification, click/drop handlers, staff indicators and assignment operations. Historical snapshots and Gozsdu's specialized live view are unaffected.

## Automated gate

- `npm ci`
- `npm run build`
- `npm test -- --run src/components/dashboard/HotelRoomOverview.slnt.test.tsx`
- `npm test` (full regression suite)
- `npm run lint` (review any existing unrelated warnings separately)

The unit tests cover both SLNT slugs, tenant feature-flag override, RD Hotels and other tenant isolation, the historic view, Gozsdu route and stylesheet selector scoping. The CSS test checks that the layout breakpoint uses the property card's container width.

## Browser acceptance (requires a running deployment and authenticated test accounts)

1. At SLNT Team View, verify each venue/address is one row in Checkout and Daily, with property name/count and all room identifiers/status badges intact. Resize the available board (including the narrower Today column for managers with Yesterday/Today split).
2. Check phone, tablet and desktop widths, plus both Compact and Roomy density modes. On narrow cards the property label is above its unit chips; wide cards show the label on the left, chips on the right.
3. Assign by dragging a room chip onto a housekeeper; assign a housekeeper chip onto a room; verify selection/staged Apply and unassign. Confirm room actions, service status and RTC/PMS refresh behave unchanged.
4. Check SLNT supervisors can see only authorized venues and housekeepers only assigned work (RLS unchanged by this change).
5. Log in to RD Hotels (e.g. Ottofiori, Memories and Mika) and Gozsdu; verify their Team View and room actions are unchanged. Check historical dates remain read-only.
6. Confirm the console shows no new errors and there is no horizontal overflow on mobile.

This checklist documents required live/browser validation; committing it does not imply those checks have been run.
