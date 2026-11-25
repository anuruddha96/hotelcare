\set ON_ERROR_STOP on
-- Isolated data only; no live Supabase connection.
CREATE TABLE public.hotel_configurations (
  hotel_id text PRIMARY KEY, hotel_name text, is_active boolean, settings jsonb
);
CREATE TABLE public.rooms (
  id uuid PRIMARY KEY, hotel text NOT NULL, room_number text NOT NULL,
  notes text, pms_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  bed_configuration text
);
INSERT INTO public.hotel_configurations VALUES
 ('memories-budapest','Hotel Memories Budapest',true,'{"memories_service_cycle":{"final_night_towel_only":true}}'),
 ('ottofiori','Hotel Ottofiori',true,'{"housekeeping_service_cycle":{"final_night_towel_only":true}}');
INSERT INTO public.rooms (id,hotel,room_number,notes,pms_metadata) VALUES
 ('00000000-0000-4000-8000-000000000127','Hotel Memories Budapest','127',
  'Previous guest bed setup: Twin Beds Together — reset to standard room setup.',
  '{"previousGuestBedSetup":{"note":"Previous guest bed setup: Twin Beds Together — reset to standard room setup."}}'),
 ('00000000-0000-4000-8000-000000000144','Hotel Memories Budapest','144',
  E'Previous guest bed setup: Twin Beds Together — reset to standard room setup.\nPrepare cot',
  '{"previousGuestBedSetup":{"note":"Previous guest bed setup: Twin Beds Together — reset to standard room setup."}}'),
 ('00000000-0000-4000-8000-000000000900','Hotel Ottofiori','900',
  'Previous guest bed setup: Twin Beds Together — reset to standard room setup.',
  '{"previousGuestBedSetup":{"note":"Previous guest bed setup: Twin Beds Together — reset to standard room setup."}}'),
 ('00000000-0000-4000-8000-000000000010','Hotel Memories Budapest','010',
  'Manager instruction: guest needs extra towel',
  '{"pmsSyncDate":"2026-10-20","departureDate":"2026-10-21","currentNight":"6","totalNights":"6","continuousStay":{"currentNight":"2","totalNights":"2"}}');
