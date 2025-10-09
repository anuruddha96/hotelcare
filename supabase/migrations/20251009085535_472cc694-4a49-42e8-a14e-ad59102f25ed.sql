-- Restore Hotel Ottofiori room assignments
-- This restores the room assignments that were accidentally deleted

DO $$
DECLARE
  admin_id uuid;
  housekeeper_ids uuid[];
  room_record record;
  housekeeper_index int := 0;
  assignment_type_val assignment_type;
BEGIN
  -- Get an admin user to be the "assigned_by"
  SELECT id INTO admin_id FROM profiles WHERE role = 'admin' LIMIT 1;
  
  -- If no admin, get a manager
  IF admin_id IS NULL THEN
    SELECT id INTO admin_id FROM profiles WHERE role = 'manager' LIMIT 1;
  END IF;
  
  -- Get all housekeepers for Hotel Ottofiori
  SELECT ARRAY_AGG(id) INTO housekeeper_ids 
  FROM profiles 
  WHERE role = 'housekeeping' 
    AND assigned_hotel = 'Hotel Ottofiori'
    AND id IS NOT NULL;
  
  -- Only proceed if we have housekeepers
  IF array_length(housekeeper_ids, 1) > 0 AND admin_id IS NOT NULL THEN
    
    -- Create assignments for all dirty rooms in Hotel Ottofiori
    FOR room_record IN 
      SELECT id, room_number, is_checkout_room, checkout_time
      FROM rooms 
      WHERE hotel = 'Hotel Ottofiori' 
        AND status = 'dirty'
      ORDER BY room_number
    LOOP
      -- Determine assignment type based on checkout status
      IF room_record.is_checkout_room = true THEN
        assignment_type_val := 'checkout_cleaning';
      ELSE
        assignment_type_val := 'daily_cleaning';
      END IF;
      
      -- Round-robin distribution among housekeepers
      INSERT INTO room_assignments (
        room_id,
        assigned_to,
        assigned_by,
        assignment_date,
        assignment_type,
        status,
        priority,
        estimated_duration,
        ready_to_clean,
        organization_slug
      ) VALUES (
        room_record.id,
        housekeeper_ids[(housekeeper_index % array_length(housekeeper_ids, 1)) + 1],
        admin_id,
        CURRENT_DATE,
        assignment_type_val,
        'assigned',
        CASE WHEN room_record.is_checkout_room THEN 2 ELSE 1 END,
        CASE WHEN assignment_type_val = 'checkout_cleaning' THEN 45 ELSE 30 END,
        CASE WHEN assignment_type_val = 'checkout_cleaning' THEN true ELSE false END,
        'rdhotels'
      );
      
      -- Move to next housekeeper
      housekeeper_index := housekeeper_index + 1;
    END LOOP;
    
    RAISE NOTICE 'Successfully restored room assignments for Hotel Ottofiori';
  ELSE
    RAISE EXCEPTION 'No housekeepers or admin found to create assignments';
  END IF;
END $$;