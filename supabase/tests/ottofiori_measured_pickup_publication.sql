-- Exercise the real production trigger with temporary push items only.
-- No public price, booking, decision or queue row is changed.
BEGIN;
CREATE TEMP TABLE pickup_publication_probe (LIKE public.revenue_rate_push_items INCLUDING DEFAULTS);
CREATE TRIGGER probe BEFORE INSERT ON pickup_publication_probe
FOR EACH ROW EXECUTE FUNCTION public.enforce_ottofiori_push_direction_integrity();
DO $test$
DECLARE original public.revenue_rate_push_items%ROWTYPE;
        probe pickup_publication_probe%ROWTYPE;
BEGIN
 SELECT i.* INTO STRICT original FROM public.revenue_rate_push_items i
 JOIN public.revenue_date_decisions d ON d.id=i.decision_id
 WHERE i.hotel_id='ottofiori' AND d.decision_reason='revenue_director_yield'
 AND d.direction='increase' AND d.movement=2 AND d.days_out>7
 AND greatest(0,d.pickup_24h-d.cancellations_24h)=1
 AND d.occupancy_pct<85 AND d.rooms_remaining>2
 ORDER BY i.created_at DESC LIMIT 1;
 original.draft_id:=NULL;
 original.status:='queued'; original.error:=NULL;
 original.target_price:=original.old_price+2;
 INSERT INTO pickup_publication_probe SELECT original.* RETURNING * INTO probe;
 IF probe.status<>'queued' THEN RAISE EXCEPTION 'A valid measured two-euro test was rejected: %',probe.error; END IF;
 DELETE FROM pickup_publication_probe;
 original.target_price:=original.old_price+3;
 INSERT INTO pickup_publication_probe SELECT original.* RETURNING * INTO probe;
 IF probe.status<>'failed' THEN RAISE EXCEPTION 'An unsupported three-euro jump was allowed'; END IF;
 DELETE FROM pickup_publication_probe;
 original.target_price:=original.old_price-2;
 INSERT INTO pickup_publication_probe SELECT original.* RETURNING * INTO probe;
 IF probe.status<>'failed' THEN RAISE EXCEPTION 'Opposite-direction child was allowed'; END IF;
 RAISE NOTICE 'Measured pickup publication: 3 checks passed';
END;
$test$;
ROLLBACK;
