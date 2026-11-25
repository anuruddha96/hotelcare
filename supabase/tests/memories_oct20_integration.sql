\set ON_ERROR_STOP on
DO $checks$
DECLARE notes_127 text; notes_144 text; notes_900 text;
BEGIN
 SELECT notes INTO notes_127 FROM public.rooms WHERE room_number='127';
 SELECT notes INTO notes_144 FROM public.rooms WHERE room_number='144';
 SELECT notes INTO notes_900 FROM public.rooms WHERE room_number='900';
 IF notes_127 IS NOT NULL THEN RAISE EXCEPTION 'Generated HMB note was not removed'; END IF;
 IF notes_144 IS DISTINCT FROM 'Prepare cot' THEN RAISE EXCEPTION 'Manual note was damaged: %',notes_144; END IF;
 IF notes_900 IS DISTINCT FROM 'Previous guest bed setup: Twin Beds Together — reset to standard room setup.'
 THEN RAISE EXCEPTION 'Non-HMB note was altered'; END IF;
 IF (SELECT notes FROM public.rooms WHERE room_number='010') IS DISTINCT FROM 'Manager instruction: guest needs extra towel'
 THEN RAISE EXCEPTION 'Manual manager note changed'; END IF;

 IF NOT public.hc_carry_final_night_towel_only('Hotel Memories Budapest','{"departureDate":"2026-10-21","currentNight":"6","totalNights":"6"}',date '2026-10-20')
 THEN RAISE EXCEPTION 'Last occupied night should be T'; END IF;
 IF public.hc_carry_final_night_towel_only('Hotel Memories Budapest','{"departureDate":"2026-10-23","currentNight":"5","totalNights":"8"}',date '2026-10-20')
 THEN RAISE EXCEPTION '5/8 must retain C'; END IF;
 IF public.hc_carry_final_night_towel_only('Hotel Memories Budapest','{"pmsSyncDate":"2026-10-20","currentNight":"2","totalNights":"6","continuousStay":{"currentNight":"2","totalNights":"2"}}',date '2026-10-20')
 THEN RAISE EXCEPTION 'Extension segment 2/2 must not convert whole-stay 2/6'; END IF;
 IF NOT public.hc_carry_final_night_towel_only('Hotel Memories Budapest','{"pmsSyncDate":"2026-10-20","currentNight":"6","totalNights":"6"}',date '2026-10-20')
 THEN RAISE EXCEPTION 'Same-day whole-stay 6/6 fallback must work'; END IF;
 IF public.hc_carry_final_night_towel_only('Hotel Ottofiori','{"pmsSyncDate":"2026-10-20","currentNight":"6","totalNights":"6"}',date '2026-10-20')
 THEN RAISE EXCEPTION 'Non-HMB must not use new night-count fallback'; END IF;

 -- Make sure the guard blocks subsequent generated notes after a PMS refresh.
 UPDATE public.rooms
 SET notes=E'Guest specifically asked for separate beds\nPrevious guest bed setup: Twin Beds Together — reset to standard room setup.'
 WHERE room_number='144';
 IF (SELECT notes FROM public.rooms WHERE room_number='144') IS DISTINCT FROM 'Guest specifically asked for separate beds'
 THEN RAISE EXCEPTION 'HMB refresh guard removed a manual note or kept boilerplate'; END IF;
END $checks$;
SELECT 'PASS: HMB generated note removal, manual preservation, cross-property isolation, final-night logic' AS result;
