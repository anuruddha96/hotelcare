-- Delete incorrectly created room with full hotel name
DELETE FROM rooms 
WHERE hotel = 'HotelCare.App Testing Environment' 
AND room_number = '101';