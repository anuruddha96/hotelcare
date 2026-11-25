# SLNT room board: a clear, compact property list

The current board puts the property label and its rooms in one wrapping line, so rooms spill onto lines below the label and look like they belong to nothing. Room labels also repeat the property name ("Silver Rooms 12", "K4 – Room 5"), which makes each chip wide and forces more wrapping. The result is the confusing screen in the screenshots.

This replaces the CSS patch with a real layout in the board itself, for SLNT Group only.

## New layout

Each property becomes one aligned row, like a simple table:

```text
 ┃ Silver Rooms      15 ┃  1  2  4  6  7  9  10  12  13  14  15 …
 ┃ K4                 3 ┃  1  4  5
 ┃ CityNest           1 ┃  •
```

- Left column, fixed width: colour bar, property name (shortened with the full name on hover/long-press) and the unit count. Same tap-to-select-all and drag-the-whole-property behaviour as today.
- Right column: that property's room chips only, wrapping inside the row and never underneath the name. Grouping becomes unmistakable.
- Room labels drop the repeated property name, so "Silver Rooms 12" shows as "12" and "K4 – Room 5" shows as "5". Where a unit has no number (single-apartment properties) it shows a short unit word instead. The full name stays in the tooltip, in the selection tray and everywhere else.
- Thin separator lines between rows, no boxes or tinted cards.
- Status colours, C/O+1, T, DND, no-show, notes, assignee initials and every other badge stay exactly as they are.

## Clarity and navigation

- Checkout Units and Daily Cleaning keep their headings and counts, with "Select all" where it is today.
- Unassigned rooms stay visually obvious; assigned ones show the cleaner as now.
- The Compact/Roomy toggle disappears for SLNT — there is one clear layout.
- The legend stays available on one scrollable line.
- Comfortable tap targets on phone; on tablet and desktop the same rows simply fit more chips per line.

## Technical notes

- Add an SLNT-only branch in `renderTodayVenueRows` (`src/components/dashboard/HotelRoomOverviewLive.tsx`) rendering a `grid-cols-[auto_minmax(0,1fr)]` row per venue group; reuse the existing drag props, `onPillClick`, and `renderRoomChip` untouched.
- Add a small label helper that strips the venue name prefix from `room_number` for display only; no data change.
- Reduce `slnt-team-property-rows.css` to the remaining presentation bits (hide the density toggle, one-line legend, hide the duplicate four-tile ribbon) and drop rules the new markup makes unnecessary.
- Scope stays `venuesEnabled && slug ∈ {slnt, slnt-group}` via the existing wrapper; Hotel Memories, Gozsdu, Ottofiori, Mika and all RD Hotels views are untouched.
- Update `HotelRoomOverview.slnt.test.tsx` plus a new unit test for the label-shortening helper; run typecheck and the housekeeping tests.
