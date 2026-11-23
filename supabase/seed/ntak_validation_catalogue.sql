-- Manual NTAK test fixture, derived from the supplied Phase 8 category list.
-- Verify the display labels against the original T03_FOGL_2_terhelés workbook before use.
-- 67 one-forint lines + 400 HUF IFA + 28,000 HUF room = 28,467 HUF.
-- Never automatically run; the room rate is billed via the reservation base,
-- IFA is computed by the closure (the catalogue item is for the guest ledger).
BEGIN;
DO $$
DECLARE
  v_hotel constant text := 'channex-test-property';
  v_org constant text := 'channex';
  item record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ntak_settings WHERE hotel_id=v_hotel AND environment='test')
     OR NOT EXISTS (SELECT 1 FROM public.hotel_configurations WHERE hotel_id=v_hotel)
  THEN RAISE EXCEPTION 'Refusing NTAK seed outside designated test hotel'; END IF;
  FOR item IN SELECT * FROM (VALUES
    ('ALKOHOLOSITAL','KOKTEL','Koktél',1,27,false),
    ('ALKOHOLOSITAL','LIKOR','Likőr',1,27,false),
    ('ALKOHOLOSITAL','SOR','Sör',1,27,false),
    ('ALKOHOLOSITAL','BOR','Bor',1,27,false),
    ('ALKOHOLOSITAL','PARLAT','Párlat',1,27,false),
    ('ALKOHOLOSITAL','PEZSGO','Pezsgő',1,27,false),
    ('ALKOHOLOSITAL','ITALCSOMAG','Italcsomag',1,27,false),
    ('ALLATKERT','ALLATKERTI_PROGRAM','Állatkerti program',1,27,false),
    ('ALLATKERT','VADASPARKI_PROGRAM','Vadasparki program',1,27,false),
    ('EGYEB','BORRAVALO','Borravaló',1,27,false),
    ('EGYEB','EGYEB','Egyéb',1,27,false),
    ('EGYEB','SZERVIZDIJ','Szervizdíj',1,27,false),
    ('ETEL','REGGELI','Reggeli',1,27,false),
    ('ETEL','ELOETEL','Előétel',1,27,false),
    ('ETEL','FOETEL','Főétel',1,27,false),
    ('ETEL','KORET','Köret',1,27,false),
    ('ETEL','SAVANYUSAG_SALATA','Savanyúság, saláta',1,27,false),
    ('ETEL','SZENDVICS','Szendvics',1,27,false),
    ('ETEL','LEVES','Leves',1,27,false),
    ('ETEL','FOETEL_KORETTEL','Főétel körettel',1,27,false),
    ('ETEL','ETELCSOMAG','Ételcsomag',1,27,false),
    ('ETEL','KOSTOLO','Kóstoló',1,27,false),
    ('ETEL','DESSZERT','Desszert',1,27,false),
    ('ETEL','SNACK','Snack',1,27,false),
    ('ETEL','EGYEB','Egyéb étel',1,27,false),
    ('ETEL','PEKSUTEMENY','Péksütemény',1,27,false),
    ('ALKMENTESITAL_HELYBEN','LIMONADE_SZORP_FACSART','Limonádé, szörp, facsart ital',1,27,false),
    ('ALKMENTESITAL_HELYBEN','ALKOHOLMENTES_KOKTEL','Alkoholmentes koktél',1,27,false),
    ('ALKMENTESITAL_HELYBEN','TEA_FORROCSOKOLADE','Tea, forró csokoládé',1,27,false),
    ('ALKMENTESITAL_HELYBEN','KAVE','Kávé',1,27,false),
    ('ALKMENTESITAL_HELYBEN','VIZ','Víz (helyben készített)',1,27,false),
    ('ALKMENTESITAL_HELYBEN','ITALCSOMAG','Italcsomag (helyben készített)',1,27,false),
    ('KALANDPARK','KALANDPARKI_PROGRAM','Kalandparki program',1,27,false),
    ('KALANDPARK','ELMENYKOZPONTI_PROGRAM','Élményközponti program',1,27,false),
    ('KOZFURDO','FURDO_PROGRAM','Fürdőprogram',1,27,false),
    ('KOZFURDO','EGESZSEGUGYI_SZOLGALTATAS','Egészségügyi szolgáltatás',1,27,false),
    ('KOZFURDO','STRAND_PROGRAM','Strandprogram',1,27,false),
    ('KOZFURDO','USZODAI_PROGRAM','Uszodai program',1,27,false),
    ('KOZFURDO','WELLNESS_PROGRAM','Wellnessprogram',1,27,false),
    ('MUZEUM_VAR_KASTELY','MUZEUMPEDAGOGIA','Múzeumpedagógia',1,27,false),
    ('MUZEUM_VAR_KASTELY','TARLATVEZETES','Tárlatvezetés',1,27,false),
    ('MUZEUM_VAR_KASTELY','EGYHAZI_LETESITMENY_LATOGATASA','Egyházi létesítmény látogatása',1,27,false),
    ('MUZEUM_VAR_KASTELY','VARLATOGATAS','Várlátogatás',1,27,false),
    ('MUZEUM_VAR_KASTELY','EGYEB_MUEMLEK_LATOGATASA','Egyéb műemlék látogatása',1,27,false),
    ('MUZEUM_VAR_KASTELY','OKTATASI_PROGRAM','Oktatási program (múzeum)',1,27,false),
    ('MUZEUM_VAR_KASTELY','KIALLITAS','Kiállítás',1,27,false),
    ('MUZEUM_VAR_KASTELY','KASTELYLATOGATAS','Kastélylátogatás',1,27,false),
    ('ALKMENTESITAL_NEM_HELYBEN','ROSTOS_UDITO','Rostos üdítő',1,27,false),
    ('ALKMENTESITAL_NEM_HELYBEN','ITALCSOMAG','Italcsomag (nem helyben készített)',1,27,false),
    ('ALKMENTESITAL_NEM_HELYBEN','SZENSAVMENTES_UDITO','Szénsavmentes üdítő',1,27,false),
    ('ALKMENTESITAL_NEM_HELYBEN','VIZ','Víz (nem helyben készített)',1,27,false),
    ('ALKMENTESITAL_NEM_HELYBEN','SZENSAVAS_UDITO','Szénsavas üdítő',1,27,false),
    ('TERMESZETES_FURDO','SZABADVIZI_STRAND_PROGRAM','Szabadvízi strandprogram',1,27,false),
    ('TURISZTIKAI_KOZLEKEDES','TAVI_HAJOZAS','Tavi hajózás',1,27,false),
    ('TURISZTIKAI_KOZLEKEDES','FOLYAMI_HAJOZAS','Folyami hajózás',1,27,false),
    ('TURISZTIKAI_KOZLEKEDES','HOP_ON_HOP_OFF','Hop-on hop-off',1,27,false),
    ('VEDETT_TERMESZETI_TERULET','OKTATASI_PROGRAM','Oktatási program (természet)',1,27,false),
    ('VEDETT_TERMESZETI_TERULET','NEMZETI_PARK_LATOGATAS','Nemzeti park látogatása',1,27,false),
    ('VEDETT_TERMESZETI_TERULET','TURAK_KIRANDULASOK','Túrák, kirándulások',1,27,false),
    ('VEDETT_TERMESZETI_TERULET','TARLATVEZETES','Tárlatvezetés (természet)',1,27,false),
    ('VEDETT_TERMESZETI_TERULET','BARLANGLATOGATAS','Barlanglátogatás',1,27,false),
    ('VEDETT_TERMESZETI_TERULET','PARKLATOGATAS','Parklátogatás',1,27,false),
    ('VEDETT_TERMESZETI_TERULET','TEMATIKUS_BEMUTATOHELY_LATOGATAS','Tematikus bemutatóhely látogatása',1,27,false),
    ('VIDAMPARK','VIDAMPARKI_PROGRAM','Vidámparki program',1,27,false),
    ('ZENES_TANCOS_RENDEZVENY','KONCERT','Koncert',1,27,false),
    ('ZENES_TANCOS_RENDEZVENY','KULTURALIS_RENDEZVENY','Kulturális rendezvény',1,27,false),
    ('ZENES_TANCOS_RENDEZVENY','FESZTIVAL','Fesztivál',1,27,false),
    ('IFA',NULL,'Idegenforgalmi adó',400,0,false),
    ('SZALLASDIJ',NULL,'Szállásdíj',28000,5,true)
  ) AS v(main,sub,name,price,vat,pack)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.service_catalog_items WHERE organization_slug=v_org AND allowed_hotel_ids=ARRAY[v_hotel]
      AND ntak_main=item.main AND ntak_sub IS NOT DISTINCT FROM item.sub
      AND name='NTAK – '||item.name
    ) THEN
      INSERT INTO public.service_catalog_items(organization_slug,name,category,unit,default_gross_price,currency,
        vat_code,vat_rate,allowed_hotel_ids,price_editable,is_active,ntak_main,ntak_sub,in_package)
      VALUES(v_org,'NTAK – '||item.name,CASE WHEN item.main='SZALLASDIJ' THEN 'room' WHEN item.main='IFA' THEN 'city_tax' ELSE 'other' END,
        'item',item.price,'HUF','REVIEW_REQUIRED',item.vat,ARRAY[v_hotel],false,true,item.main,item.sub,item.pack);
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.service_catalog_items WHERE organization_slug=v_org AND allowed_hotel_ids=ARRAY[v_hotel] AND name LIKE 'NTAK – %' AND is_active)<>69
     OR (SELECT sum(default_gross_price) FROM public.service_catalog_items WHERE organization_slug=v_org AND allowed_hotel_ids=ARRAY[v_hotel] AND name LIKE 'NTAK – %' AND is_active)<>28467
  THEN RAISE EXCEPTION 'NTAK fixture count or total differs from expected'; END IF;
END;
$$;
COMMIT;
