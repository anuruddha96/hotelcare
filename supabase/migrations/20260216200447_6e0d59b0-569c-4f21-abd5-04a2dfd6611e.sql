-- Fix elevator proximity values to match actual physical layout
-- Elevator is between rooms 002 and 032 on the ground floor
-- Wing L (3rd floor) is furthest from elevator
UPDATE rooms SET elevator_proximity = 3 WHERE wing = 'L' AND hotel = 'Hotel Memories Budapest';
-- Wing I (2nd floor inner) - above elevator area but 2nd floor
UPDATE rooms SET elevator_proximity = 2 WHERE wing = 'I' AND hotel = 'Hotel Memories Budapest';
-- Wing J (2nd floor far side) - rooms 211+ are far from elevator
UPDATE rooms SET elevator_proximity = 3 WHERE wing = 'J' AND hotel = 'Hotel Memories Budapest' AND CAST(room_number AS integer) >= 211;
-- Wing K (2nd floor courtyard) - far from elevator
UPDATE rooms SET elevator_proximity = 3 WHERE wing = 'K' AND hotel = 'Hotel Memories Budapest';