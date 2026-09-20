-- Run only against the disposable Postgres CI service after fixture + 4 migrations.
DO $test$
DECLARE
  work_day date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  org_id uuid := '11111111-1111-4111-8111-111111111111';
  room_id uuid := '22222222-2222-4222-8222-222222222222';
  other_room_id uuid := '33333333-3333-4333-8333-333333333333';
  room_row public.rooms%ROWTYPE;
  review public.housekeeping_stay_extension_reviews%ROWTYPE;
  history_size integer;
  review_count integer;
BEGIN
  INSERT INTO public.organizations(id, slug) VALUES (org_id, 'rdhotels');
  INSERT INTO public.hotel_configurations(hotel_id, hotel_name, organization_id)
    VALUES ('memories-budapest','Hotel Memories Budapest',org_id),
           ('mika-downtown','Hotel Mika Downtown',org_id);
  INSERT INTO public.housekeeping_stay_service_policies(
    organization_slug,hotel_id,service_code,display_label,first_due_after_nights,repeat_every_nights)
    VALUES ('rdhotels','memories-budapest','towel_change','Towels',2,2),
           ('rdhotels','memories-budapest','linen_change','Linen',4,4),
           ('rdhotels','memories-budapest','full_clean','Full clean',5,NULL);

  INSERT INTO public.rooms(id,hotel,organization_slug,is_checkout_room,pms_metadata,
      guest_nights_stayed,last_towel_change,last_linen_change)
    VALUES(room_id,'Hotel Memories Budapest','rdhotels',true,
      jsonb_build_object('pmsSyncDate',work_day::text,'lastPmsRefreshDate',work_day::text,
        'currentNight',2,'totalNights',2,'scheduledDepartureToday',true,
        'occupiedToday',false,'arrivalToday',false),2,NULL,NULL);

  -- A same-guest extension (2 -> 5 nights). The frontend's old guess writes
  -- fake completion dates and guessed flags; the DB must discard those values.
  UPDATE public.rooms SET is_checkout_room=false,guest_nights_stayed=3,
    pms_metadata=jsonb_build_object('pmsSyncDate',work_day::text,
      'lastPmsRefreshDate',work_day::text,'currentNight',3,'totalNights',5,
      'scheduledDepartureToday',false,'occupiedToday',true,'stayThroughToday',true,
      'arrivalToday',false),
    towel_change_required=true,linen_change_required=true,
    last_towel_change=work_day,last_linen_change=work_day
  WHERE id=room_id;
  SELECT * INTO room_row FROM public.rooms WHERE id=room_id;
  IF room_row.last_towel_change IS NOT NULL OR room_row.last_linen_change IS NOT NULL
     OR room_row.towel_change_required IS DISTINCT FROM false
     OR room_row.linen_change_required IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'PMS guessed a service or fabricated a completed service date';
  END IF;
  SELECT * INTO review FROM public.housekeeping_stay_extension_reviews
    WHERE room_id=room_id AND hotel_id='memories-budapest';
  IF review.id IS NULL OR review.arrival_date<>work_day-2
    OR review.original_checkout_date<>work_day
    OR review.revised_checkout_date<>work_day+3
    OR review.nights_completed<>2 OR review.planned_nights<>5
    OR review.identity_status<>'needs_verification'
    OR jsonb_array_length(review.services_due)<>1
    OR review.services_due->0->>'service'<>'towel_change' THEN
    RAISE EXCEPTION 'Extension/date calculation or conservative review is wrong';
  END IF;

  -- Duplicate snapshot must not create duplicate alerts.
  UPDATE public.rooms SET pms_metadata=pms_metadata WHERE id=room_id;
  SELECT count(*) INTO review_count FROM public.housekeeping_stay_extension_reviews
    WHERE room_id=room_id;
  IF review_count<>1 THEN RAISE EXCEPTION 'Repeated PMS sync created duplicate reviews'; END IF;

  -- Subsequent extension keeps original checkout and appends history once.
  UPDATE public.rooms SET pms_metadata=jsonb_set(pms_metadata,'{totalNights}','7'::jsonb)
  WHERE id=room_id;
  SELECT * INTO review FROM public.housekeeping_stay_extension_reviews
    WHERE room_id=room_id;
  history_size:=jsonb_array_length(review.extension_history);
  IF review.original_checkout_date<>work_day
     OR review.previous_checkout_date<>work_day+3
     OR review.revised_checkout_date<>work_day+5
     OR review.planned_nights<>7 OR history_size<>2 THEN
    RAISE EXCEPTION 'Repeated extension lost original departure or history';
  END IF;

  -- A manager explicitly records a completed service outside PMS metadata:
  -- that field update must remain possible. Review due remains conservative
  -- because existing historical timestamps are not verified evidence.
  UPDATE public.rooms SET last_towel_change=work_day WHERE id=room_id;
  SELECT * INTO room_row FROM public.rooms WHERE id=room_id;
  IF room_row.last_towel_change<>work_day THEN
    RAISE EXCEPTION 'Manager service-date change unexpectedly blocked';
  END IF;

  -- New arrival / different guest must not inherit yesterday's requests.
  UPDATE public.rooms SET pms_metadata=jsonb_build_object(
    'pmsSyncDate',work_day::text,'lastPmsRefreshDate',work_day::text,
    'currentNight',1,'totalNights',4,'arrivalToday',true,'notArrived',true),
    towel_change_required=true,linen_change_required=true
  WHERE id=room_id;
  SELECT * INTO room_row FROM public.rooms WHERE id=room_id;
  IF room_row.towel_change_required OR room_row.linen_change_required THEN
    RAISE EXCEPTION 'Previous guest service requirement leaked to a new arrival';
  END IF;
  SELECT count(*) INTO review_count FROM public.housekeeping_stay_extension_reviews
    WHERE room_id=room_id;
  IF review_count<>1 THEN RAISE EXCEPTION 'Different guest created a false extension'; END IF;

  -- A second hotel has no configured policy. Never borrow Memories' rules.
  INSERT INTO public.rooms(id,hotel,organization_slug,is_checkout_room,pms_metadata,
    guest_nights_stayed) VALUES(other_room_id,'Hotel Mika Downtown','rdhotels',true,
    jsonb_build_object('pmsSyncDate',work_day::text,'lastPmsRefreshDate',work_day::text,
      'currentNight',2,'totalNights',2,'scheduledDepartureToday',true),2);
  UPDATE public.rooms SET is_checkout_room=false,guest_nights_stayed=3,
    pms_metadata=jsonb_build_object('pmsSyncDate',work_day::text,
      'lastPmsRefreshDate',work_day::text,'currentNight',3,'totalNights',5,
      'scheduledDepartureToday',false,'occupiedToday',true)
  WHERE id=other_room_id;
  SELECT * INTO review FROM public.housekeeping_stay_extension_reviews
    WHERE room_id=other_room_id;
  IF review.id IS NULL OR review.hotel_id<>'mika-downtown'
     OR review.policy_configured OR jsonb_array_length(review.services_due)<>0 THEN
    RAISE EXCEPTION 'Missing policy incorrectly inherited another hotel rules';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='check_towel_linen_on_completion'
    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Legacy completion trigger is still active';
  END IF;
  RAISE NOTICE 'PASS: no phantom completions; extension/re-extension; dedupe; turnover; hotel isolation; legacy trigger removed';
END;
$test$;
