\set ON_ERROR_STOP on
-- Isolated Postgres CI fixture: no production data or Supabase credentials.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.rooms (
 id uuid PRIMARY KEY, hotel text NOT NULL, room_number text,
 pms_metadata jsonb DEFAULT '{}'::jsonb, is_checkout_room boolean DEFAULT false,
 towel_change_required boolean DEFAULT false, linen_change_required boolean DEFAULT false
);
CREATE TABLE public.housekeeping_room_snapshots (
 id uuid PRIMARY KEY, room_id uuid NOT NULL, business_date date NOT NULL,
 final_state jsonb, updated_at timestamptz DEFAULT now(),finalized_at timestamptz DEFAULT now()
);
CREATE TABLE public.room_assignments (
 id uuid PRIMARY KEY, room_id uuid NOT NULL, assignment_date date,
 assignment_type text NOT NULL DEFAULT 'daily_cleaning',
 status text DEFAULT 'assigned', service_result text,
 previous_day_context jsonb DEFAULT '{}'::jsonb
);
CREATE OR REPLACE FUNCTION public.hc_carry_final_night_towel_only(
 p_hotel text,p_meta jsonb,p_date date
) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT p_meta ->> 'departureDate' = (p_date + 1)::text
$$;
-- 006/032: No Service yesterday but absolutely NO towel/linen service due.
-- 040/108: older unproven debt; yesterday's towel actually due and DND.
-- 036: 12 Oct Change Room due & missed, 13 Oct DND, final night 14 Oct.
-- 200: legitimate one-day towel missed yesterday.
-- 300: successful cleaning resolves any outstanding carry.
-- 400: Mika false carry and isolation from Memories.
INSERT INTO public.rooms(id,hotel,room_number,towel_change_required,pms_metadata) VALUES
 ('00000000-0000-4000-8000-000000000006','Hotel Memories Budapest','006',true,'{}'),
 ('00000000-0000-4000-8000-000000000032','Hotel Memories Budapest','032',true,'{}'),
 ('00000000-0000-4000-8000-000000000040','Hotel Memories Budapest','040',true,'{}'),
 ('00000000-0000-4000-8000-000000000108','Hotel Memories Budapest','108',true,'{}'),
 ('00000000-0000-4000-8000-000000000036','Hotel Memories Budapest','036',true,'{"departureDate":"2026-10-15"}'),
 ('00000000-0000-4000-8000-000000000200','Hotel Memories Budapest','200',true,'{}'),
 ('00000000-0000-4000-8000-000000000300','Hotel Memories Budapest','300',true,'{}'),
 ('00000000-0000-4000-8000-000000000400','mika-downtown','SUITE - 1/4',true,'{}'),
 ('00000000-0000-4000-8000-000000000500','Hotel Memories Budapest','500',true,'{"isNoShow":true}');
-- One 12 Oct record per repeated-debt case.
INSERT INTO public.housekeeping_room_snapshots(id,room_id,business_date,final_state)
VALUES
 ('10000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000040','2026-10-12',
  '{"towel_change_required_for_assignment":false,"linen_change_required_for_assignment":false,"had_no_service":true}'),
 ('10000000-0000-4000-8000-000000000108','00000000-0000-4000-8000-000000000108','2026-10-12',
  '{"towel_change_required_for_assignment":false,"linen_change_required_for_assignment":false,"had_no_service":true}'),
 ('10000000-0000-4000-8000-000000000036','00000000-0000-4000-8000-000000000036','2026-10-12',
  '{"towel_change_required_for_assignment":false,"linen_change_required_for_assignment":true,"had_dnd":true}');
INSERT INTO public.housekeeping_room_snapshots(id,room_id,business_date,final_state)
VALUES
 ('20000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000006','2026-10-13',
  '{"towel_change_required_for_assignment":false,"linen_change_required_for_assignment":false,"had_no_service":true,"service_result":"guest_declined"}'),
 ('20000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000032','2026-10-13',
  '{"towel_change_required_for_assignment":false,"linen_change_required_for_assignment":false,"had_no_service":true,"service_result":"guest_declined"}'),
 ('20000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000040','2026-10-13',
  '{"towel_change_required_for_assignment":true,"linen_change_required_for_assignment":false,"had_dnd":true}'),
 ('20000000-0000-4000-8000-000000000108','00000000-0000-4000-8000-000000000108','2026-10-13',
  '{"towel_change_required_for_assignment":true,"linen_change_required_for_assignment":false,"had_dnd":true}'),
 ('20000000-0000-4000-8000-000000000036','00000000-0000-4000-8000-000000000036','2026-10-13',
  '{"towel_change_required_for_assignment":false,"linen_change_required_for_assignment":true,"had_dnd":true}'),
 ('20000000-0000-4000-8000-000000000200','00000000-0000-4000-8000-000000000200','2026-10-13',
  '{"towel_change_required_for_assignment":true,"linen_change_required_for_assignment":false,"had_no_service":true,"service_result":"guest_declined"}'),
 ('20000000-0000-4000-8000-000000000300','00000000-0000-4000-8000-000000000300','2026-10-13',
  '{"towel_change_required_for_assignment":true,"linen_change_required_for_assignment":false,"had_dnd":true,"service_result":"cleaned"}'),
 ('20000000-0000-4000-8000-000000000400','00000000-0000-4000-8000-000000000400','2026-10-13',
  '{"towel_change_required_for_assignment":false,"linen_change_required_for_assignment":false,"had_no_service":true,"service_result":"guest_declined"}'),
 ('20000000-0000-4000-8000-000000000500','00000000-0000-4000-8000-000000000500','2026-10-13',
  '{"towel_change_required_for_assignment":true,"linen_change_required_for_assignment":false,"had_no_service":true,"service_result":"guest_declined"}');

INSERT INTO public.room_assignments(id,room_id,assignment_date,previous_day_context)
SELECT ('30000000-0000-4000-8000-' || lpad(r.room_number,12,'0'))::uuid,
 r.id,'2026-10-14'::date,
 jsonb_build_object('carry_forward',jsonb_build_object(
   'active',true,'service_type',CASE WHEN r.room_number='036' THEN 'towel_change' ELSE 'towel_change' END,
   'source_business_date','2026-10-13',
   'original_due_date',CASE WHEN r.room_number IN ('036','040','108') THEN '2026-10-12' ELSE '2026-10-13' END,
   'attempt_count',CASE WHEN r.room_number IN ('036','040','108') THEN 2 ELSE 1 END,
   'reason','no_service','property_id','memories-budapest'))
FROM public.rooms r WHERE r.room_number<>'SUITE - 1/4';
INSERT INTO public.room_assignments(id,room_id,assignment_date,previous_day_context)
VALUES ('30000000-0000-4000-8000-000000000400','00000000-0000-4000-8000-000000000400','2026-10-14',
'{"carry_forward":{"active":true,"service_type":"towel_change","source_business_date":"2026-10-13","original_due_date":"2026-10-13","reason":"no_service"}}');

