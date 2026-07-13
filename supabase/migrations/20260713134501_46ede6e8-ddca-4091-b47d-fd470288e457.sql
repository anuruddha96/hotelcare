UPDATE public.rooms
SET status = 'clean', last_cleaned_at = now(), updated_at = now()
WHERE hotel = 'Hotel Ottofiori'
  AND is_checkout_room = false;