-- Remote, opt-in cutoff for obsolete HotelCare browser bundles.
-- Disabled on installation. Enable only AFTER production deployment and
-- verifying that fresh clients include the hotelcare/build stamp in x-client-info.
--
-- Scope is exceptionally narrow: signed-in GETs for the three previously
-- identified expensive PostgREST tables, originating from my.hotelcare.app.
-- Never affects writes, Previo/Edge server jobs, Realtime, Auth, Storage,
-- other projects or anonymous guest/checkout URLs.

CREATE TABLE IF NOT EXISTS public.hotelcare_client_policy (
  id text PRIMARY KEY CHECK (id = 'hotelcare'),
  enforce_stale_clients boolean NOT NULL DEFAULT false,
  minimum_build_at bigint NOT NULL DEFAULT 0 CHECK (minimum_build_at >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.hotelcare_client_policy (id, enforce_stale_clients, minimum_build_at)
VALUES ('hotelcare', false, 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.hotelcare_client_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotelcare_client_policy FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public.hotelcare_client_policy TO authenticated;

DROP POLICY IF EXISTS hotelcare_client_policy_admin_read ON public.hotelcare_client_policy;
CREATE POLICY hotelcare_client_policy_admin_read ON public.hotelcare_client_policy
  FOR SELECT TO authenticated USING (public.is_super_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS hotelcare_client_policy_admin_update ON public.hotelcare_client_policy;
CREATE POLICY hotelcare_client_policy_admin_update ON public.hotelcare_client_policy
  FOR UPDATE TO authenticated
  USING (public.is_super_admin((SELECT auth.uid())))
  WITH CHECK (public.is_super_admin((SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.hotelcare_stale_client_pre_request()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $gate$
DECLARE
  request_path text;
  request_headers jsonb;
  referer_host text;
  build_timestamp text;
  minimum_timestamp bigint;
  enabled boolean;
BEGIN
  -- Extremely cheap exits for the entire rest of the Data API.
  -- SECURITY DEFINER changes current_user to the function owner; inspect
  -- the verified PostgREST JWT role instead of current_user.
  IF coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'authenticated'
    OR current_setting('request.method', true) <> 'GET' THEN
    RETURN;
  END IF;

  request_path := trim(both '/' FROM coalesce(current_setting('request.path', true), ''));
  IF request_path NOT IN ('rooms','pms_accounts','pms_configurations') THEN
    RETURN;
  END IF;

  request_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  referer_host := split_part(lower(coalesce(request_headers ->> 'referer', '')), '/', 3);
  IF referer_host <> 'my.hotelcare.app' THEN
    RETURN;
  END IF;

  SELECT enforce_stale_clients, minimum_build_at INTO enabled, minimum_timestamp
  FROM public.hotelcare_client_policy WHERE id = 'hotelcare';
  IF NOT coalesce(enabled, false) OR coalesce(minimum_timestamp, 0) = 0 THEN
    RETURN;
  END IF;

  build_timestamp := substring(coalesce(request_headers ->> 'x-client-info', '') FROM 'hotelcare/([0-9]{13})');
  IF build_timestamp IS NULL
    OR build_timestamp !~ '^[0-9]{13}$'
    OR build_timestamp::bigint < minimum_timestamp THEN
    RAISE SQLSTATE 'PGRST'
      USING MESSAGE = '{"code":"HOTELCARE_UPDATE_REQUIRED","message":"This HotelCare tab is outdated. Reload the page before continuing.","details":null,"hint":"Refresh HotelCare to continue."}',
            DETAIL = '{"status":428,"headers":{"Cache-Control":"no-store"}}';
  END IF;
END;
$gate$;

-- PostgREST calls the hook under the request role; no rows or secrets
-- are exposed through the function. Unauthenticated requests return early.
REVOKE ALL ON FUNCTION public.hotelcare_stale_client_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hotelcare_stale_client_pre_request() TO anon, authenticated, service_role;

-- It is safe to install while disabled. Turning the table flag on later
-- does not require redeploying the app or changing Supabase secrets.
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.hotelcare_stale_client_pre_request';
NOTIFY pgrst, 'reload config';

-- Rollback: ALTER ROLE authenticator RESET pgrst.db_pre_request;
--           NOTIFY pgrst, 'reload config';
