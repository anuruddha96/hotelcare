# Mika PMS clean-state reconciliation

Hotel Mika Downtown's fresh Previo sync already writes the correct `rooms.status` values into HotelCare. The visual mismatch came from Team View requiring `last_cleaned_at` to be the selected date before it would render a `clean` room green.

For a fresh PMS sync this was too strict: a room can still be clean in Previo today without HotelCare itself having created a new cleaning-completion timestamp today.

Team View now renders `rooms.status = clean` as clean when either:

- HotelCare recorded `last_cleaned_at` on the selected date; or
- the room's PMS metadata shows a fresh `pmsSyncDate` / `lastPmsRefreshDate` for the selected date.

This keeps `last_cleaned_at` truthful and does not manufacture cleaning timestamps during PMS sync.
