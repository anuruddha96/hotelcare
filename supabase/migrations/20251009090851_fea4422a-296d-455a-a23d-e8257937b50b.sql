-- Restore Hotel Ottofiori assignments for ONLY Delgerzaya and Mary Joy
-- These were the only two housekeepers working today before 10:39 AM

DO $$
DECLARE
  delgerzaya_id uuid := '29d90b32-24cd-41f2-89c9-dbc592ec57c0';
  mary_joy_id uuid := 'c6dfa33f-5a4c-47ed-8685-1e1c0390a57d';
  
  room_103_id uuid;
  room_104_id uuid;
  room_203_id uuid;
  room_204_id uuid;
  room_303_id uuid;
  room_304_id uuid;
  room_403_id uuid;
  room_404_id uuid;
BEGIN
  -- Get room IDs for the specific rooms these housekeepers were assigned
  SELECT id INTO room_103_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '103';
  SELECT id INTO room_104_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '104';
  SELECT id INTO room_203_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '203';
  SELECT id INTO room_204_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '204';
  SELECT id INTO room_303_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '303';
  SELECT id INTO room_304_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '304';
  SELECT id INTO room_403_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '403';
  SELECT id INTO room_404_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '404';

  -- Delete ALL existing assignments for Hotel Ottofiori today
  DELETE FROM room_assignments 
  WHERE room_id IN (
    SELECT id FROM rooms WHERE hotel = 'Hotel Ottofiori'
  ) AND assignment_date = CURRENT_DATE;

  -- Restore ONLY Delgerzaya's assignments (3 checkout + 1 daily)
  INSERT INTO room_assignments (room_id, assigned_to, assigned_by, assignment_date, assignment_type, status, priority, ready_to_clean, organization_slug)
  VALUES
    -- Delgerzaya's checkout cleaning rooms
    (room_103_id, delgerzaya_id, delgerzaya_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_203_id, delgerzaya_id, delgerzaya_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_403_id, delgerzaya_id, delgerzaya_id, CURRENT_DATE, 'checkout_cleaning', 'in_progress', 2, true, 'rdhotels'),
    -- Delgerzaya's daily cleaning room
    (room_303_id, delgerzaya_id, delgerzaya_id, CURRENT_DATE, 'daily_cleaning', 'assigned', 1, false, 'rdhotels');

  -- Restore ONLY Mary Joy's assignments (3 checkout + 1 daily)
  INSERT INTO room_assignments (room_id, assigned_to, assigned_by, assignment_date, assignment_type, status, priority, ready_to_clean, organization_slug)
  VALUES
    -- Mary Joy's checkout cleaning rooms
    (room_104_id, mary_joy_id, mary_joy_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_304_id, mary_joy_id, mary_joy_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_404_id, mary_joy_id, mary_joy_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    -- Mary Joy's daily cleaning room
    (room_204_id, mary_joy_id, mary_joy_id, CURRENT_DATE, 'daily_cleaning', 'assigned', 1, false, 'rdhotels');

  RAISE NOTICE 'Successfully restored 8 room assignments for Delgerzaya (4 rooms) and Mary Joy (4 rooms)';
  RAISE NOTICE 'Dirty linen counts are intact in the database and preserved';
END $$;