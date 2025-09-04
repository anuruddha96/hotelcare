-- Update some rooms to be checkout rooms for testing
UPDATE rooms 
SET is_checkout_room = true, 
    checkout_time = NOW(), 
    guest_count = 2,
    status = 'dirty' 
WHERE room_number IN ('004', '006', '008', '010') 
AND hotel = 'Hotel Memories Budapest';

-- Set remaining dirty rooms as daily cleaning
UPDATE rooms 
SET is_checkout_room = false, 
    checkout_time = NULL, 
    guest_count = 1,
    status = 'dirty' 
WHERE room_number NOT IN ('004', '006', '008', '010') 
AND hotel = 'Hotel Memories Budapest' 
AND status = 'dirty';