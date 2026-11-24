-- Allow explicitly reviewed, stay-scoped unavailable entry details without weakening supplied-value checks.
CREATE OR REPLACE FUNCTION public.pms_assert_viza_arrival_data(_reservation_id uuid,_guest_ids uuid[],_day date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 r public.reservations%ROWTYPE;
 g record;
 missing text[];
 failures jsonb:='[]'::jsonb;
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
 SELECT * INTO r FROM public.reservations WHERE id=_reservation_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.viza_settings WHERE hotel_id=r.hotel_id AND enabled AND adatszolgaltatasi_azonosito IS NOT NULL) THEN RETURN; END IF;
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
     failures:=failures||jsonb_build_array(jsonb_build_object('guest','—','fields',ARRAY['occupant_count']));
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
     IF char_length(value)>200 OR octet_length(value)>254 OR (
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
   IF NULLIF(btrim(g.birth_place),'') IS NULL AND (no_exception OR NOT COALESCE(review->'birth_place_absent'='true'::jsonb,false)) THEN missing:=array_append(missing,'birth_place'); END IF;
   IF g.gender IS NULL OR g.gender NOT IN ('male','female','other') THEN missing:=array_append(missing,'gender'); END IF;
   IF (required_doc OR NULLIF(btrim(g.id_document_type),'') IS NOT NULL) AND (g.id_document_type IS NULL OR g.id_document_type NOT IN ('passport','id_card','driving_licence','other')) THEN missing:=array_append(missing,'id_document_type'); END IF;
   IF (required_doc AND NOT has_doc) OR char_length(btrim(g.id_document_number))>100 THEN missing:=array_append(missing,'id_document_number'); END IF;
   IF country IS NOT NULL AND country NOT IN ('AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO','CH') THEN
     IF (g.entry_date IS NULL AND NOT COALESCE(review->'entry_details_absent'='true'::jsonb,false)) OR g.entry_date>_day THEN missing:=array_append(missing,'entry_date'); END IF;
     IF (NULLIF(btrim(g.entry_place),'') IS NULL AND NOT COALESCE(review->'entry_details_absent'='true'::jsonb,false)) OR char_length(btrim(g.entry_place))>200 OR octet_length(btrim(g.entry_place))>254 THEN missing:=array_append(missing,'entry_place'); END IF;
     IF (NULLIF(btrim(g.visa_number),'') IS NULL AND NOT COALESCE(review->'visa_exempt'='true'::jsonb,false)) OR char_length(btrim(g.visa_number))>100 THEN missing:=array_append(missing,'visa_number'); END IF;
   END IF;
   IF child_without_doc THEN
     IF NOT COALESCE(review->'parent_statement'='true'::jsonb,false) THEN missing:=array_append(missing,'parent_statement'); END IF;
   ELSIF NOT (COALESCE(review->'scan_reviewed'='true'::jsonb,false) AND g.document_scan IS NOT NULL)
     AND NULLIF(btrim(review->>'manual_reason'),'') IS NULL THEN
     missing:=array_append(missing,'manual_reason');
   END IF;
   IF cardinality(missing)>0 THEN
     failures:=failures||jsonb_build_array(jsonb_build_object('guest',COALESCE(NULLIF(btrim(concat_ws(' ',g.last_name,g.first_name)),''),g.guest_id::text,'—'),'fields',missing));
   END IF;
 END LOOP;
 IF _guest_ids IS NULL AND r.guest_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.reservation_guests WHERE reservation_id=r.id) THEN
   failures:=failures||jsonb_build_array(jsonb_build_object('guest','—','fields',ARRAY['occupant_count']));
 END IF;
 IF jsonb_array_length(failures)>0 THEN RAISE EXCEPTION 'VIZA_GUEST_DATA_INCOMPLETE: %',failures::text; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.pms_assert_viza_arrival_data(uuid,uuid[],date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pms_assert_viza_arrival_data(uuid,uuid[],date) TO service_role;

-- Atomic document-first occupant registration. No changes to reporting or housekeeping.
CREATE OR REPLACE FUNCTION public.pms_register_scanned_stay_guest(
  _reservation_id uuid, _data jsonb, _confirmed_match uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $express$
DECLARE
  r public.reservations%ROWTYPE;
  g public.guests%ROWTYPE;
  actor uuid := auth.uid();
  incoming public.guests%ROWTYPE;
  matches uuid[];
  active_count integer;
  scan jsonb;
  review jsonb;
  doc text;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id FOR UPDATE;
  IF NOT FOUND OR actor IS NULL OR NOT COALESCE(public.can_access_pms_hotel(actor,r.hotel_id,r.organization_slug),false) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  IF r.status::text NOT IN ('confirmed','pending','checked_in') OR (r.status::text='checked_in' AND NOT public.pms_ntak_guest_scope(r.id,r.room_id)) THEN RAISE EXCEPTION 'EXPRESS_STAY_NOT_OPEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.viza_settings WHERE hotel_id=r.hotel_id AND enabled AND adatszolgaltatasi_azonosito IS NOT NULL) THEN
    RAISE EXCEPTION 'EXPRESS_VIZA_NOT_ENABLED';
  END IF;
  -- The server controls tenant, stay and timestamps; accept only explicitly selected fields.
  IF jsonb_typeof(_data) IS DISTINCT FROM 'object' OR octet_length(_data::text)>16000 THEN RAISE EXCEPTION 'EXPRESS_INVALID_DATA'; END IF;
  incoming := jsonb_populate_record(NULL::public.guests, _data - 'id' - 'hotel_id' - 'organization_slug' - 'created_at' - 'updated_at');
  IF NULLIF(btrim(incoming.first_name),'') IS NULL OR NULLIF(btrim(incoming.last_name),'') IS NULL THEN RAISE EXCEPTION 'EXPRESS_NAME_REQUIRED'; END IF;
  review := jsonb_build_object(
    'reservation_id',r.id,'birth_name_absent',COALESCE(_data->'viza_review'->'birth_name_absent'='true'::jsonb,false),
    'birth_place_absent',COALESCE(_data->'viza_review'->'birth_place_absent'='true'::jsonb,false),
    'mother_name_absent',COALESCE(_data->'viza_review'->'mother_name_absent'='true'::jsonb,false),
    'visa_exempt',COALESCE(_data->'viza_review'->'visa_exempt'='true'::jsonb,false),
    'entry_details_absent',COALESCE(_data->'viza_review'->'entry_details_absent'='true'::jsonb,false),
    'parent_statement',COALESCE(_data->'viza_review'->'parent_statement'='true'::jsonb,false),
    'manual_reason',left(_data->'viza_review'->>'manual_reason',500),
    'scan_reviewed',false);
  IF jsonb_typeof(_data->'document_scan')='object' THEN
    IF _data->'document_scan'->>'source' IS DISTINCT FROM 'mrz_camera' OR jsonb_typeof(_data->'document_scan'->'fields') IS DISTINCT FROM 'object'
      OR octet_length((_data->'document_scan')::text)>4000 THEN RAISE EXCEPTION 'EXPRESS_INVALID_SCAN'; END IF;
    scan := jsonb_build_object('source','mrz_camera','format',left(_data->'document_scan'->>'format',10),
      'valid',COALESCE(_data->'document_scan'->'valid'='true'::jsonb,false),'read_at',_data->'document_scan'->>'read_at',
      'fields',jsonb_build_object(
        'csaladnev',_data->'document_scan'->'fields'->>'csaladnev','utonev',_data->'document_scan'->'fields'->>'utonev',
        'szuletesiDatum',_data->'document_scan'->'fields'->>'szuletesiDatum','allampolgarsagKod',_data->'document_scan'->'fields'->>'allampolgarsagKod',
        'nem',_data->'document_scan'->'fields'->>'nem','okmanyTipus',_data->'document_scan'->'fields'->>'okmanyTipus',
        'okmanyAzonositoSzam',_data->'document_scan'->'fields'->>'okmanyAzonositoSzam'));
    review := review || jsonb_build_object('scan_reviewed',true);
  END IF;
  -- A reservation lock prevents overfilling even from two reception devices.
  SELECT count(*) INTO active_count FROM public.reservation_guests WHERE reservation_id=r.id AND stay_state<>'void';
  IF r.guest_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.reservation_guests WHERE reservation_id=r.id AND guest_id=r.guest_id) THEN
    active_count := active_count + 1;
  END IF;
  IF active_count>=COALESCE(r.adults,1)+COALESCE(r.children,0) THEN RAISE EXCEPTION 'EXPRESS_OCCUPANCY_FULL'; END IF;
  doc := NULLIF(upper(btrim(incoming.id_document_number)),'');
  IF doc IS NOT NULL THEN
    -- Serialize document-first registrations within an organization.
    PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(r.organization_slug,'')||':'||doc,0));
    SELECT array_agg(id ORDER BY id) INTO matches FROM public.guests
      WHERE organization_slug IS NOT DISTINCT FROM r.organization_slug
        AND upper(btrim(id_document_number))=doc AND id_document_type=incoming.id_document_type;
    IF COALESCE(cardinality(matches),0)>1 THEN RAISE EXCEPTION 'EXPRESS_IDENTITY_CONFLICT'; END IF;
    IF cardinality(matches)=1 THEN
      SELECT * INTO g FROM public.guests WHERE id=matches[1] FOR UPDATE;
      -- Do not disclose or overwrite a different hotel's profile, a partial identity,
      -- a conflicting identity, or a profile already linked to an active stay.
      IF g.hotel_id IS DISTINCT FROM r.hotel_id OR g.date_of_birth IS NULL OR g.date_of_birth IS DISTINCT FROM incoming.date_of_birth
        OR lower(btrim(g.first_name)) IS DISTINCT FROM lower(btrim(incoming.first_name))
        OR lower(btrim(g.last_name)) IS DISTINCT FROM lower(btrim(incoming.last_name))
        OR public.pms_viza_country_code(g.nationality) IS NULL
        OR public.pms_viza_country_code(g.nationality) IS DISTINCT FROM public.pms_viza_country_code(incoming.nationality)
        OR EXISTS(SELECT 1 FROM public.reservation_guests rg JOIN public.reservations rr ON rr.id=rg.reservation_id
           WHERE rg.guest_id=g.id AND (rg.reservation_id=r.id OR (rg.stay_state='in_house' OR (rg.stay_state='expected' AND rr.status::text='checked_in'))))
      THEN RAISE EXCEPTION 'EXPRESS_IDENTITY_CONFLICT'; END IF;
      IF _confirmed_match IS NULL THEN RETURN jsonb_build_object('status','match','guest_id',g.id); END IF;
      IF _confirmed_match IS DISTINCT FROM g.id THEN RAISE EXCEPTION 'EXPRESS_IDENTITY_CONFLICT'; END IF;
    END IF;
  END IF;
  IF _confirmed_match IS NOT NULL AND g.id IS NULL THEN RAISE EXCEPTION 'EXPRESS_IDENTITY_CONFLICT'; END IF;
  IF g.id IS NULL THEN
    INSERT INTO public.guests (hotel_id,organization_slug,first_name,last_name,nationality,date_of_birth,birth_place,gender,
      birth_last_name,birth_first_name,mother_name,mother_family_name,mother_given_name,id_document_type,id_document_number,
      visa_number,entry_date,entry_place,document_scan,viza_review)
    VALUES (r.hotel_id,r.organization_slug,incoming.first_name,incoming.last_name,incoming.nationality,incoming.date_of_birth,incoming.birth_place,incoming.gender,
      incoming.birth_last_name,incoming.birth_first_name,incoming.mother_name,incoming.mother_family_name,incoming.mother_given_name,incoming.id_document_type,incoming.id_document_number,
      incoming.visa_number,incoming.entry_date,incoming.entry_place,scan,review) RETURNING * INTO g;
  ELSE
    -- Exact returning-guest match, explicitly approved by reception. Never replace names, DOB or document identity.
    UPDATE public.guests SET birth_last_name=COALESCE(incoming.birth_last_name,birth_last_name),birth_first_name=COALESCE(incoming.birth_first_name,birth_first_name),
      birth_place=COALESCE(incoming.birth_place,birth_place),gender=incoming.gender,mother_name=COALESCE(incoming.mother_name,mother_name),
      mother_family_name=COALESCE(incoming.mother_family_name,mother_family_name),mother_given_name=COALESCE(incoming.mother_given_name,mother_given_name),
      visa_number=incoming.visa_number,entry_date=incoming.entry_date,entry_place=incoming.entry_place,
      document_scan=COALESCE(scan,document_scan),viza_review=review
      WHERE id=g.id RETURNING * INTO g;
  END IF;
  PERFORM public.pms_add_stay_guest(r.id,g.id);
  RETURN jsonb_build_object('status','registered','guest_id',g.id);
END;
$express$;
REVOKE ALL ON FUNCTION public.pms_register_scanned_stay_guest(uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pms_register_scanned_stay_guest(uuid,jsonb,uuid) TO authenticated;
