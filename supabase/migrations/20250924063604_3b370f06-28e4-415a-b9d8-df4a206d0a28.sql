-- Fix towel and linen change requirements to show only on specific nights
-- Towels: exactly on 3rd night, then every 3 days (6th, 9th, etc.)
-- Linen: exactly on 5th night, then every 5 days (10th, 15th, etc.)
CREATE OR REPLACE FUNCTION public.check_towel_linen_requirements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  guest_checkout_date date;
  guest_nights integer;
BEGIN
  -- When room assignment is completed, check towel/linen requirements
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    
    -- Get guest checkout date and nights stayed
    SELECT 
      CASE WHEN is_checkout_room = true THEN checkout_time::date ELSE NULL END,
      COALESCE(guest_nights_stayed, 0)
    INTO guest_checkout_date, guest_nights
    FROM public.rooms 
    WHERE id = NEW.room_id;
    
    -- Set default if no guest nights data
    IF guest_nights IS NULL THEN
      guest_nights := 0;
    END IF;
    
    -- Update requirements based on specific nights only
    UPDATE public.rooms 
    SET 
      towel_change_required = CASE 
        WHEN guest_checkout_date IS NOT NULL THEN true  -- Always for checkout rooms
        WHEN guest_nights = 3 OR guest_nights = 6 OR guest_nights = 9 OR guest_nights = 12 OR guest_nights = 15 THEN true  -- Exactly on 3rd, 6th, 9th, 12th, 15th nights only
        ELSE false  -- Reset to false for other nights
      END,
      linen_change_required = CASE 
        WHEN guest_checkout_date IS NOT NULL THEN true  -- Always for checkout rooms  
        WHEN guest_nights = 5 OR guest_nights = 10 OR guest_nights = 15 OR guest_nights = 20 THEN true  -- Exactly on 5th, 10th, 15th, 20th nights only
        ELSE false  -- Reset to false for other nights
      END,
      -- Update last change dates when changes are performed
      last_towel_change = CASE 
        WHEN guest_checkout_date IS NOT NULL OR guest_nights = 3 OR guest_nights = 6 OR guest_nights = 9 OR guest_nights = 12 OR guest_nights = 15 THEN CURRENT_DATE
        ELSE last_towel_change
      END,
      last_linen_change = CASE 
        WHEN guest_checkout_date IS NOT NULL OR guest_nights = 5 OR guest_nights = 10 OR guest_nights = 15 OR guest_nights = 20 THEN CURRENT_DATE
        ELSE last_linen_change
      END,
      updated_at = now()
    WHERE id = NEW.room_id;
    
  END IF;
  
  RETURN NEW;
END;
$$;