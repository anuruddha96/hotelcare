-- Fix organization_slug for hotelcare test hotel rooms
UPDATE rooms 
SET organization_slug = 'hotelcare' 
WHERE hotel = 'hotelcare-test' 
  AND organization_slug != 'hotelcare';