# SLNT Team View: rental wording + drag-and-drop unit assignment

Phase A only. Nothing in this plan changes what RD Hotels or Ottofiori see — every behaviour below is gated on the SLNT tenant flags that already exist (`venuesEnabled` / org slug `slnt`). Phase B (the Housekeeping Operations Policy system) is outlined at the end and will be planned separately once this is working.

## 1. Rental terminology for SLNT only

`src/lib/propertyTerminology.ts` already relabels Hotel to Property for the `slnt` org. Extend that same helper with the rest of the vocabulary instead of adding a second system:

| Concept | Hotel tenants (unchanged) | SLNT |
| --- | --- | --- |
| Room | Room | Unit |
| Rooms | Rooms | Units |
| Hotel | Hotel | Venue |
| Hotels | Hotels | Venues |
| Floor | Floor | Building / Venue |
| Checkout Rooms | Checkout Rooms | Checkout Units |
| Daily Rooms | Daily Rooms | Stayover Units |
| No Show Rooms | No Show Rooms | No Show Units |
| "0 rooms" on staff cards | 0 rooms | 0 units |

Translations for the five supported languages come from the same table shape already used there, so the wording follows the user's language.

Applied in Team View surfaces: `HousekeepingManagerView.tsx`, `HotelRoomOverview.tsx` (section titles, legend, counters, dialogs, tooltips) and the staff cards. Hotel tenants keep byte-identical strings.

## 2. Drag and drop assignment in the Unit/Room Overview

Today assignment happens through separate dialogs. Add direct manipulation:

- Every unit chip in the overview becomes draggable.
- Every housekeeper card below becomes a drop target with a clear highlighted state while dragging over it.
- Drop on a housekeeper card = assign (or reassign, if it already belongs to someone else).
- Drag a chip out of a housekeeper card back onto the overview = unassign.
- Both directions open a short confirmation dialog naming the unit and the housekeeper before anything is written.
- Optimistic move with a smooth animated chip transition; reverts with a toast if the write fails.
- Keyboard/touch fallback: long-press on touch devices, and the existing assignment dialog stays available so nothing becomes drag-only.

Permissions: admin, manager, housekeeping manager and supervisor. Supervisors can only drag units inside venues they are scoped to (`user_property_scopes`), enforced both in the UI and by the existing RLS. Everyone else sees the board read-only exactly as now.

## 3. Housekeeper name moves off the unit chips

- Remove the assignee name currently rendered on each unit chip in the overview.
- Each housekeeper card gains a compact grid of mini unit chips (same colour coding as the overview: assigned / in progress / pending approval / done / overdue), with the housekeeper's status and progress bar moved to the bottom of the card.
- Chips animate in and out as work is assigned or completed.

This layout change is SLNT-only for now, behind the same flag, so it can be turned on for other organizations later without further code work.

## 4. Technical notes

- Drag and drop: `@dnd-kit/core` + `@dnd-kit/sortable` (small, accessible, touch-capable). No layout library changes.
- Writes go to `room_assignments` for the selected date: insert/update `assigned_to` on assign, delete the row on unassign. Assignment type, ready-to-clean and PMS flags are preserved on reassign — nothing is reclassified.
- Realtime subscription already present in `HotelRoomOverview` keeps other viewers in sync; the staff cards will subscribe to the same channel so both panels update together.
- Terminology stays a single source of truth in `propertyTerminology.ts`; components read it through the existing `usePropertyTerms()` hook.
- No database migration is needed for Phase A.

## 5. Checks before hand-off

- Ottofiori and RD Hotels Team View: wording, chips, legend and assignment dialogs unchanged; drag handles absent.
- SLNT: assign, reassign and unassign each work with confirmation, survive a page refresh, and appear for a second signed-in viewer.
- Supervisor account can only move units inside their scoped venues.
- Housekeeper accounts see no drag affordance.
- TypeScript build passes.

## Phase B (next, not in this plan)

Tenant-configurable Housekeeping Operations Policy: organization → venue → unit inheritance, unit operating modes (short term / long term / serviced long term), cleaning, towel, linen, dirty-linen, amenity, approval, photo, SLA and service-request configuration, with an admin screen under Settings → Housekeeping → Operations Policy and an SLNT recommended preset. First release will store the full configuration but only enforce the high-impact SLNT effects (minibar hidden, no automatic towel/linen/dirty-linen, required short-term checkout clean, long-term units excluded from daily tasks). Existing tenants inherit a legacy default policy that reproduces today's behaviour exactly.
