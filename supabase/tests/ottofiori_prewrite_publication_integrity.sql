-- Transactional probe: strong early occupancy and soft single-booking limits.
BEGIN;
CREATE TEMP TABLE pickup_integrity_probe (LIKE public.revenue_rate_push_items INCLUDING DEFAULTS);
CREATE TRIGGER probe BEFORE INSERT ON pickup_integrity_probe
FOR EACH ROW EXECUTE FUNCTION public.enforce_ottofiori_push_direction_integrity();
DO $test$
DECLARE original public.revenue_rate_push_items%ROWTYPE;
        probe pickup_integrity_probe%ROWTYPE;
BEGIN
  SELECT i.* INTO STRICT original
  FROM public.revenue_rate_push_items i
  WHERE i.run_id = 'f6b13c69-29c0-41cc-a072-7affd1fbe7b9'
    AND i.hotel_id = 'ottofiori'
    AND i.decision_id = 'f9c65abd-50d8-4ab3-893f-aea49bad8754'
  LIMIT 1;
  original.draft_id := NULL;
  original.status := 'queued';
  original.error := NULL;
  INSERT INTO pickup_integrity_probe SELECT original.* RETURNING * INTO probe;
  IF probe.status <> 'queued' THEN
    RAISE EXCEPTION 'Strong early occupancy was mislabeled soft: %', probe.error;
  END IF;
END;
$test$;
ROLLBACK;
