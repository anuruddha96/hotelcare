-- VIZA document-aware check-in, scoped to VIZA-enabled properties.
-- Review flags contain no document images and are bound to the reservation.
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS mother_family_name text;
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS mother_given_name text;
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS viza_review jsonb;

CREATE OR REPLACE FUNCTION public.pms_viza_country_code(_code text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN upper(btrim(_code))=ANY(ARRAY['AW','AF','AO','AI','AX','AL','AD','AE','AR','AM','AS','AQ','TF','AG','AU','AT','AZ','BI','BE','BJ','BQ','BF','BD','BG','BH','BS','BA','BL','BY','BZ','BM','BO','BR','BB','BN','BT','BV','BW','CF','CA','CC','CH','CL','CN','CI','CM','CD','CG','CK','CO','KM','CV','CR','CU','CW','CX','KY','CY','CZ','DE','DJ','DM','DK','DO','DZ','EC','EG','ER','EH','ES','EE','ET','FI','FJ','FK','FR','FO','FM','GA','GB','GE','GG','GH','GI','GN','GP','GM','GW','GQ','GR','GD','GL','GT','GF','GU','GY','HK','HM','HN','HR','HT','HU','ID','IM','IN','IO','IE','IR','IQ','IS','IL','IT','JM','JE','JO','JP','KZ','KE','KG','KH','KI','KN','KR','KW','LA','LB','LR','LY','LC','LI','LK','LS','LT','LU','LV','MO','MF','MA','MC','MD','MG','MV','MX','MH','MK','ML','MT','MM','ME','MN','MP','MZ','MR','MS','MQ','MU','MW','MY','YT','NA','NC','NE','NF','NG','NI','NU','NL','NO','NP','NR','NZ','OM','PK','PA','PN','PE','PH','PW','PG','PL','PR','KP','PT','PY','PS','PF','QA','RE','RO','RU','RW','SA','SD','SN','SG','GS','SH','SJ','SB','SL','SV','SM','SO','PM','RS','SS','ST','SR','SK','SI','SE','SZ','SX','SC','SY','TC','TD','TG','TH','TJ','TK','TM','TL','TO','TT','TN','TR','TV','TW','TZ','UG','UA','UM','UY','US','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','ZA','ZM','ZW','XK'])
 THEN upper(btrim(_code)) ELSE '{"ABW":"AW","AFG":"AF","AGO":"AO","AIA":"AI","ALA":"AX","ALB":"AL","AND":"AD","ARE":"AE","ARG":"AR","ARM":"AM","ASM":"AS","ATA":"AQ","ATF":"TF","ATG":"AG","AUS":"AU","AUT":"AT","AZE":"AZ","BDI":"BI","BEL":"BE","BEN":"BJ","BES":"BQ","BFA":"BF","BGD":"BD","BGR":"BG","BHR":"BH","BHS":"BS","BIH":"BA","BLM":"BL","BLR":"BY","BLZ":"BZ","BMU":"BM","BOL":"BO","BRA":"BR","BRB":"BB","BRN":"BN","BTN":"BT","BVT":"BV","BWA":"BW","CAF":"CF","CAN":"CA","CCK":"CC","CHE":"CH","CHL":"CL","CHN":"CN","CIV":"CI","CMR":"CM","COD":"CD","COG":"CG","COK":"CK","COL":"CO","COM":"KM","CPV":"CV","CRI":"CR","CUB":"CU","CUW":"CW","CXR":"CX","CYM":"KY","CYP":"CY","CZE":"CZ","DEU":"DE","DJI":"DJ","DMA":"DM","DNK":"DK","DOM":"DO","DZA":"DZ","ECU":"EC","EGY":"EG","ERI":"ER","ESH":"EH","ESP":"ES","EST":"EE","ETH":"ET","FIN":"FI","FJI":"FJ","FLK":"FK","FRA":"FR","FRO":"FO","FSM":"FM","GAB":"GA","GBR":"GB","GEO":"GE","GGY":"GG","GHA":"GH","GIB":"GI","GIN":"GN","GLP":"GP","GMB":"GM","GNB":"GW","GNQ":"GQ","GRC":"GR","GRD":"GD","GRL":"GL","GTM":"GT","GUF":"GF","GUM":"GU","GUY":"GY","HKG":"HK","HMD":"HM","HND":"HN","HRV":"HR","HTI":"HT","HUN":"HU","IDN":"ID","IMN":"IM","IND":"IN","IOT":"IO","IRL":"IE","IRN":"IR","IRQ":"IQ","ISL":"IS","ISR":"IL","ITA":"IT","JAM":"JM","JEY":"JE","JOR":"JO","JPN":"JP","KAZ":"KZ","KEN":"KE","KGZ":"KG","KHM":"KH","KIR":"KI","KNA":"KN","KOR":"KR","KWT":"KW","LAO":"LA","LBN":"LB","LBR":"LR","LBY":"LY","LCA":"LC","LIE":"LI","LKA":"LK","LSO":"LS","LTU":"LT","LUX":"LU","LVA":"LV","MAC":"MO","MAF":"MF","MAR":"MA","MCO":"MC","MDA":"MD","MDG":"MG","MDV":"MV","MEX":"MX","MHL":"MH","MKD":"MK","MLI":"ML","MLT":"MT","MMR":"MM","MNE":"ME","MNG":"MN","MNP":"MP","MOZ":"MZ","MRT":"MR","MSR":"MS","MTQ":"MQ","MUS":"MU","MWI":"MW","MYS":"MY","MYT":"YT","NAM":"NA","NCL":"NC","NER":"NE","NFK":"NF","NGA":"NG","NIC":"NI","NIU":"NU","NLD":"NL","NOR":"NO","NPL":"NP","NRU":"NR","NZL":"NZ","OMN":"OM","PAK":"PK","PAN":"PA","PCN":"PN","PER":"PE","PHL":"PH","PLW":"PW","PNG":"PG","POL":"PL","PRI":"PR","PRK":"KP","PRT":"PT","PRY":"PY","PSE":"PS","PYF":"PF","QAT":"QA","REU":"RE","ROU":"RO","RUS":"RU","RWA":"RW","SAU":"SA","SDN":"SD","SEN":"SN","SGP":"SG","SGS":"GS","SHN":"SH","SJM":"SJ","SLB":"SB","SLE":"SL","SLV":"SV","SMR":"SM","SOM":"SO","SPM":"PM","SRB":"RS","SSD":"SS","STP":"ST","SUR":"SR","SVK":"SK","SVN":"SI","SWE":"SE","SWZ":"SZ","SXM":"SX","SYC":"SC","SYR":"SY","TCA":"TC","TCD":"TD","TGO":"TG","THA":"TH","TJK":"TJ","TKL":"TK","TKM":"TM","TLS":"TL","TON":"TO","TTO":"TT","TUN":"TN","TUR":"TR","TUV":"TV","TWN":"TW","TZA":"TZ","UGA":"UG","UKR":"UA","UMI":"UM","URY":"UY","USA":"US","UZB":"UZ","VAT":"VA","VCT":"VC","VEN":"VE","VGB":"VG","VIR":"VI","VNM":"VN","VUT":"VU","WLF":"WF","WSM":"WS","YEM":"YE","ZAF":"ZA","ZMB":"ZM","ZWE":"ZW","D":"DE","RKS":"XK","XKX":"XK","UNK":"XK","GBD":"GB","GBN":"GB","GBO":"GB","GBP":"GB","GBS":"GB"}'::jsonb->>upper(btrim(_code)) END;
$$;

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
     IF g.entry_date IS NULL OR g.entry_date>_day THEN missing:=array_append(missing,'entry_date'); END IF;
     IF NULLIF(btrim(g.entry_place),'') IS NULL THEN missing:=array_append(missing,'entry_place'); END IF;
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
