-- Restore Hotel Ottofiori room assignments to state before 10:39 AM (2025-10-09)
-- This restores the exact assignments that were deleted by the bug in PMSUpload.tsx

DO $$
DECLARE
  soda_id uuid := 'bbb74b2c-44c5-474e-a5a7-bc1f01a22a03';
  svitlana_id uuid := '6c8ee36a-e056-474e-b0e7-95e6517e9ee0';
  delgerzaya_id uuid := '29d90b32-24cd-41f2-89c9-dbc592ec57c0';
  mary_joy_id uuid := 'c6dfa33f-5a4c-47ed-8685-1e1c0390a57d';
  otgoo_id uuid := 'd23a880c-1df9-4b6c-9bdb-2903ca41dfd5';
  
  room_101_id uuid;
  room_102_id uuid;
  room_103_id uuid;
  room_104_id uuid;
  room_105_id uuid;
  room_201_id uuid;
  room_202_id uuid;
  room_203_id uuid;
  room_204_id uuid;
  room_205_id uuid;
  room_301_id uuid;
  room_302_id uuid;
  room_303_id uuid;
  room_304_id uuid;
  room_305_id uuid;
  room_401_id uuid;
  room_402_id uuid;
  room_403_id uuid;
  room_404_id uuid;
  room_405_id uuid;
  room_406_id uuid;
BEGIN
  -- Get room IDs for Hotel Ottofiori
  SELECT id INTO room_101_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '101';
  SELECT id INTO room_102_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '102';
  SELECT id INTO room_103_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '103';
  SELECT id INTO room_104_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '104';
  SELECT id INTO room_105_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '105';
  SELECT id INTO room_201_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '201';
  SELECT id INTO room_202_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '202';
  SELECT id INTO room_203_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '203';
  SELECT id INTO room_204_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '204';
  SELECT id INTO room_205_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '205';
  SELECT id INTO room_301_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '301';
  SELECT id INTO room_302_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '302';
  SELECT id INTO room_303_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '303';
  SELECT id INTO room_304_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '304';
  SELECT id INTO room_305_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '305';
  SELECT id INTO room_401_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '401';
  SELECT id INTO room_402_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '402';
  SELECT id INTO room_403_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '403';
  SELECT id INTO room_404_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '404';
  SELECT id INTO room_405_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '405';
  SELECT id INTO room_406_id FROM rooms WHERE hotel = 'Hotel Ottofiori' AND room_number = '406';

  -- First, delete any existing assignments for Hotel Ottofiori today
  DELETE FROM room_assignments 
  WHERE room_id IN (
    SELECT id FROM rooms WHERE hotel = 'Hotel Ottofiori'
  ) AND assignment_date = CURRENT_DATE;

  -- Restore checkout cleaning assignments (priority 2, ready_to_clean: true)
  INSERT INTO room_assignments (room_id, assigned_to, assigned_by, assignment_date, assignment_type, status, priority, ready_to_clean, organization_slug)
  VALUES
    (room_101_id, soda_id, soda_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_102_id, svitlana_id, soda_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_103_id, delgerzaya_id, soda_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_104_id, mary_joy_id, soda_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_105_id, otgoo_id, soda_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_201_id, soda_id, soda_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_202_id, svitlana_id, soda_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_203_id, delgerzaya_id, soda_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_301_id, soda_id, soda_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_304_id, mary_joy_id, soda_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_305_id, otgoo_id, soda_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_402_id, svitlana_id, soda_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_403_id, delgerzaya_id, soda_id, CURRENT_DATE, 'checkout_cleaning', 'in_progress', 2, true, 'rdhotels'),
    (room_404_id, mary_joy_id, soda_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels'),
    (room_406_id, soda_id, soda_id, CURRENT_DATE, 'checkout_cleaning', 'assigned', 2, true, 'rdhotels');

  -- Restore daily cleaning assignments (priority 1, ready_to_clean: false)
  INSERT INTO room_assignments (room_id, assigned_to, assigned_by, assignment_date, assignment_type, status, priority, ready_to_clean, organization_slug)
  VALUES
    (room_204_id, mary_joy_id, soda_id, CURRENT_DATE, 'daily_cleaning', 'assigned', 1, false, 'rdhotels'),
    (room_205_id, otgoo_id, soda_id, CURRENT_DATE, 'daily_cleaning', 'assigned', 1, false, 'rdhotels'),
    (room_302_id, svitlana_id, soda_id, CURRENT_DATE, 'daily_cleaning', 'assigned', 1, false, 'rdhotels'),
    (room_303_id, delgerzaya_id, soda_id, CURRENT_DATE, 'daily_cleaning', 'assigned', 1, false, 'rdhotels'),
    (room_401_id, soda_id, soda_id, CURRENT_DATE, 'daily_cleaning', 'assigned', 1, false, 'rdhotels'),
    (room_405_id, otgoo_id, soda_id, CURRENT_DATE, 'daily_cleaning', 'assigned', 1, false, 'rdhotels');

  RAISE NOTICE 'Successfully restored 21 room assignments for Hotel Ottofiori';
END $$;