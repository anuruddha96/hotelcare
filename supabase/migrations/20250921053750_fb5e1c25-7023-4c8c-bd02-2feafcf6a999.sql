-- Update towel and linen change requirements function
-- Towels: every 3rd day and on 7th day for longer stays
-- Linen: every 5th day
CREATE OR REPLACE FUNCTION public.check_towel_linen_requirements()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  guest_checkout_date date;
  days_since_towel_change integer;
  days_since_linen_change integer;
  guest_nights integer;
BEGIN
  -- When room assignment is completed, check towel/linen requirements
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    
    -- Get guest checkout date and nights stayed if it's a checkout room
    SELECT 
      checkout_time::date,
      guest_nights_stayed
    INTO guest_checkout_date, guest_nights
    FROM public.rooms 
    WHERE id = NEW.room_id AND is_checkout_room = true;
    
    -- If not a checkout room, get guest nights from rooms table
    IF guest_checkout_date IS NULL THEN
      SELECT guest_nights_stayed INTO guest_nights
      FROM public.rooms 
      WHERE id = NEW.room_id;
    END IF;
    
    -- Calculate days since last changes
    SELECT 
      COALESCE(CURRENT_DATE - last_towel_change, 999),
      COALESCE(CURRENT_DATE - last_linen_change, 999)
    INTO days_since_towel_change, days_since_linen_change
    FROM public.rooms 
    WHERE id = NEW.room_id;
    
    -- Update requirements based on stay duration or time since last change
    UPDATE public.rooms 
    SET 
      towel_change_required = CASE 
        WHEN guest_checkout_date IS NOT NULL THEN true  -- Always for checkout rooms
        WHEN guest_nights >= 3 AND (guest_nights % 3 = 0) THEN true  -- Every 3rd day
        WHEN guest_nights = 7 THEN true  -- Special requirement on 7th day
        WHEN days_since_towel_change >= 3 THEN true     -- Every 3 days for occupied rooms
        ELSE towel_change_required 
      END,
      linen_change_required = CASE 
        WHEN guest_checkout_date IS NOT NULL THEN true  -- Always for checkout rooms  
        WHEN guest_nights >= 5 AND (guest_nights % 5 = 0) THEN true  -- Every 5th day
        WHEN days_since_linen_change >= 5 THEN true     -- Every 5 days for occupied rooms
        ELSE linen_change_required 
      END,
      updated_at = now()
    WHERE id = NEW.room_id;
    
  END IF;
  
  RETURN NEW;
END;
$function$