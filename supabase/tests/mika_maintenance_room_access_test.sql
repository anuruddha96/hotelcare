-- Regression tests for Hotel Mika Downtown maintenance room-access policy.
BEGIN;

DO $$
DECLARE
  fn text;
BEGIN
  SELECT pg_get_functiondef('public.get_mika_maintenance_room_access(uuid)'::regprocedure) INTO fn;
  IF position('Hotel Mika Downtown' in fn) = 0 THEN
    RAISE EXCEPTION 'Mika property guard is missing';
  END IF;
  IF position('waiting_for_checkout' in fn) = 0 OR position('ready_to_fix' in fn) = 0 OR position('consent_required' in fn) = 0 THEN
    RAISE EXCEPTION 'Mika access states are incomplete';
  END IF;
  IF position('checkedOutToday' in fn) = 0 OR position('checkout_time' in fn) = 0 THEN
    RAISE EXCEPTION 'Verified checkout evidence is not used';
  END IF;

  SELECT pg_get_functiondef('public.start_mika_maintenance_ticket(uuid,timestamptz,text)'::regprocedure) INTO fn;
  IF position('Wait for verified Previo checkout' in fn) = 0 THEN
    RAISE EXCEPTION 'Checkout-room start guard is missing';
  END IF;
  IF position('guest_permission' in fn) = 0 OR position('guest_out' in fn) = 0 THEN
    RAISE EXCEPTION 'Stayover access confirmations are missing';
  END IF;
END $$;

ROLLBACK;
