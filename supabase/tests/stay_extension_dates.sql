-- Run against a development PostgreSQL database. Read-only scenario checks
-- mirror the arrival-date/night-count guard in hc_record_stay_extension_review.
WITH cases(name, old_day, new_day, old_current, new_current, old_total, new_total,
           old_checkout, new_checkout, expected_extension, expected_completed) AS (
  VALUES
  ('same-day checkout becomes daily', '2026-09-20'::date, '2026-09-20'::date, 2, 3, 2, 5, true, false, true, 2),
  ('second extension same stay', '2026-09-20'::date, '2026-09-20'::date, 3, 3, 5, 7, false, false, true, 2),
  ('different guest same room', '2026-09-20'::date, '2026-09-20'::date, 2, 1, 2, 3, true, false, false, 0),
  ('extension detected the following day', '2026-09-20'::date, '2026-09-21'::date, 2, 4, 2, 6, true, false, true, 3),
  ('ordinary sync unchanged checkout', '2026-09-20'::date, '2026-09-20'::date, 3, 3, 5, 5, false, false, false, 2),
  ('shortening is not an extension', '2026-09-20'::date, '2026-09-20'::date, 3, 3, 5, 4, false, false, false, 2)
), calculated AS (
  SELECT *,
    old_day - (old_current - CASE WHEN old_checkout THEN 0 ELSE 1 END) AS old_arrival,
    new_day - (new_current - CASE WHEN new_checkout THEN 0 ELSE 1 END) AS new_arrival
  FROM cases
), outcomes AS (
  SELECT name,
    ((new_total > old_total AND old_arrival = new_arrival) = expected_extension) AS detection_pass,
    (NOT expected_extension OR new_day - new_arrival = expected_completed) AS completed_nights_pass
  FROM calculated
)
SELECT name, detection_pass, completed_nights_pass FROM outcomes;
-- All 12 PASS cells must be true; this exercises date reasoning only, not
-- RLS, notification delivery, trigger execution, or migrations.
