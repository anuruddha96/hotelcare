-- Manual transaction-contained regression test for the shared inventory
-- historical-watch reactivation migration. Run AFTER the migration.
-- All test rows roll back (nothing is published to Previo).
BEGIN;

DO $$
DECLARE
  v_hotel text := '__shared_reactivation_sql_test__';
  v_date date := '2099-10-19';
  v_count integer;
  v_duplicate_blocked boolean := false;
BEGIN
  -- A previous Queen/Quad watch already fired and closed after a booking.
  INSERT INTO public.room_sale_overnight_watches
    (hotel_id, organization_slug, stay_date, first_obk_id, second_obk_id,
     baseline_confirmed, baseline_refs, starts_at, expires_at, status,
     triggered_reservation, last_confirmed_remaining)
  VALUES
    (v_hotel,'__test__',v_date,'queen','quad',
     18,ARRAY['old-booking||queen'],
     '2099-10-18T00:00:00Z','2099-10-20T04:00:00Z','closed',
     'new-queen-booking:queen',0);

  -- A fresh live inventory check can create another independent baseline.
  INSERT INTO public.room_sale_overnight_watches
    (hotel_id, organization_slug, stay_date, first_obk_id, second_obk_id,
     baseline_confirmed, baseline_refs, starts_at, expires_at, status,
     shared_units, physical_capacity, last_confirmed_remaining)
  VALUES
    (v_hotel,'__test__',v_date,'queen','quad',
     20,ARRAY['old-booking||queen','new-queen-booking||queen'],
     '2099-10-19T00:00:00Z','2099-10-20T04:00:00Z','active',
     1,21,1);

  SELECT count(*) INTO v_count
  FROM public.room_sale_overnight_watches
  WHERE hotel_id=v_hotel AND stay_date=v_date;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Expected preserved historical watch and one reactivation, found %',v_count;
  END IF;

  BEGIN
    -- Different room pairs must NOT bypass the one-live-watch rule.
    INSERT INTO public.room_sale_overnight_watches
      (hotel_id, organization_slug, stay_date, first_obk_id, second_obk_id,
       baseline_confirmed, baseline_refs, starts_at, expires_at, status,
       shared_units, physical_capacity)
    VALUES
      (v_hotel,'__test__',v_date,'queen','triple',
       20,ARRAY['other-booking||queen'],
       '2099-10-19T00:00:00Z','2099-10-20T04:00:00Z','active',
       1,21);
  EXCEPTION WHEN unique_violation THEN
    v_duplicate_blocked := true;
  END;

  IF NOT v_duplicate_blocked THEN
    RAISE EXCEPTION 'Two overlapping active booking protections were accepted';
  END IF;
END $$;

ROLLBACK;
