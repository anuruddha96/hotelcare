-- VIZA EF0051: enforce both birth-place length limits in the shared admission guard.
CREATE OR REPLACE FUNCTION public.pms_viza_arrival_requirements_internal(_reservation_id uuid,_guest_ids uuid[],_day date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 r public.reservations%ROWTYPE;
 g record;
 missing text[];
 guest_results jsonb:='[]'::jsonb;
 fields jsonb;
 field_state text;
 occupant_ok boolean:=true;
 entry_absent boolean;
 visa_exempt boolean;
 permit boolean;
 third boolean;
 reviewed boolean;
 review jsonb;
 country text;
 required_doc boolean;
 has_doc boolean;
 no_exception boolean;
 child_without_doc boolean;
 roster_count integer;
 item text;
 value text;
BEGIN
 _day:=COALESCE(_day,current_date);
 SELECT * INTO r FROM public.reservations WHERE id=_reservation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.viza_settings WHERE hotel_id=r.hotel_id AND enabled AND adatszolgaltatasi_azonosito IS NOT NULL) THEN RETURN jsonb_build_object('version',2,'occupant_count_ok',true,'guests','[]'::jsonb); END IF;
 IF _guest_ids IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(_guest_ids) AS selected(id) WHERE selected.id IS NULL OR (NOT EXISTS (SELECT 1 FROM public.reservation_guests rg WHERE rg.reservation_id=r.id AND rg.guest_id=selected.id AND rg.stay_state<>'void') AND (selected.id IS DISTINCT FROM r.guest_id OR EXISTS (SELECT 1 FROM public.reservation_guests rg WHERE rg.reservation_id=r.id AND rg.guest_id=selected.id)))) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF _guest_ids IS NOT NULL AND cardinality(_guest_ids)=0 THEN occupant_ok:=false; END IF;
 -- Preserve staggered arrival, but do not admit the first group before the
 -- whole booking roster exists. Do not block repair of a historical arrival.
 IF _guest_ids IS NULL OR EXISTS (
   SELECT 1 FROM public.reservation_guests rg WHERE rg.reservation_id=r.id
    AND rg.guest_id=ANY(_guest_ids) AND rg.stay_state='expected'
 ) THEN
   SELECT count(*) INTO roster_count FROM (
    SELECT rg.guest_id FROM public.reservation_guests rg WHERE rg.reservation_id=r.id AND rg.stay_state<>'void'
    UNION SELECT r.guest_id WHERE r.guest_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.reservation_guests rg WHERE rg.reservation_id=r.id AND rg.guest_id=r.guest_id)
   ) roster;
   IF roster_count<>COALESCE(r.adults,1)+COALESCE(r.children,0) THEN
     occupant_ok:=false;
   END IF;
 END IF;
 FOR g IN
   SELECT ids.guest_id,guest.*
   FROM (
     SELECT unnest(_guest_ids) AS guest_id WHERE _guest_ids IS NOT NULL
     UNION SELECT rg.guest_id FROM public.reservation_guests rg WHERE rg.reservation_id=r.id AND _guest_ids IS NULL AND rg.stay_state<>'void'
     UNION SELECT r.guest_id WHERE _guest_ids IS NULL AND r.guest_id IS NOT NULL
   ) ids
   LEFT JOIN public.guests guest ON guest.id=ids.guest_id
 LOOP
   missing:=ARRAY[]::text[];
   review:=CASE WHEN g.viza_review->>'reservation_id'=r.id::text THEN g.viza_review ELSE '{}'::jsonb END;
   country:=public.pms_viza_country_code(g.nationality);
   required_doc:=g.date_of_birth IS NULL OR g.date_of_birth>_day OR g.date_of_birth<=(_day-interval '14 years')::date;
   has_doc:=NULLIF(btrim(g.id_document_type),'') IS NOT NULL AND NULLIF(btrim(g.id_document_number),'') IS NOT NULL;
   child_without_doc:=NOT required_doc AND NOT has_doc;
   no_exception:=COALESCE(country='HU' AND g.id_document_type='id_card',false) OR child_without_doc;
   FOREACH item IN ARRAY ARRAY['last_name','first_name','birth_last_name','birth_first_name','mother_family_name','mother_given_name'] LOOP
     value:=btrim(to_jsonb(g)->>item);
     IF char_length(value)>200 OR octet_length(value)>254 OR (item NOT IN ('last_name','first_name') AND public.pms_viza_is_placeholder(value)) OR (
       NULLIF(value,'') IS NULL AND (
         item IN ('last_name','first_name') OR no_exception OR
         (item IN ('birth_last_name','birth_first_name') AND (
           NOT COALESCE(review->'birth_name_absent'='true'::jsonb,false) OR
           NULLIF(btrim(g.birth_last_name),'') IS NOT NULL OR NULLIF(btrim(g.birth_first_name),'') IS NOT NULL
         )) OR
         (item IN ('mother_family_name','mother_given_name') AND (
           NOT COALESCE(review->'mother_name_absent'='true'::jsonb,false) OR
           NULLIF(btrim(g.mother_family_name),'') IS NOT NULL OR NULLIF(btrim(g.mother_given_name),'') IS NOT NULL
         ))
       )
     ) THEN missing:=array_append(missing,item); END IF;
   END LOOP;
   IF country IS NULL THEN missing:=array_append(missing,'nationality'); END IF;
   IF g.date_of_birth IS NULL OR g.date_of_birth>_day OR g.date_of_birth<_day-interval '110 years' THEN missing:=array_append(missing,'date_of_birth'); END IF;
   IF public.pms_viza_is_placeholder(g.birth_place) OR char_length(btrim(g.birth_place)) > 200 OR octet_length(btrim(g.birth_place)) > 254 OR (NULLIF(btrim(g.birth_place),'') IS NULL AND (no_exception OR NOT COALESCE(review->'birth_place_absent'='true'::jsonb,false))) THEN missing:=array_append(missing,'birth_place'); END IF;
   IF g.gender IS NULL OR g.gender NOT IN ('male','female','other') THEN missing:=array_append(missing,'gender'); END IF;
   IF (required_doc OR NULLIF(btrim(g.id_document_type),'') IS NOT NULL) AND (g.id_document_type IS NULL OR g.id_document_type NOT IN ('passport','id_card','driving_licence','other')) THEN missing:=array_append(missing,'id_document_type'); END IF;
   IF (NOT child_without_doc AND NOT has_doc) OR char_length(btrim(g.id_document_number))>100 THEN missing:=array_append(missing,'id_document_number'); END IF;
   third:=country IS NOT NULL AND country NOT IN ('AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO','CH');
   permit:=third AND COALESCE(review->'entry_details_absent'='true'::jsonb,false) AND COALESCE(review->>'entry_details_reason'='lives_in_hungary_with_permit',false);
   entry_absent:=third AND COALESCE(review->'entry_details_absent'='true'::jsonb,false) AND
     (permit OR (COALESCE(review->>'entry_details_reason'='other',false) AND char_length(btrim(COALESCE(review->>'entry_details_reason_text','')))>=10));
   visa_exempt:=third AND COALESCE(review->'visa_exempt'='true'::jsonb,false) AND NOT permit;
   IF third THEN
     IF NOT entry_absent AND (g.entry_date IS NULL OR g.entry_date>_day OR g.entry_date<g.date_of_birth) THEN missing:=array_append(missing,'entry_date'); END IF;
     IF NOT entry_absent AND (NULLIF(btrim(g.entry_place),'') IS NULL OR public.pms_viza_is_placeholder(g.entry_place) OR char_length(btrim(g.entry_place))>200 OR octet_length(btrim(g.entry_place))>254) THEN missing:=array_append(missing,'entry_place'); END IF;
     IF NOT visa_exempt AND (NULLIF(btrim(g.visa_number),'') IS NULL OR public.pms_viza_is_placeholder(g.visa_number) OR char_length(btrim(g.visa_number))>100 OR (permit AND COALESCE(review->'visa_exempt'='true'::jsonb,false))) THEN missing:=array_append(missing,'visa_number'); END IF;
     IF COALESCE(review->'entry_details_absent'='true'::jsonb,false) AND NOT entry_absent THEN missing:=array_append(missing,'entry_details_reason'); END IF;
   END IF;
   reviewed:=COALESCE(review->'scan_reviewed'='true'::jsonb,false) AND g.document_scan IS NOT NULL;
   IF child_without_doc THEN
     IF NOT COALESCE(review->'parent_statement'='true'::jsonb,false) THEN missing:=array_append(missing,'parent_statement'); END IF;
   ELSIF NOT (COALESCE(review->'scan_reviewed'='true'::jsonb,false) AND g.document_scan IS NOT NULL)
     AND NULLIF(btrim(review->>'manual_reason'),'') IS NULL THEN
     missing:=array_append(missing,'manual_reason');
   END IF;
   fields:='{}'::jsonb;
   FOREACH item IN ARRAY ARRAY['last_name','first_name','birth_last_name','birth_first_name','mother_family_name','mother_given_name','birth_place','nationality','date_of_birth','gender','id_document_type','id_document_number','entry_date','entry_place','visa_number','entry_details_reason','parent_statement','manual_reason'] LOOP
     field_state:=CASE
       WHEN item IN ('birth_last_name','birth_first_name','mother_family_name','mother_given_name','birth_place') AND NOT no_exception THEN 'printed_only'
       WHEN item IN ('id_document_type','id_document_number') AND child_without_doc THEN 'optional'
       WHEN item IN ('entry_date','entry_place') AND (NOT third OR entry_absent) THEN 'not_needed'
       WHEN item='visa_number' AND (NOT third OR visa_exempt) THEN 'not_needed'
       WHEN item='entry_details_reason' AND (NOT third OR NOT COALESCE(review->'entry_details_absent'='true'::jsonb,false)) THEN 'not_needed'
       WHEN item='parent_statement' AND NOT child_without_doc THEN 'not_needed'
       WHEN item='manual_reason' AND (child_without_doc OR reviewed) THEN 'not_needed'
       ELSE 'required' END;
     fields:=fields||jsonb_build_object(item,jsonb_build_object('state',field_state,'ok',NOT(item=ANY(missing))));
   END LOOP;
   guest_results:=guest_results||jsonb_build_array(jsonb_build_object('guest_id',g.guest_id,'name',COALESCE(NULLIF(btrim(concat_ws(' ',g.last_name,g.first_name)),''),g.guest_id::text,'—'),'fields',fields,'missing',missing));
 END LOOP;
 IF _guest_ids IS NULL AND r.guest_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.reservation_guests WHERE reservation_id=r.id) THEN occupant_ok:=false; END IF;
 RETURN jsonb_build_object('version',2,'occupant_count_ok',occupant_ok,'guests',guest_results);
END;
$$;
REVOKE ALL ON FUNCTION public.pms_viza_arrival_requirements_internal(uuid,uuid[],date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pms_viza_arrival_requirements_internal(uuid,uuid[],date) TO service_role;
