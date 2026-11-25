-- CI ONLY. Exact helper signatures from Claude's production baseline.
-- All helpers scoped to synthetic users/properties. No external calls.
CREATE SCHEMA IF NOT EXISTS acceptance;
CREATE TABLE acceptance.hotel_scope(hotel_id text PRIMARY KEY, org text NOT NULL, display_name text NOT NULL);
CREATE TABLE acceptance.hotel_access(uid uuid REFERENCES auth.users(id), hotel_id text REFERENCES acceptance.hotel_scope(hotel_id), PRIMARY KEY(uid,hotel_id));
CREATE OR REPLACE FUNCTION public.has_pms_access(user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM profiles WHERE id=user_id AND role::text IN ('admin','manager','reception','front_office','top_management','top_management_manager')) $$;
CREATE OR REPLACE FUNCTION public.user_can_access_hotel(_uid uuid,_hotel_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM acceptance.hotel_access a WHERE a.uid=_uid AND a.hotel_id=_hotel_id) $$;
CREATE OR REPLACE FUNCTION public.can_access_pms_hotel(_uid uuid,_hotel_id text,_org_slug text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT public.has_pms_access(_uid) AND public.user_can_access_hotel(_uid,_hotel_id) AND EXISTS(SELECT 1 FROM profiles p JOIN acceptance.hotel_scope h ON h.org=p.organization_slug WHERE p.id=_uid AND h.hotel_id=_hotel_id AND (_org_slug IS NULL OR _org_slug=h.org)) $$;
CREATE OR REPLACE FUNCTION public.can_access_reservation(_uid uuid,_reservation_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM reservations r WHERE r.id=_reservation_id AND public.can_access_pms_hotel(_uid,r.hotel_id,r.organization_slug)) $$;
CREATE OR REPLACE FUNCTION public.get_user_role(user_id uuid) RETURNS public.user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT role FROM profiles WHERE id=user_id $$;
CREATE OR REPLACE FUNCTION public.get_user_organization_slug(user_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT organization_slug FROM profiles WHERE id=user_id $$;
CREATE OR REPLACE FUNCTION public.is_super_admin(user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT COALESCE((SELECT is_super_admin FROM profiles WHERE id=user_id),false) $$;
CREATE OR REPLACE FUNCTION public.pms_hotel_room_keys(_hotel_id text) RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT display_name FROM acceptance.hotel_scope WHERE hotel_id=_hotel_id $$;
-- Deliberately reject legacy recalculation on native rows. This is an isolation
-- double, not a claim about Previo's real financial implementation.
CREATE OR REPLACE FUNCTION public.pms_recalc_reservation_financials(_reservation_id uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM reservations WHERE id=_reservation_id AND organization_slug='channex') THEN RAISE EXCEPTION 'LEGACY_RECALC_USED_FOR_NATIVE'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.pms_check_in_reservation(_reservation_id uuid,_room_id uuid,_override boolean) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN UPDATE reservations SET status='checked_in',room_id=COALESCE(_room_id,room_id),actual_check_in=now() WHERE id=_reservation_id; RETURN jsonb_build_object('ok',true,'reservation_id',_reservation_id); END $$;
CREATE OR REPLACE FUNCTION public.pms_check_out_reservation(_reservation_id uuid,_acknowledge_balance boolean) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN UPDATE reservations SET status='checked_out',actual_check_out=now() WHERE id=_reservation_id; RETURN jsonb_build_object('ok',true,'reservation_id',_reservation_id); END $$;
CREATE OR REPLACE FUNCTION public.pms_create_reservation(_hotel_id text,_guest_id uuid,_check_in date,_check_out date,_adults integer,_children integer,_room_id uuid,_room_type_requested text,_rate_per_night numeric,_currency text,_source text,_special_requests text,_internal_notes text,_status text) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE rid uuid; BEGIN INSERT INTO reservations(hotel_id,organization_slug,guest_id,check_in_date,check_out_date,adults,children,room_id,room_type_requested,rate_per_night,currency,source,special_requests,internal_notes,status) VALUES(_hotel_id,public.get_user_organization_slug(auth.uid()),_guest_id,_check_in,_check_out,_adults,_children,_room_id,_room_type_requested,_rate_per_night,_currency,_source,_special_requests,_internal_notes,COALESCE(_status,'confirmed')::reservation_status) RETURNING id INTO rid; RETURN jsonb_build_object('ok',true,'reservation_id',rid); END $$;
CREATE OR REPLACE FUNCTION public.pms_update_reservation(_reservation_id uuid,_check_in date,_check_out date,_adults integer,_children integer,_room_id uuid,_clear_room boolean,_rate_per_night numeric,_source text,_room_type_requested text,_special_requests text,_internal_notes text) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN UPDATE reservations SET check_in_date=COALESCE(_check_in,check_in_date),check_out_date=COALESCE(_check_out,check_out_date),adults=COALESCE(_adults,adults),children=COALESCE(_children,children),room_id=CASE WHEN _clear_room THEN NULL ELSE COALESCE(_room_id,room_id) END,rate_per_night=COALESCE(_rate_per_night,rate_per_night),source=COALESCE(_source,source),room_type_requested=COALESCE(_room_type_requested,room_type_requested),special_requests=COALESCE(_special_requests,special_requests),internal_notes=COALESCE(_internal_notes,internal_notes) WHERE id=_reservation_id; RETURN jsonb_build_object('ok',true,'reservation_id',_reservation_id); END $$;
CREATE OR REPLACE FUNCTION public.hotelcare_push_recipients(_organization_slug text,_hotel_id text,_roles text[]) RETURNS uuid[] LANGUAGE sql STABLE AS $$ SELECT ARRAY[]::uuid[] $$;
CREATE OR REPLACE FUNCTION public.hotelcare_dispatch_push(_user_ids uuid[],_title text,_body text,_url text,_tag text,_event_type text,_data jsonb) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
-- Existing legacy booking-number overload, used before phase 3.
CREATE OR REPLACE FUNCTION public.ntak_booking_no(_channex_booking_id text,_pms_reservation_id text,_reservation_number text,_id uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT left(COALESCE(NULLIF(_channex_booking_id,''),NULLIF(_pms_reservation_id,''),NULLIF(_reservation_number,''),_id::text),255) $$;
-- Scheduler double: never start a job or send an HTTP request.
CREATE SCHEMA cron;
CREATE FUNCTION cron.schedule(job_name text,schedule text,command text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
-- Pre-existing policies were absent from the export. These explicitly scoped
-- test doubles permit the new restrictive policies to be meaningfully tested.
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
GRANT SELECT ON public.profiles,public.reservations,public.ntak_unit_profiles,public.ntak_room_type_units TO authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ntak_settings','viza_settings','ntak_messages','ntak_daily_closures','ntak_booking_queue','ntak_event_queue','viza_guest_events'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
   EXECUTE format('CREATE POLICY acceptance_existing_scope ON public.%I FOR SELECT TO authenticated USING (public.user_can_access_hotel(auth.uid(),hotel_id))',t);
 END LOOP;
END $$;
