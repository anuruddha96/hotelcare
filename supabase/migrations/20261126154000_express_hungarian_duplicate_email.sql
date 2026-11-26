-- Fix Hungarian diacritic variants in verified document matching and preserve explicitly confirmed contact email.
-- Identity still requires same property, document type/number, DOB, nationality and equivalent names.
-- No guest deletion, history rewrites, name-only/email-only matching, or cross-property disclosure.
CREATE OR REPLACE FUNCTION public.pms_register_scanned_stay_guest(
  _reservation_id uuid, _data jsonb, _confirmed_match uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $express$
DECLARE
  r public.reservations%ROWTYPE;
  g public.guests%ROWTYPE;
  actor uuid := auth.uid();
  incoming public.guests%ROWTYPE;
  matches uuid[];
  linked_matches uuid[];
  candidates jsonb;
  linked_expected boolean := false;
  contact_email text;
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
    'entry_details_reason',_data->'viza_review'->>'entry_details_reason',
    'entry_details_reason_text',_data->'viza_review'->>'entry_details_reason_text',
    'parent_statement',COALESCE(_data->'viza_review'->'parent_statement'='true'::jsonb,false),
    'manual_reason',left(_data->'viza_review'->>'manual_reason',500),
    'scan_reviewed',false);
  IF review->'entry_details_absent'='true'::jsonb THEN
    IF review->>'entry_details_reason'='lives_in_hungary_with_permit' THEN
      IF review->'visa_exempt'='true'::jsonb OR NULLIF(btrim(incoming.visa_number),'') IS NULL OR public.pms_viza_is_placeholder(incoming.visa_number) THEN RAISE EXCEPTION 'EXPRESS_INVALID_ENTRY_REASON'; END IF;
    ELSIF review->>'entry_details_reason' IS DISTINCT FROM 'other' OR char_length(btrim(COALESCE(review->>'entry_details_reason_text','')))<10 THEN RAISE EXCEPTION 'EXPRESS_INVALID_ENTRY_REASON';
    END IF;
    incoming:=jsonb_populate_record(incoming,jsonb_build_object('entry_date',NULL,'entry_place',NULL));
  END IF;
  IF review->'visa_exempt'='true'::jsonb THEN incoming:=jsonb_populate_record(incoming,jsonb_build_object('visa_number',NULL)); END IF;
  IF public.pms_viza_is_placeholder(incoming.visa_number) OR public.pms_viza_is_placeholder(incoming.entry_place)
    OR public.pms_viza_is_placeholder(incoming.birth_place) OR public.pms_viza_is_placeholder(incoming.birth_first_name)
    OR public.pms_viza_is_placeholder(incoming.birth_last_name) OR public.pms_viza_is_placeholder(incoming.mother_family_name)
    OR public.pms_viza_is_placeholder(incoming.mother_given_name) OR public.pms_viza_is_placeholder(incoming.mother_name) THEN RAISE EXCEPTION 'EXPRESS_INVALID_DATA'; END IF;
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
  doc := NULLIF(upper(btrim(incoming.id_document_number)),'');
  IF doc IS NOT NULL THEN
    -- Serialize document-first registrations within an organization.
    PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(r.organization_slug,'')||':'||doc,0));
    -- Lock document owners before presenting candidates or accepting a selection.
    PERFORM 1 FROM public.guests WHERE organization_slug IS NOT DISTINCT FROM r.organization_slug
      AND upper(btrim(id_document_number))=doc AND id_document_type=incoming.id_document_type ORDER BY id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.guests WHERE organization_slug IS NOT DISTINCT FROM r.organization_slug
        AND upper(btrim(id_document_number))=doc AND id_document_type=incoming.id_document_type) THEN
      -- Names/email alone are never identity matches. Only same-property,
      -- corroborated document + DOB + nationality + name candidates are selectable.
      SELECT array_agg(x.id ORDER BY x.id) INTO matches FROM public.guests x
        WHERE x.organization_slug IS NOT DISTINCT FROM r.organization_slug AND x.hotel_id=r.hotel_id
          AND upper(btrim(x.id_document_number))=doc AND x.id_document_type=incoming.id_document_type
          AND x.date_of_birth IS NOT NULL AND x.date_of_birth=incoming.date_of_birth
          AND (
            (lower(btrim(x.first_name))=lower(btrim(incoming.first_name))
             AND lower(btrim(x.last_name))=lower(btrim(incoming.last_name)))
            OR (
              public.pms_viza_country_code(incoming.nationality)='HU'
              AND translate(lower(btrim(x.first_name)),'áéíóöőúüű','aeiooouuu')=translate(lower(btrim(incoming.first_name)),'áéíóöőúüű','aeiooouuu')
              AND translate(lower(btrim(x.last_name)),'áéíóöőúüű','aeiooouuu')=translate(lower(btrim(incoming.last_name)),'áéíóöőúüű','aeiooouuu')
            )
          )
          AND public.pms_viza_country_code(x.nationality) IS NOT NULL
          AND public.pms_viza_country_code(x.nationality)=public.pms_viza_country_code(incoming.nationality)
          AND NOT EXISTS (SELECT 1 FROM public.reservation_guests rg JOIN public.reservations rr ON rr.id=rg.reservation_id
            WHERE rg.guest_id=x.id AND ((rg.reservation_id=r.id AND rg.stay_state<>'expected')
              OR (rg.reservation_id<>r.id AND (rg.stay_state='in_house' OR (rg.stay_state='expected' AND rr.status::text='checked_in')))));
      IF COALESCE(cardinality(matches),0)=0 THEN RAISE EXCEPTION 'EXPRESS_IDENTITY_CONFLICT'; END IF;
      -- A document already on the roster must update that occupant rather
      -- than fill another slot with a duplicate person.
      SELECT array_agg(rg.guest_id ORDER BY rg.guest_id) INTO linked_matches
        FROM public.reservation_guests rg WHERE rg.reservation_id=r.id AND rg.stay_state='expected' AND rg.guest_id=ANY(matches);
      IF COALESCE(cardinality(linked_matches),0)>1 THEN RAISE EXCEPTION 'EXPRESS_IDENTITY_CONFLICT'; END IF;
      IF cardinality(linked_matches)=1 THEN matches:=linked_matches; END IF;
      -- Never attach another profile if the same document is already attached
      -- to a conflicting or already-arrived occupant in this reservation.
      IF EXISTS(SELECT 1 FROM public.reservation_guests rg JOIN public.guests x ON x.id=rg.guest_id
        WHERE rg.reservation_id=r.id AND rg.stay_state<>'void'
          AND upper(btrim(x.id_document_number))=doc AND x.id_document_type=incoming.id_document_type
          AND NOT (x.id=ANY(matches))) THEN RAISE EXCEPTION 'EXPRESS_IDENTITY_CONFLICT'; END IF;
      IF _confirmed_match IS NULL THEN
        SELECT jsonb_agg(jsonb_build_object('guest_id',x.id,'first_name',x.first_name,'last_name',x.last_name,
          'date_of_birth',x.date_of_birth,'email',NULLIF(btrim(x.email),''),'linked',COALESCE(x.id=ANY(linked_matches),false)) ORDER BY (NULLIF(btrim(x.email),'') IS NOT NULL) DESC, x.id)
          INTO candidates FROM public.guests x WHERE x.id=ANY(matches);
        RETURN jsonb_build_object('status','match','guest_id',matches[1],'candidates',candidates);
      END IF;
      IF NOT (_confirmed_match=ANY(matches)) THEN RAISE EXCEPTION 'EXPRESS_IDENTITY_CONFLICT'; END IF;
      SELECT * INTO g FROM public.guests WHERE id=_confirmed_match FOR UPDATE;
      linked_expected:=COALESCE(g.id=ANY(linked_matches),false);
    END IF;
  END IF;
  IF _confirmed_match IS NOT NULL AND g.id IS NULL THEN RAISE EXCEPTION 'EXPRESS_IDENTITY_CONFLICT'; END IF;
  IF NOT linked_expected AND NOT (g.id IS NOT NULL AND g.id IS NOT DISTINCT FROM r.guest_id)
     AND active_count>=COALESCE(r.adults,1)+COALESCE(r.children,0) THEN RAISE EXCEPTION 'EXPRESS_OCCUPANCY_FULL'; END IF;
  -- Contact changes are optional and explicit, never a deduplication key.
  contact_email:=NULLIF(btrim(_data->>'confirmed_contact_email'),'');
  IF contact_email IS NOT NULL AND (length(contact_email)>254
      OR contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') THEN RAISE EXCEPTION 'EXPRESS_INVALID_DATA'; END IF;
  IF g.id IS NULL THEN
    INSERT INTO public.guests (hotel_id,organization_slug,first_name,last_name,nationality,date_of_birth,birth_place,gender,
      birth_last_name,birth_first_name,mother_name,mother_family_name,mother_given_name,id_document_type,id_document_number,
      visa_number,entry_date,entry_place,document_scan,viza_review,email)
    VALUES (r.hotel_id,r.organization_slug,incoming.first_name,incoming.last_name,incoming.nationality,incoming.date_of_birth,incoming.birth_place,incoming.gender,
      incoming.birth_last_name,incoming.birth_first_name,incoming.mother_name,incoming.mother_family_name,incoming.mother_given_name,incoming.id_document_type,incoming.id_document_number,
      incoming.visa_number,incoming.entry_date,incoming.entry_place,scan,review,contact_email) RETURNING * INTO g;
  ELSE
    -- Corroborated returning-guest match, explicitly approved by reception. Never replace names, DOB or document identity.
    UPDATE public.guests SET birth_last_name=COALESCE(incoming.birth_last_name,birth_last_name),birth_first_name=COALESCE(incoming.birth_first_name,birth_first_name),
      birth_place=COALESCE(incoming.birth_place,birth_place),gender=incoming.gender,mother_name=COALESCE(incoming.mother_name,mother_name),
      mother_family_name=COALESCE(incoming.mother_family_name,mother_family_name),mother_given_name=COALESCE(incoming.mother_given_name,mother_given_name),
      visa_number=incoming.visa_number,entry_date=incoming.entry_date,entry_place=incoming.entry_place,
      document_scan=COALESCE(scan,document_scan),viza_review=review,email=COALESCE(contact_email,email)
      WHERE id=g.id RETURNING * INTO g;
  END IF;
  IF NOT linked_expected THEN PERFORM public.pms_add_stay_guest(r.id,g.id); END IF;
  RETURN jsonb_build_object('status','registered','guest_id',g.id);
END;
$express$;
REVOKE ALL ON FUNCTION public.pms_register_scanned_stay_guest(uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pms_register_scanned_stay_guest(uuid,jsonb,uuid) TO authenticated;
