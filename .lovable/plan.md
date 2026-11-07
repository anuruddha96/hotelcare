# Reception page cleanup + Previo reservations

Kept small to fit the ~4 credit budget. Anything bigger is listed under "Later".

## 1. Sub-sections like Housekeeping
One tab bar under Reception (replaces the two stacked button rows):
- 🛎️ Today (arrivals, departures, in-house, unassigned counts)
- 🗓️ Room planner
- 📋 Reservations
- 👥 Guests
- 🥐 Breakfast upload

Each tab gets a short help tooltip saying what it does.

## 2. Tidier top bar
- One row: search, 🔄 Sync from Previo, ➕ New reservation. Each one gets a tooltip.
- Combine the yellow "PMS needs attention" banner and the inline alert into one small ⚠️ chip with Details.
- Remove the line "Previo snapshot · read-only…" and make the legend smaller.
- Make the "room conflicts" badge a small ⚠️ chip.

## 3. Open a booking from the planner
- Tap a booking bar to open a side panel showing the guest, dates, room, status and group.
- Buttons: ✏️ Edit, ✅ Check in, 🚪 Check out, 📄 Open full details.

## 4. Create and edit in Previo
- New and edited bookings are sent to Previo through its API. HotelCare saves them only after Previo confirms. If Previo rejects one, the reason is shown.
- ⚠️ Risk: Previo hasn't been tested for creating bookings yet. This may need its own credits.

## 5. Group bookings
- Grouped bookings show a 👨‍👩‍👧 tag and the group name, and you can filter by it.
- Opening one booking lists the other rooms in its group.
- Making new group bookings: Later.

## Technical
- ReceptionHome.tsx/FrontDesk.tsx get the tab layout. The existing RoomPlanner sends a click event to a new ReservationQuickPanel.
- New edge function previo-reservation-write (XML API, uses existing Previo credentials, hotel-scoped auth). It's called from the create/edit dialogs.
- Groups come from the Previo group id in the imported reservation metadata.

## Later (not in 4 credits)
- Creating group bookings
- Translations for every language
- Tests
