# SLNT Team View property clusters: release QA

## Scope

Only the active `slnt` / `slnt-group` tenant, with venue grouping enabled, inside the Team View tab. The existing Compact/Roomy control now toggles **compact multi-column venue clusters** (default) versus the previous **full-width property rows**. The existing room queries, cleaning classification, approval states, badges, room interactions and drag/drop handlers remain unchanged. Historical snapshots and Gozsdu's specialized view are unaffected.

## Automated gate

- `bun install --frozen-lockfile`
- `bun run build`
- `bun run test` (full suite, including `HotelRoomOverview.slnt.test.tsx` and `slntPropertyClusters.test.ts`)

## Browser acceptance (requires deployed preview and authenticated test accounts)

1. Open SLNT Team View in **Compact view**. In Checkout and Stayover, distinct property cards should appear side by side wherever width permits. Each card must show its property title, count, every room chip and all its badges; confirm long room names never disappear or cause horizontal overflow.
2. Verify Silver Rooms and St King (multi-room clusters), plus a one-unit property. Check the count against the displayed chips and verify rooms never appear under the wrong property.
3. Test phone widths 320/375/390 px, tablet 768 px and desktops 1280/1440 px. Check admin's narrower Today panel beside Yesterday: the cluster columns should respond to actual panel width and not overflow.
4. Click **Roomy view** and confirm previous full-width property rows remain available. Click **Compact view** to restore clusters. Refresh and confirm the pre-existing density preference persists.
5. Verify room click/quick actions, drag room to housekeeper, drop housekeeper onto room, venue bulk selection, staged Apply/unassign, RTC and status indicators, PMS refresh, and access scoping. Confirm all rooms remain keyboard-accessible in original DOM order.
6. Log in as RD Hotels managers for Ottofiori, Memories, Mika and Gozsdu. Check their layout, actions and historical dates remain unchanged. Also check non-Team-View SLNT screens retain their own layout.
7. Confirm no new browser console errors, no horizontal overflow, and no clipped action/status badges on mobile and desktop.

Live/browser acceptance must be performed after a preview or production build is available. CI success alone does not establish visual or interaction acceptance; merging alone does not prove production deployment.
