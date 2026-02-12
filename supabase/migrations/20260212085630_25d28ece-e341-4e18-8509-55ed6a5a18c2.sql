UPDATE rooms SET is_dnd = false, dnd_marked_at = NULL, dnd_marked_by = NULL
WHERE hotel = 'Hotel Ottofiori' AND room_number IN ('402', '405') AND is_dnd = true;