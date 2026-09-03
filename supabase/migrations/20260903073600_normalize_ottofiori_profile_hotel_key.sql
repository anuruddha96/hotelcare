-- Normalize legacy Ottofiori profile scope to the canonical hotel_id.
--
-- Live Sync integration calls use hotel_id = 'ottofiori'. Older profiles may
-- still store the display name 'Hotel Ottofiori', which causes strict backend
-- scope checks to reject otherwise-authorized users. The application resolves
-- both forms, so canonicalizing the profile value is backwards compatible.

update public.profiles
set assigned_hotel = 'ottofiori'
where assigned_hotel = 'Hotel Ottofiori';
