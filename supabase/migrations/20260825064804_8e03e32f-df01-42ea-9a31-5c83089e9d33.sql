CREATE OR REPLACE FUNCTION public.complete_revenue_sync(
  _hotel_id text,
  _success boolean,
  _error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completed_at timestamptz := now();
BEGIN
  -- Always republish: whatever this run wrote (above all the authoritative
  -- Previo price mirror) is newer than the stored snapshot, even when the run
  -- also collected soft errors. Publishing only on a clean run left the app
  -- showing stale Hotel Care prices after a PMS refresh.
  BEGIN
    PERFORM public.refresh_revenue_published_payload(
      _hotel_id,
      CASE WHEN _success THEN v_completed_at
           ELSE COALESCE((SELECT last_success_at FROM public.revenue_sync_state WHERE hotel_id = _hotel_id), v_completed_at)
      END,
      NULL);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  UPDATE public.revenue_sync_state
  SET last_success_at = CASE WHEN _success THEN v_completed_at ELSE last_success_at END,
      lease_started_at = NULL,
      lease_expires_at = NULL,
      lease_owner = NULL,
      last_error = CASE WHEN _success THEN NULL ELSE left(COALESCE(_error, 'Revenue refresh failed'), 1000) END,
      updated_at = now()
  WHERE hotel_id = _hotel_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_revenue_sync(
  _hotel_id text,
  _success boolean,
  _actor_id uuid,
  _actor_name text DEFAULT NULL,
  _error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completed_at timestamptz := now();
BEGIN
  BEGIN
    PERFORM public.refresh_revenue_published_payload(
      _hotel_id,
      CASE WHEN _success THEN v_completed_at
           ELSE COALESCE((SELECT last_success_at FROM public.revenue_sync_state WHERE hotel_id = _hotel_id), v_completed_at)
      END,
      _actor_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  UPDATE public.revenue_sync_state
  SET last_success_at = CASE WHEN _success THEN v_completed_at ELSE last_success_at END,
      last_success_by = CASE WHEN _success THEN _actor_id ELSE last_success_by END,
      last_success_by_name = CASE WHEN _success THEN NULLIF(left(COALESCE(_actor_name, ''), 200), '') ELSE last_success_by_name END,
      lease_started_at = NULL,
      lease_expires_at = NULL,
      lease_owner = NULL,
      last_error = CASE WHEN _success THEN NULL ELSE left(COALESCE(_error, 'Revenue refresh failed'), 1000) END,
      updated_at = now()
  WHERE hotel_id = _hotel_id
    AND (_actor_id IS NULL OR lease_owner = _actor_id);
END;
$$;